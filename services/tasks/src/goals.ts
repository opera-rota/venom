import { PastMove, ScreenMove, screenLimits, TaskMove, type ConfirmDecision, type Effect, type MoveOutcome, type MoveStatus, type Task } from "@venom/contracts";
import type { DeviceRef } from "@venom/db";
import type { Sql } from "postgres";
import { refuseTasks } from "./errors.ts";
import { openTaskStatuses } from "./machine.ts";
import { audit, holdActiveSlot, loadTasks, settle, taskColumns, taskRow, type Actor, type Db, type TaskRow } from "./tasks.ts";

export type Verdict = "go" | "ask" | "refuse";

export interface Proposal {
  readonly intent: string;
  readonly seen: string;
  readonly move: ScreenMove;
  readonly effects: readonly Effect[];
  readonly verdict: Verdict;
  readonly detail: string | null;
}

export interface MoveChange {
  readonly move: TaskMove;
  readonly task: Task;
}

export interface OpenGoal {
  readonly task: Task;
  readonly asking: TaskMove | null;
}

export type GoalEnd = "completed" | "failed" | "cancelled";

export interface Goals {
  begin(device: DeviceRef, targetId: string, goal: string, requestId: string): Promise<Task>;
  open(accountId: string): Promise<OpenGoal | null>;
  state(accountId: string, taskId: string): Promise<Task | null>;
  move(accountId: string, moveId: string): Promise<TaskMove | null>;
  history(accountId: string, taskId: string): Promise<PastMove[]>;
  propose(accountId: string, taskId: string, proposal: Proposal, requestId: string): Promise<MoveChange | null>;
  answer(device: DeviceRef, taskId: string, moveId: string, decision: ConfirmDecision, requestId: string): Promise<MoveChange>;
  finish(accountId: string, moveId: string, outcome: MoveOutcome, detail: string, requestId: string): Promise<MoveChange | null>;
  hold(accountId: string, taskId: string, requestId: string): Promise<Task | null>;
  carryOn(accountId: string, taskId: string, requestId: string): Promise<Task | null>;
  end(accountId: string, taskId: string, status: GoalEnd, result: string, requestId: string): Promise<Task | null>;
}

interface MoveRow {
  readonly id: string;
  readonly task_id: string;
  readonly number: number;
  readonly intent: string;
  readonly seen: string;
  readonly move: Record<string, unknown>;
  readonly effects: Effect[];
  readonly status: MoveStatus;
  readonly detail: string | null;
  readonly created_at: Date;
  readonly finished_at: Date | null;
}

const moveColumns = "id, task_id, number, intent, seen, move, effects, status, detail, created_at, finished_at";

const resultLimit = 600;

function toMove(row: MoveRow): TaskMove {
  return TaskMove.parse({
    id: row.id,
    task_id: row.task_id,
    number: row.number,
    intent: row.intent,
    seen: row.seen,
    move: ScreenMove.parse(row.move),
    effects: row.effects,
    status: row.status,
    detail: row.detail,
    created_at: row.created_at.toISOString(),
    finished_at: row.finished_at?.toISOString() ?? null,
  });
}

function clip(text: string, limit: number): string {
  const clean = text.trim();
  return clean.length <= limit ? clean : `${clean.slice(0, limit - 1)}…`;
}

async function loaded(db: Db, accountId: string, taskId: string): Promise<Task> {
  const task = await settle(db, accountId, taskId);
  if (task === null) {
    throw refuseTasks.taskNotFound();
  }
  return task;
}

async function moveRow(db: Db, accountId: string, moveId: string, lock = false): Promise<MoveRow | null> {
  const [row] = await db.unsafe<MoveRow[]>(`select ${moveColumns} from moves where id = $1 and account_id = $2${lock ? " for update" : ""}`, [moveId, accountId]);
  return row ?? null;
}

export function createGoals({ sql }: { readonly sql: Sql }): Goals {
  const system = (accountId: string): Actor => ({ account_id: accountId, id: null });

  async function change(db: Db, accountId: string, row: MoveRow): Promise<MoveChange> {
    return { move: toMove(row), task: await loaded(db, accountId, row.task_id) };
  }

  return {
    async begin(device, targetId, goal, requestId) {
      return sql.begin(async (tx) => {
        await holdActiveSlot(tx, device.account_id);
        const [task] = await tx.unsafe<TaskRow[]>(
          `insert into tasks (account_id, origin_device_id, target_device_id, request_text, kind, status)
           values ($1, $2, $3, $4, 'goal', 'running')
           returning ${taskColumns}`,
          [device.account_id, device.id, targetId, goal],
        );
        if (task === undefined) {
          throw new Error("Task insert returned no row");
        }
        await audit(tx, device, requestId, "user", "goal.started", task.id, { target: targetId });
        const [created] = await loadTasks(tx, [task]);
        if (created === undefined) {
          throw new Error("Task vanished after insert");
        }
        return created;
      });
    },

    async open(accountId) {
      const [row] = await sql.unsafe<TaskRow[]>(
        `select ${taskColumns} from tasks
         where account_id = $1 and kind = 'goal' and status = any($2::text[])
         order by created_at desc, id desc limit 1`,
        [accountId, [...openTaskStatuses]],
      );
      if (row === undefined) {
        return null;
      }
      const [task] = await loadTasks(sql, [row]);
      const [asking] = await sql.unsafe<MoveRow[]>(`select ${moveColumns} from moves where task_id = $1 and status = 'asking' order by number desc limit 1`, [row.id]);
      return task === undefined ? null : { task, asking: asking === undefined ? null : toMove(asking) };
    },

    async state(accountId, taskId) {
      const row = await taskRow(sql, accountId, taskId);
      return row === null ? null : ((await loadTasks(sql, [row]))[0] ?? null);
    },

    async move(accountId, moveId) {
      const row = await moveRow(sql, accountId, moveId);
      return row === null ? null : toMove(row);
    },

    async history(accountId, taskId) {
      const rows = await sql.unsafe<MoveRow[]>(
        `select ${moveColumns} from (
           select * from moves
           where task_id = $1 and account_id = $2 and status not in ('asking', 'running')
           order by number desc limit $3
         ) recent order by number`,
        [taskId, accountId, screenLimits.moves],
      );
      return rows.map((row) => {
        const move = toMove(row);
        return PastMove.parse({
          intent: move.intent,
          move: move.move,
          outcome: move.status,
          detail: move.detail ?? "No detail was given.",
        });
      });
    },

    async propose(accountId, taskId, { intent, seen, move, effects, verdict, detail }, requestId) {
      return sql.begin(async (tx) => {
        const task = await taskRow(tx, accountId, taskId, true);
        if (task === null || task.kind !== "goal" || task.status !== "running") {
          return null;
        }
        const status: MoveStatus = verdict === "go" ? "running" : verdict === "ask" ? "asking" : "refused";
        const [row] = await tx.unsafe<MoveRow[]>(
          `insert into moves (task_id, account_id, number, intent, seen, move, effects, status, detail, asked_at, started_at, finished_at)
           values (
             $1, $2, (select coalesce(max(number), 0) + 1 from moves where task_id = $1), $3, $4, $5::jsonb, $6::text[], $7, $8,
             case when $7 = 'asking' then clock_timestamp() end,
             case when $7 = 'running' then clock_timestamp() end,
             case when $7 = 'refused' then clock_timestamp() end
           )
           returning ${moveColumns}`,
          [taskId, accountId, clip(intent, screenLimits.intent), clip(seen, screenLimits.seen), sql.json(move), [...effects], status, detail === null ? null : clip(detail, screenLimits.detail)],
        );
        if (row === undefined) {
          throw new Error("Move insert returned no row");
        }
        if (status === "asking") {
          await tx`update tasks set status = 'awaiting_confirmation', updated_at = clock_timestamp() where id = ${taskId}`;
          await audit(tx, system(accountId), requestId, "system", "confirmation.asked", row.id, { move: row.number });
        } else {
          await audit(tx, system(accountId), requestId, "venom", status === "running" ? "move.started" : "move.refused", row.id, { move: row.number, action: move.name });
        }
        return change(tx, accountId, row);
      });
    },

    async answer(device, taskId, moveId, decision, requestId) {
      return sql.begin(async (tx) => {
        const task = await taskRow(tx, device.account_id, taskId, true);
        const row = await moveRow(tx, device.account_id, moveId, true);
        if (task === null || row === null || row.task_id !== taskId) {
          throw refuseTasks.moveNotFound();
        }
        if (row.status !== "asking" || task.status !== "awaiting_confirmation") {
          throw refuseTasks.noLongerWaiting();
        }
        const approved = decision === "approve";
        const [answered] = await tx.unsafe<MoveRow[]>(
          `update moves
           set status = $2, answered_at = clock_timestamp(), answered_by = $3,
               started_at = case when $2 = 'running' then clock_timestamp() end,
               finished_at = case when $2 = 'declined' then clock_timestamp() end,
               detail = case when $2 = 'declined' then 'You said no, so this move never ran.' end
           where id = $1
           returning ${moveColumns}`,
          [moveId, approved ? "running" : "declined", device.id],
        );
        if (answered === undefined) {
          throw refuseTasks.moveNotFound();
        }
        await tx.unsafe(
          `update tasks set status = $2, result = $3, updated_at = clock_timestamp() where id = $1`,
          [taskId, approved ? "running" : "cancelled", approved ? null : "Cancelled because you said no to a move."],
        );
        await audit(tx, device, requestId, "user", "confirmation.answered", moveId, { decision, move: row.number });
        return change(tx, device.account_id, answered);
      });
    },

    async finish(accountId, moveId, outcome, detail, requestId) {
      return sql.begin(async (tx) => {
        const [row] = await tx.unsafe<MoveRow[]>(
          `update moves set status = $3, detail = $4, finished_at = clock_timestamp()
           where id = $1 and account_id = $2 and status = 'running'
           returning ${moveColumns}`,
          [moveId, accountId, outcome, clip(detail, screenLimits.detail)],
        );
        if (row === undefined) {
          return null;
        }
        await audit(tx, system(accountId), requestId, "venom", "move.finished", moveId, { move: row.number, outcome });
        return change(tx, accountId, row);
      });
    },

    async hold(accountId, taskId, requestId) {
      return sql.begin(async (tx) => {
        const [row] = await tx<{ id: string }[]>`
          update tasks set status = 'awaiting_confirmation', updated_at = clock_timestamp()
          where id = ${taskId} and account_id = ${accountId} and kind = 'goal' and status = 'running'
          returning id
        `;
        if (row === undefined) {
          return null;
        }
        await audit(tx, system(accountId), requestId, "system", "goal.waiting", taskId);
        return settle(tx, accountId, taskId);
      });
    },

    async carryOn(accountId, taskId, requestId) {
      return sql.begin(async (tx) => {
        const [row] = await tx<{ id: string }[]>`
          update tasks set status = 'running', updated_at = clock_timestamp()
          where id = ${taskId} and account_id = ${accountId} and kind = 'goal' and status = 'awaiting_confirmation'
            and not exists (select 1 from moves where task_id = ${taskId} and status = 'asking')
          returning id
        `;
        if (row === undefined) {
          return null;
        }
        await audit(tx, system(accountId), requestId, "system", "goal.carried_on", taskId);
        return settle(tx, accountId, taskId);
      });
    },

    async end(accountId, taskId, status, result, requestId) {
      return sql.begin(async (tx) => {
        const [row] = await tx<{ id: string }[]>`
          update tasks set status = ${status}, result = ${clip(result, resultLimit)}, updated_at = clock_timestamp()
          where id = ${taskId} and account_id = ${accountId} and kind = 'goal' and status = any(${openTaskStatuses})
          returning id
        `;
        if (row === undefined) {
          return null;
        }
        await audit(tx, system(accountId), requestId, "venom", `goal.${status}`, taskId);
        return settle(tx, accountId, taskId);
      });
    },
  };
}
