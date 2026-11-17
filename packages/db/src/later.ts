import type { Sql } from "postgres";
import { LaterItem, laterLimits } from "@venom/contracts";
import type { DeviceRef } from "./store.ts";

export interface KeepForLater {
  readonly device: DeviceRef;
  readonly requestId: string;
  readonly title: string;
  readonly body: string;
  readonly taskId?: string;
}

export interface LaterChange {
  readonly device: DeviceRef;
  readonly requestId: string;
  readonly itemId: string;
}

export interface Kept {
  readonly item: LaterItem;
  readonly dropped: readonly string[];
}

export interface LaterStore {
  keepForLater(input: KeepForLater): Promise<Kept>;
  laterItems(accountId: string): Promise<LaterItem[]>;
  markLaterSeen(change: LaterChange): Promise<LaterItem | null>;
  removeLater(change: LaterChange): Promise<boolean>;
}

interface LaterRow {
  id: string;
  account_id: string;
  task_id: string | null;
  title: string;
  body: string;
  seen_at: Date | null;
  created_at: Date;
}

function toItem({ id, account_id, task_id, title, body, seen_at, created_at }: LaterRow): LaterItem {
  return LaterItem.parse({ id, account_id, task_id, title, body, seen_at: seen_at?.toISOString() ?? null, created_at: created_at.toISOString() });
}

export function laterStore(sql: Sql): LaterStore {
  return {
    async keepForLater({ device, requestId, title, body, taskId = null }) {
      return sql.begin(async (tx) => {
        const [row] = await tx<LaterRow[]>`
          insert into later_items (account_id, device_id, task_id, title, body)
          values (${device.account_id}, ${device.id}, ${taskId}, ${title}, ${body})
          returning id, account_id, task_id, title, body, seen_at, created_at
        `;
        if (row === undefined) {
          throw new Error("Later insert returned no row");
        }
        const dropped = await tx<{ id: string }[]>`
          delete from later_items
          where account_id = ${device.account_id} and id in (
            select id from later_items
            where account_id = ${device.account_id}
            order by created_at desc, id desc
            offset ${laterLimits.items}
          )
          returning id
        `;
        await tx`
          insert into audit_log (account_id, device_id, request_id, actor, action, subject_id, detail)
          values (
            ${device.account_id}, ${device.id}, ${requestId}, 'venom', 'later.kept', ${row.id},
            ${tx.json({ characters: body.length, ...(taskId === null ? {} : { task_id: taskId }), ...(dropped.length === 0 ? {} : { dropped: dropped.length }) })}
          )
        `;
        return { item: toItem(row), dropped: dropped.map(({ id }) => id) };
      });
    },

    async laterItems(accountId) {
      const rows = await sql<LaterRow[]>`
        select id, account_id, task_id, title, body, seen_at, created_at
        from later_items
        where account_id = ${accountId}
        order by created_at desc, id desc
        limit ${laterLimits.items}
      `;
      return rows.map(toItem);
    },

    async markLaterSeen({ device, requestId, itemId }) {
      return sql.begin(async (tx) => {
        const [row] = await tx<LaterRow[]>`
          update later_items set seen_at = coalesce(seen_at, clock_timestamp())
          where id = ${itemId} and account_id = ${device.account_id}
          returning id, account_id, task_id, title, body, seen_at, created_at
        `;
        if (row === undefined) {
          return null;
        }
        await tx`
          insert into audit_log (account_id, device_id, request_id, actor, action, subject_id)
          values (${device.account_id}, ${device.id}, ${requestId}, 'user', 'later.seen', ${row.id})
        `;
        return toItem(row);
      });
    },

    async removeLater({ device, requestId, itemId }) {
      return sql.begin(async (tx) => {
        const removed = await tx`
          delete from later_items where id = ${itemId} and account_id = ${device.account_id}
        `;
        if (removed.count === 0) {
          return false;
        }
        await tx`
          insert into audit_log (account_id, device_id, request_id, actor, action, subject_id)
          values (${device.account_id}, ${device.id}, ${requestId}, 'user', 'later.removed', ${itemId})
        `;
        return true;
      });
    },
  };
}
