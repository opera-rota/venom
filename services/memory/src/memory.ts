import {
  MemoryContext,
  MemoryItem,
  MemoryList,
  memoryLimits,
  type MemoryDraft,
  type MemoryForgotten,
  type MemoryType,
  type TokenUsage,
} from "@venom/contracts";
import type { DeviceRef } from "@venom/db";
import type { Sql } from "postgres";
import { refuseMemory } from "./errors.ts";

export interface Embedded {
  readonly model: string;
  readonly vectors: readonly (readonly number[])[];
  readonly usage: TokenUsage;
}

export interface Embedder {
  embed(texts: readonly string[], requestId: string): Promise<Embedded>;
}

export type MemoryOrigin = { readonly kind: "chat"; readonly requestId: string } | { readonly kind: "settings" };

export interface Saved {
  readonly item: MemoryItem;
  readonly usage: TokenUsage;
}

export interface Recall {
  readonly memories: readonly MemoryContext[];
  readonly usage: TokenUsage;
}

export interface MemoryOptions {
  readonly sql: Sql;
  readonly embedder: Embedder;
  readonly onEmbeddingProblem?: (error: unknown) => void;
}

export interface Memory {
  list(accountId: string): Promise<MemoryList>;
  save(device: DeviceRef, requestId: string, draft: MemoryDraft, origin: MemoryOrigin): Promise<Saved>;
  edit(device: DeviceRef, requestId: string, memoryId: string, draft: MemoryDraft): Promise<MemoryItem>;
  forget(device: DeviceRef, requestId: string, memoryId: string): Promise<MemoryForgotten>;
  recall(accountId: string, text: string, requestId: string): Promise<Recall>;
  spokenIn(accountId: string, requestId: string): Promise<MemoryContext | null>;
  backfill(requestId: string): Promise<number>;
}

export const nothingUsed: TokenUsage = { input_tokens: 0, output_tokens: 0, cost_micro_usd: 0 };

export const closeEnough = 0.65;

const queryCharacters = 1000;
const backfillBatch = 32;
const fusion = 60;

interface ItemRow {
  id: string;
  account_id: string;
  type: MemoryType;
  content: string;
  source: "chat" | "settings";
  created_at: Date;
  updated_at: Date;
}

interface ContextRow {
  type: MemoryType;
  content: string;
  updated_at: Date;
}

interface ForgetRow {
  spoken_request: string | null;
  removed_messages: string[];
}

function toItem(row: ItemRow): MemoryItem {
  return MemoryItem.parse({ ...row, created_at: row.created_at.toISOString(), updated_at: row.updated_at.toISOString(), status: "active" });
}

function toContext(row: ContextRow): MemoryContext {
  return MemoryContext.parse({ type: row.type, content: row.content, saved_at: row.updated_at.toISOString() });
}

function vectorText(vector: readonly number[]): string {
  if (vector.length === 0 || !vector.every(Number.isFinite)) {
    throw new RangeError("An embedding must be a non-empty list of finite numbers.");
  }
  return `[${vector.join(",")}]`;
}

function isMemoryFull(error: unknown): boolean {
  return typeof error === "object" && error !== null && "constraint_name" in error && error.constraint_name === "memories_limit";
}

export function addUsage(...usages: readonly TokenUsage[]): TokenUsage {
  return usages.reduce(
    (total, usage) => ({
      input_tokens: total.input_tokens + usage.input_tokens,
      output_tokens: total.output_tokens + usage.output_tokens,
      cost_micro_usd: total.cost_micro_usd + usage.cost_micro_usd,
    }),
    nothingUsed,
  );
}

const itemColumns = "id, account_id, type, content, source, created_at, updated_at";

export function createMemory({ sql, embedder, onEmbeddingProblem = () => {} }: MemoryOptions): Memory {
  let lastModel: string | null = null;

  async function tryEmbed(texts: readonly string[], requestId: string): Promise<Embedded | null> {
    try {
      const embedded = await embedder.embed(texts, requestId);
      if (embedded.vectors.length !== texts.length) {
        throw new RangeError("The brain did not return one vector for every text.");
      }
      lastModel = embedded.model;
      return embedded;
    } catch (error) {
      onEmbeddingProblem(error);
      return null;
    }
  }

  async function attachVector(id: string, content: string, requestId: string): Promise<TokenUsage> {
    const embedded = await tryEmbed([content], requestId);
    const vector = embedded?.vectors[0];
    if (embedded === null || vector === undefined) {
      return nothingUsed;
    }
    await sql`
      update memories set embedding = ${vectorText(vector)}::vector, embedding_model = ${embedded.model}
      where id = ${id} and content = ${content}
    `;
    return embedded.usage;
  }

  return {
    async list(accountId) {
      const rows = await sql<ItemRow[]>`
        select ${sql.unsafe(itemColumns)} from memories
        where account_id = ${accountId}
        order by created_at desc, id desc
        limit ${memoryLimits.items}
      `;
      return MemoryList.parse({ items: rows.map(toItem), limit: memoryLimits.items });
    },

    async save(device, requestId, draft, origin) {
      let row: ItemRow;
      try {
        row = await sql.begin(async (tx) => {
          const [inserted] = await tx<ItemRow[]>`
            insert into memories (account_id, type, content, source, source_request_id)
            values (
              ${device.account_id}, ${draft.type}, ${draft.content}, ${origin.kind},
              ${origin.kind === "chat" ? origin.requestId : null}
            )
            returning ${tx.unsafe(itemColumns)}
          `;
          if (inserted === undefined) {
            throw new Error("Memory insert returned no row");
          }
          await tx`
            insert into audit_log (account_id, device_id, request_id, actor, action, subject_id, detail)
            values (
              ${device.account_id}, ${device.id}, ${requestId}, 'user', 'memory.saved', ${inserted.id},
              ${tx.json({ type: draft.type, source: origin.kind, characters: draft.content.length })}
            )
          `;
          return inserted;
        });
      } catch (error) {
        throw isMemoryFull(error) ? refuseMemory.full() : error;
      }
      const usage = await attachVector(row.id, row.content, requestId);
      return { item: toItem(row), usage };
    },

    async edit(device, requestId, memoryId, draft) {
      const row = await sql.begin(async (tx) => {
        const [updated] = await tx<ItemRow[]>`
          update memories
          set type = ${draft.type}, content = ${draft.content}, updated_at = clock_timestamp(), embedding = null, embedding_model = null
          where id = ${memoryId} and account_id = ${device.account_id}
          returning ${tx.unsafe(itemColumns)}
        `;
        if (updated === undefined) {
          throw refuseMemory.unknown();
        }
        await tx`
          insert into audit_log (account_id, device_id, request_id, actor, action, subject_id, detail)
          values (
            ${device.account_id}, ${device.id}, ${requestId}, 'user', 'memory.edited', ${memoryId},
            ${tx.json({ type: draft.type, characters: draft.content.length })}
          )
        `;
        return updated;
      });
      await attachVector(row.id, row.content, requestId);
      return toItem(row);
    },

    async forget(device, requestId, memoryId) {
      return sql.begin(async (tx) => {
        const [gone] = await tx<ForgetRow[]>`select * from forget_memory(${device.account_id}, ${memoryId})`;
        if (gone === undefined) {
          throw refuseMemory.unknown();
        }
        await tx`
          insert into audit_log (account_id, device_id, request_id, actor, action, subject_id, detail)
          values (
            ${device.account_id}, ${device.id}, ${requestId}, 'user', 'memory.forgotten', ${memoryId},
            ${tx.json({ messages_removed: gone.removed_messages.length })}
          )
        `;
        return { item_id: memoryId, message_ids: gone.removed_messages };
      });
    },

    async recall(accountId, text, requestId) {
      const preferences = await sql<ContextRow[]>`
        select type, content, updated_at from memories
        where account_id = ${accountId} and type = 'preference'
        order by updated_at desc, id desc
        limit ${memoryLimits.preferences}
      `;
      const [others] = await sql<{ any: boolean }[]>`
        select exists (select 1 from memories where account_id = ${accountId} and type <> 'preference') as any
      `;
      if (others?.any !== true) {
        return { memories: preferences.map(toContext), usage: nothingUsed };
      }

      const query = text.slice(0, queryCharacters);
      const embedded = await tryEmbed([query], requestId);
      const vector = embedded?.vectors[0];
      const model = embedded === null || vector === undefined ? null : embedded.model;
      const literal = model === null || vector === undefined ? null : vectorText(vector);

      const recalled = await sql<ContextRow[]>`
        with query as (
          select nullif(replace(plainto_tsquery('english', ${query})::text, '&', '|'), '')::tsquery as words
        ),
        candidates as (
          select
            m.type, m.content, m.updated_at, m.id,
            case when ${model}::text is not null and m.embedding_model = ${model}::text then m.embedding <=> ${literal}::vector end as distance,
            case when query.words is not null and m.words @@ query.words then ts_rank_cd(m.words, query.words) end as rank
          from memories m cross join query
          where m.account_id = ${accountId} and m.type <> 'preference'
        ),
        relevant as (
          select *,
            row_number() over (order by distance asc nulls last, id) as by_meaning,
            row_number() over (order by rank desc nulls last, id) as by_words
          from candidates
          where distance < ${closeEnough} or rank is not null
        )
        select type, content, updated_at from relevant
        order by
          coalesce(case when distance < ${closeEnough} then 1.0 / (${fusion} + by_meaning) end, 0)
          + coalesce(case when rank is not null then 1.0 / (${fusion} + by_words) end, 0) desc,
          updated_at desc
        limit ${memoryLimits.recalled}
      `;
      return { memories: [...preferences, ...recalled].map(toContext), usage: embedded?.usage ?? nothingUsed };
    },

    async spokenIn(accountId, requestId) {
      const [row] = await sql<ContextRow[]>`
        select type, content, updated_at from memories where account_id = ${accountId} and source_request_id = ${requestId}
      `;
      return row === undefined ? null : toContext(row);
    },

    async backfill(requestId) {
      const rows = await sql<{ id: string; content: string }[]>`
        select id, content from memories
        where ${lastModel === null ? sql`embedding is null` : sql`embedding_model is distinct from ${lastModel}`}
        order by updated_at, id
        limit ${backfillBatch}
      `;
      if (rows.length === 0) {
        return 0;
      }
      const embedded = await tryEmbed(
        rows.map((row) => row.content),
        requestId,
      );
      if (embedded === null) {
        return 0;
      }
      await sql.begin(async (tx) => {
        for (const [index, row] of rows.entries()) {
          const vector = embedded.vectors[index];
          if (vector !== undefined) {
            await tx`
              update memories set embedding = ${vectorText(vector)}::vector, embedding_model = ${embedded.model}
              where id = ${row.id} and content = ${row.content}
            `;
          }
        }
      });
      return rows.length;
    },
  };
}
