import type { Sql, TransactionSql } from "postgres";
import { FollowHowTo, HowTo, howToLimits, type HowToLearned, type HowToStep } from "@venom/contracts";
import type { DeviceRef } from "./store.ts";

export interface SaveHowToInput {
  readonly device: DeviceRef;
  readonly requestId: string;
  readonly taskId: string | null;
  readonly name: string;
  readonly app: string | null;
  readonly learned: HowToLearned;
  readonly seconds: number | null;
  readonly steps: readonly HowToStep[];
}

export type Saved = { readonly kind: "saved"; readonly howto: HowTo } | { readonly kind: "exists" } | { readonly kind: "full" };

export interface HowToTarget {
  readonly device: DeviceRef;
  readonly requestId: string;
  readonly howtoId: string;
}

export interface HowToChange extends HowToTarget {
  readonly name?: string;
  readonly pinned?: boolean;
}

export interface StepNote extends HowToTarget {
  readonly number: number;
  readonly note: string | null;
}

export type Noted = { readonly kind: "noted"; readonly howto: HowTo } | { readonly kind: "gone" } | { readonly kind: "no_step" };

export interface HowToStart extends HowToTarget {
  readonly taskId: string;
  readonly stepByStep: boolean;
}

export interface HowToRunRef {
  readonly accountId: string;
  readonly taskId: string;
}

export interface HowToStore {
  saveHowTo(input: SaveHowToInput): Promise<Saved>;
  howtos(accountId: string): Promise<HowTo[]>;
  changeHowTo(change: HowToChange): Promise<HowTo | null>;
  noteHowToStep(note: StepNote): Promise<Noted>;
  forgetHowTo(target: HowToTarget): Promise<boolean>;
  howTo(accountId: string, howtoId: string): Promise<HowTo | null>;
  startHowTo(start: HowToStart): Promise<HowTo | null>;
  followedHowTo(run: HowToRunRef): Promise<FollowHowTo | null>;
  howToWorked(run: HowToRunRef): Promise<HowTo | null>;
}

interface HowToRow {
  id: string;
  account_id: string;
  task_id: string | null;
  name: string;
  app: string | null;
  learned: string;
  pinned: boolean;
  applied: number;
  worked: number;
  seconds: number | null;
  steps: unknown;
  created_at: Date;
  updated_at: Date;
}

const columns = "id, account_id, task_id, name, app, learned, pinned, applied, worked, seconds, steps, created_at, updated_at";

function toHowTo({ created_at, updated_at, ...row }: HowToRow): HowTo {
  return HowTo.parse({ ...row, created_at: created_at.toISOString(), updated_at: updated_at.toISOString() });
}

function stored(steps: readonly HowToStep[]): { number: number; kind: string; label: string; said: string; note: string | null }[] {
  return steps.map(({ number, kind, label, said, note }) => ({ number, kind, label, said, note }));
}

async function audit(tx: TransactionSql, { device, requestId, howtoId }: HowToTarget, action: string, detail: Record<string, string | number | boolean>): Promise<void> {
  await tx`
    insert into audit_log (account_id, device_id, request_id, actor, action, subject_id, detail)
    values (${device.account_id}, ${device.id}, ${requestId}, 'user', ${action}, ${howtoId}, ${tx.json(detail)})
  `;
}

export function howToStore(sql: Sql): HowToStore {
  return {
    async saveHowTo({ device, requestId, taskId, name, app, learned, seconds, steps }) {
      return sql.begin(async (tx): Promise<Saved> => {
        await tx`select pg_advisory_xact_lock(hashtextextended(${`howtos:${device.account_id}`}, 0))`;
        const [{ count } = { count: 0 }] = await tx<{ count: number }[]>`select count(*)::int as count from howtos where account_id = ${device.account_id}`;
        if (count >= howToLimits.items) {
          return { kind: "full" };
        }
        if (taskId !== null) {
          const [existing] = await tx`select 1 from howtos where account_id = ${device.account_id} and task_id = ${taskId}`;
          if (existing !== undefined) {
            return { kind: "exists" };
          }
        }
        const [row] = await tx<HowToRow[]>`
          insert into howtos (account_id, device_id, task_id, name, app, learned, seconds, steps)
          values (${device.account_id}, ${device.id}, ${taskId}, ${name}, ${app}, ${learned}, ${seconds}, ${tx.json(stored(steps))})
          returning ${tx.unsafe(columns)}
        `;
        if (row === undefined) {
          throw new Error("How-to insert returned no row");
        }
        await audit(tx, { device, requestId, howtoId: row.id }, "howto.saved", { learned, steps: steps.length, ...(taskId === null ? {} : { task_id: taskId }) });
        return { kind: "saved", howto: toHowTo(row) };
      });
    },

    async howtos(accountId) {
      const rows = await sql.unsafe<HowToRow[]>(
        `select ${columns} from howtos where account_id = $1 order by pinned desc, updated_at desc, id desc limit $2`,
        [accountId, howToLimits.items],
      );
      return rows.map(toHowTo);
    },

    async changeHowTo({ device, requestId, howtoId, name, pinned }) {
      return sql.begin(async (tx) => {
        const [row] = await tx.unsafe<HowToRow[]>(
          `update howtos set name = coalesce($3, name), pinned = coalesce($4, pinned), updated_at = clock_timestamp()
           where id = $1 and account_id = $2
           returning ${columns}`,
          [howtoId, device.account_id, name ?? null, pinned ?? null],
        );
        if (row === undefined) {
          return null;
        }
        await audit(tx, { device, requestId, howtoId }, "howto.changed", { ...(name === undefined ? {} : { renamed: true }), ...(pinned === undefined ? {} : { pinned }) });
        return toHowTo(row);
      });
    },

    async noteHowToStep({ device, requestId, howtoId, number, note }) {
      return sql.begin(async (tx): Promise<Noted> => {
        const [current] = await tx.unsafe<HowToRow[]>(`select ${columns} from howtos where id = $1 and account_id = $2 for update`, [howtoId, device.account_id]);
        if (current === undefined) {
          return { kind: "gone" };
        }
        const howto = toHowTo(current);
        if (!howto.steps.some((step) => step.number === number)) {
          return { kind: "no_step" };
        }
        const steps = howto.steps.map((step) => (step.number === number ? { ...step, note } : step));
        const [row] = await tx<HowToRow[]>`
          update howtos set steps = ${tx.json(stored(steps))}, updated_at = clock_timestamp()
          where id = ${howtoId} and account_id = ${device.account_id}
          returning ${tx.unsafe(columns)}
        `;
        if (row === undefined) {
          return { kind: "gone" };
        }
        await audit(tx, { device, requestId, howtoId }, "howto.noted", { step: number, characters: note?.length ?? 0 });
        return { kind: "noted", howto: toHowTo(row) };
      });
    },

    async howTo(accountId, howtoId) {
      const [row] = await sql.unsafe<HowToRow[]>(`select ${columns} from howtos where id = $1 and account_id = $2`, [howtoId, accountId]);
      return row === undefined ? null : toHowTo(row);
    },

    async startHowTo({ device, requestId, howtoId, taskId, stepByStep }) {
      return sql.begin(async (tx) => {
        const [row] = await tx.unsafe<HowToRow[]>(
          `update howtos set applied = applied + 1, updated_at = clock_timestamp()
           where id = $1 and account_id = $2
           returning ${columns}`,
          [howtoId, device.account_id],
        );
        if (row === undefined) {
          return null;
        }
        await tx`
          insert into howto_runs (task_id, account_id, howto_id, step_by_step)
          values (${taskId}, ${device.account_id}, ${howtoId}, ${stepByStep})
        `;
        await audit(tx, { device, requestId, howtoId }, "howto.applied", { task_id: taskId, step_by_step: stepByStep });
        return toHowTo(row);
      });
    },

    async followedHowTo({ accountId, taskId }) {
      const [row] = await sql<{ name: string; step_by_step: boolean; steps: unknown }[]>`
        select h.name, r.step_by_step, h.steps
        from howto_runs r join howtos h on h.id = r.howto_id
        where r.task_id = ${taskId} and r.account_id = ${accountId}
      `;
      return row === undefined ? null : FollowHowTo.parse(row);
    },

    async howToWorked({ accountId, taskId }) {
      return sql.begin(async (tx) => {
        const [run] = await tx<{ howto_id: string }[]>`
          update howto_runs set worked = true
          where task_id = ${taskId} and account_id = ${accountId} and not worked
          returning howto_id
        `;
        if (run === undefined) {
          return null;
        }
        const [row] = await tx.unsafe<HowToRow[]>(
          `update howtos set worked = least(worked + 1, applied)
           where id = $1 and account_id = $2
           returning ${columns}`,
          [run.howto_id, accountId],
        );
        return row === undefined ? null : toHowTo(row);
      });
    },

    async forgetHowTo({ device, requestId, howtoId }) {
      return sql.begin(async (tx) => {
        const removed = await tx`delete from howtos where id = ${howtoId} and account_id = ${device.account_id}`;
        if (removed.count === 0) {
          return false;
        }
        await audit(tx, { device, requestId, howtoId }, "howto.forgotten", {});
        return true;
      });
    },
  };
}
