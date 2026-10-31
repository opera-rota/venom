import {
  defaultEngine,
  EngineId,
  EngineList,
  engines,
  PowerStatus,
  powerUnitMicroUsd,
  publicEngine,
  type EngineSpec,
  type TokenUsage,
} from "@venom/contracts";
import type { DeviceRef } from "@venom/db";
import type { Sql } from "postgres";
import { refusePower } from "./errors.ts";

export interface PowerOptions {
  readonly sql: Sql;
  readonly freeDailyAnswers?: number;
}

export interface Charge {
  readonly device: DeviceRef;
  readonly requestId: string;
  readonly engine: EngineId;
  readonly model: string | null;
  readonly usage: TokenUsage;
}

export interface Grant {
  readonly email: string;
  readonly units: number;
  readonly note: string;
}

export interface Granted {
  readonly accountId: string;
  readonly status: PowerStatus;
}

export type Availability = ReadonlySet<EngineId>;

export interface Power {
  engines(accountId: string, available: Availability): Promise<EngineList>;
  choose(device: DeviceRef, requestId: string, engine: EngineId, available: Availability): Promise<PowerStatus>;
  status(accountId: string): Promise<PowerStatus>;
  admit(accountId: string, available: Availability): Promise<EngineId>;
  charge(charge: Charge): Promise<PowerStatus>;
  grant(grant: Grant): Promise<Granted>;
}

export const defaultFreeDailyAnswers = 30;

const recentAnswersForAverage = 20;

interface LedgerRow {
  balance: string;
  free_used: string;
  resets_at: Date;
  average: string | null;
}

export function spec(engine: EngineId): EngineSpec {
  return engines[engine];
}

export function unitsFor(engine: EngineSpec, usage: TokenUsage): number {
  if (engine.class === "free") {
    return 0;
  }
  return Math.ceil(usage.cost_micro_usd / powerUnitMicroUsd);
}

export function createPower({ sql, freeDailyAnswers = defaultFreeDailyAnswers }: PowerOptions): Power {
  async function current(accountId: string): Promise<EngineId> {
    const [row] = await sql<{ engine: string }[]>`select engine from engine_choices where account_id = ${accountId}`;
    const parsed = EngineId.safeParse(row?.engine);
    return parsed.success ? parsed.data : defaultEngine;
  }

  async function status(accountId: string): Promise<PowerStatus> {
    const engine = spec(await current(accountId));
    const [row] = await sql<LedgerRow[]>`
      with day as (
        select date_trunc('day', clock_timestamp() at time zone 'UTC') at time zone 'UTC' as starts
      )
      select
        coalesce(sum(ledger.units), 0) as balance,
        count(*) filter (
          where ledger.kind = 'answer' and ledger.engine_class = 'free' and ledger.occurred_at >= day.starts
        ) as free_used,
        (select starts from day) + interval '1 day' as resets_at,
        (
          select avg(-recent.units)
          from (
            select units from power_ledger
            where account_id = ${accountId} and kind = 'answer' and engine = ${engine.id} and units < 0
            order by occurred_at desc
            limit ${recentAnswersForAverage}
          ) recent
        ) as average
      from day
      left join power_ledger ledger on ledger.account_id = ${accountId}
      group by day.starts
    `;
    if (row === undefined) {
      throw new Error("Power status query returned no row");
    }

    const balance = Number(row.balance);
    const freeUsed = Number(row.free_used);
    const free = engine.class === "free";
    const perAnswer = Math.max(1, row.average === null ? engine.typical_power : Math.ceil(Number(row.average)));

    return PowerStatus.parse({
      engine: engine.id,
      engine_class: engine.class,
      balance,
      free_daily_answers: freeDailyAnswers,
      free_used_today: freeUsed,
      free_resets_at: row.resets_at.toISOString(),
      answers_left: free ? Math.max(0, freeDailyAnswers - freeUsed) : Math.max(0, Math.floor(balance / perAnswer)),
      answers_left_exact: free,
    });
  }

  return {
    async engines(accountId, available) {
      return EngineList.parse({
        engines: Object.values(engines)
          .filter((engine) => available.has(engine.id))
          .map(publicEngine),
        current: await current(accountId),
      });
    },

    async choose(device, requestId, engine, available) {
      if (!available.has(engine)) {
        throw refusePower.engineResting(spec(engine));
      }
      await sql.begin(async (tx) => {
        await tx`
          insert into engine_choices (account_id, engine) values (${device.account_id}, ${engine})
          on conflict (account_id) do update set engine = excluded.engine, chosen_at = clock_timestamp()
        `;
        await tx`
          insert into audit_log (account_id, device_id, request_id, actor, action, detail)
          values (${device.account_id}, ${device.id}, ${requestId}, 'user', 'engine.chosen', ${tx.json({ engine })})
        `;
      });
      return status(device.account_id);
    },

    status,

    async admit(accountId, available) {
      const now = await status(accountId);
      const engine = spec(now.engine);
      if (!available.has(engine.id)) {
        throw refusePower.engineResting(engine);
      }
      if (engine.class === "free" && now.free_used_today >= now.free_daily_answers) {
        throw refusePower.freeUsedUp(engine, now.free_daily_answers);
      }
      if (engine.class !== "free" && now.balance <= 0) {
        throw refusePower.noPower(engine);
      }
      return engine.id;
    },

    async charge({ device, requestId, engine, model, usage }) {
      const used = spec(engine);
      await sql`
        insert into power_ledger (
          account_id, kind, units, engine, engine_class, request_id, model, input_tokens, output_tokens, cost_micro_usd
        )
        values (
          ${device.account_id}, 'answer', ${-unitsFor(used, usage)}, ${used.id}, ${used.class}, ${requestId}, ${model},
          ${usage.input_tokens}, ${usage.output_tokens}, ${usage.cost_micro_usd}
        )
        on conflict (request_id) do nothing
      `;
      return status(device.account_id);
    },

    async grant({ email, units, note }) {
      if (!Number.isSafeInteger(units) || units <= 0) {
        throw new RangeError("Power to grant must be a whole number above zero.");
      }
      const accountId = await sql.begin(async (tx) => {
        const [account] = await tx<{ id: string }[]>`select id from accounts where lower(email) = lower(${email})`;
        if (account === undefined) {
          throw refusePower.unknownEmail();
        }
        await tx`insert into power_ledger (account_id, kind, units, note) values (${account.id}, 'grant', ${units}, ${note})`;
        await tx`
          insert into audit_log (account_id, actor, action, detail)
          values (${account.id}, 'system', 'power.granted', ${tx.json({ units, note })})
        `;
        return account.id;
      });
      return { accountId, status: await status(accountId) };
    },
  };
}
