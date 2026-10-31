import {
  ConfirmationAnswered,
  ConfirmRequest,
  DeviceAction,
  progressOf,
  safetyLimits,
  StopReceipt,
  Task,
  TaskList,
  type CommandOutcome,
  type ConfirmationStrictness,
  type ConfirmDecision,
  type DrillKind,
  type Effect,
  type StepAction,
  type StepStatus,
  type StopRequest,
  type StopScope,
  type TaskControl,
  type TaskStatus,
} from "@venom/contracts";
import type { DeviceRef } from "@venom/db";
import { assess, drills, plainLanguage } from "@venom/safety";
import type { Sql, TransactionSql } from "postgres";
import { refuseTasks } from "./errors.ts";
import { openTaskStatuses, repeatable, resumableTaskStatuses } from "./machine.ts";

export const activeTaskLimit = 3;

const haltedRecentlySeconds = 10;

export interface NextStep {
  readonly id: string;
  readonly action: DeviceAction;
  readonly targetDeviceId: string;
  readonly targetName: string;
  readonly requiresConfirmation: boolean;
  readonly approved: boolean;
  readonly waiting: boolean;
}

export type Next =
  | { readonly kind: "over" }
  | { readonly kind: "finished" }
  | { readonly kind: "come_back"; readonly stepId: string }
  | { readonly kind: "step"; readonly step: NextStep };

export interface Asked {
  readonly task: Task;
  readonly request: ConfirmRequest;
}

export interface Answered extends Asked {
  readonly answered: ConfirmationAnswered;
}

export interface Stopped {
  readonly receipt: StopReceipt;
  readonly closed: readonly ConfirmRequest[];
}

export interface Controlled {
  readonly task: Task;
  readonly run: boolean;
}

export interface Tasks {
  drill(device: DeviceRef, kind: DrillKind, requestId: string): Promise<Task>;
  get(accountId: string, taskId: string): Promise<Task | null>;
  list(accountId: string): Promise<TaskList>;
  next(accountId: string, taskId: string): Promise<Next>;
  comeBack(accountId: string, stepId: string, requestId: string): Promise<Task | null>;
  ask(accountId: string, stepId: string, requestId: string): Promise<Asked | null>;
  answer(device: DeviceRef, taskId: string, stepId: string, decision: ConfirmDecision, requestId: string): Promise<Answered>;
  start(accountId: string, stepId: string, requestId: string): Promise<Task | null>;
  finish(accountId: string, stepId: string, outcome: CommandOutcome, detail: string, requestId: string): Promise<Task | null>;
  complete(accountId: string, taskId: string, requestId: string): Promise<Task | null>;
  control(device: DeviceRef, taskId: string, control: TaskControl, requestId: string): Promise<Controlled>;
  stop(device: DeviceRef, request: StopRequest, requestId: string): Promise<Stopped>;
  interruptAll(): Promise<number>;
  strictness(accountId: string): Promise<ConfirmationStrictness>;
  setStrictness(device: DeviceRef, strictness: ConfirmationStrictness, requestId: string): Promise<ConfirmationStrictness>;
}

interface TaskRow {
  readonly id: string;
  readonly account_id: string;
  readonly origin_device_id: string;
  readonly target_device_id: string | null;
  readonly request_text: string;
  readonly status: TaskStatus;
  readonly result: string | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}

interface StepRow {
  readonly id: string;
  readonly task_id: string;
  readonly position: number;
  readonly summary: string;
  readonly action: StepAction;
  readonly params: Record<string, unknown>;
  readonly target_device_id: string;
  readonly target_name: string;
  readonly effects: Effect[];
  readonly requires_confirmation: boolean;
  readonly reversible: boolean;
  readonly on_failure: string;
  readonly status: StepStatus;
  readonly output: string | null;
  readonly set_aside_reason: string | null;
  readonly asked_at: Date | null;
  readonly answered_at: Date | null;
  readonly started_at: Date | null;
  readonly finished_at: Date | null;
}

type Db = Sql | TransactionSql;

type Actor = DeviceRef | { readonly account_id: string; readonly id: null };

const finishedAs: Record<CommandOutcome, "done" | "stopped" | "failed"> = {
  done: "done",
  stopped: "stopped",
  failed: "failed",
  refused: "failed",
};

const taskColumns = "id, account_id, origin_device_id, target_device_id, request_text, status, result, created_at, updated_at";

function count(total: number, one: string, many = `${one}s`): string {
  return `${total} ${total === 1 ? one : many}`;
}

function setAside(steps: readonly StepRow[]): string {
  const skipped = steps.filter((step) => step.status === "skipped").length;
  const ignored = steps.filter((step) => step.status === "ignored").length;
  return [skipped > 0 ? `, ${skipped} skipped` : "", ignored > 0 ? `, ${ignored} ignored` : ""].join("");
}

function describe(status: TaskStatus, steps: readonly StepRow[]): string | null {
  const done = steps.filter((step) => step.status === "done").length;
  const stopped = steps.filter((step) => step.status === "stopped").length;
  const waiting = steps.filter((step) => step.status === "pending" || step.status === "waiting").length;
  const running = steps.filter((step) => step.status === "running").length;
  const aside = setAside(steps);
  switch (status) {
    case "completed":
      return `Finished. ${count(done, "step")} done${aside}.`;
    case "stopped":
      return `Stopped. ${done} finished, ${stopped + running} stopped${running > 0 ? " (stopping now)" : ""}, ${waiting} never started${aside}.`;
    case "cancelled":
      return `Cancelled because you declined a step. ${done} finished before that, ${waiting} never started${aside}.`;
    case "failed": {
      const failed = steps.find((step) => step.status === "failed");
      return `Failed. ${failed?.output ?? "A step did not finish."} ${done} finished before that${aside}.`;
    }
    default:
      return null;
  }
}

function toTask(row: TaskRow, steps: readonly StepRow[]): Task {
  return Task.parse({
    id: row.id,
    account_id: row.account_id,
    origin_device_id: row.origin_device_id,
    target_device_id: row.target_device_id,
    request_text: row.request_text,
    plan: steps.map((step) => ({
      id: step.id,
      task_id: step.task_id,
      order: step.position,
      summary: step.summary,
      action: step.action,
      target: { kind: "device", device_id: step.target_device_id },
      effects: step.effects,
      requires_confirmation: step.requires_confirmation,
      reversible: step.reversible,
      on_failure: step.on_failure,
      status: step.status,
      output: step.output,
      set_aside_reason: step.set_aside_reason,
      repeatable: repeatable(step),
    })),
    status: row.status,
    progress: progressOf(steps.map((step) => step.status)),
    result: row.result,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  });
}

function toRequest(step: StepRow, strictness: ConfirmationStrictness): ConfirmRequest {
  const { risk, reasons } = assess(step, strictness);
  return ConfirmRequest.parse({
    task_id: step.task_id,
    step_id: step.id,
    plain_language: plainLanguage(step.summary, step.target_name, step.reversible),
    target_name: step.target_name,
    reversible: step.reversible,
    risk,
    reasons,
    asked_at: (step.asked_at ?? new Date()).toISOString(),
  });
}

async function loadSteps(db: Db, taskIds: readonly string[]): Promise<StepRow[]> {
  if (taskIds.length === 0) {
    return [];
  }
  return db<StepRow[]>`
    select s.id, s.task_id, s.position, s.summary, s.action, s.params, s.target_device_id, d.name as target_name,
           s.effects, s.requires_confirmation, s.reversible, s.on_failure, s.status, s.output, s.set_aside_reason,
           s.asked_at, s.answered_at, s.started_at, s.finished_at
    from steps s join devices d on d.id = s.target_device_id
    where s.task_id = any(${taskIds}::uuid[])
    order by s.task_id, s.position
  `;
}

async function loadTasks(db: Db, rows: readonly TaskRow[]): Promise<Task[]> {
  const steps = await loadSteps(
    db,
    rows.map((row) => row.id),
  );
  return rows.map((row) =>
    toTask(
      row,
      steps.filter((step) => step.task_id === row.id),
    ),
  );
}

async function taskRow(db: Db, accountId: string, taskId: string, lock = false): Promise<TaskRow | null> {
  const [row] = await db.unsafe<TaskRow[]>(`select ${taskColumns} from tasks where id = $1 and account_id = $2${lock ? " for update" : ""}`, [taskId, accountId]);
  return row ?? null;
}

async function settle(db: Db, accountId: string, taskId: string): Promise<Task | null> {
  const row = await taskRow(db, accountId, taskId);
  if (row === null) {
    return null;
  }
  const steps = await loadSteps(db, [row.id]);
  const result = describe(row.status, steps);
  if (result === row.result) {
    return toTask(row, steps);
  }
  const [updated] = await db.unsafe<TaskRow[]>(`update tasks set result = $1, updated_at = clock_timestamp() where id = $2 returning ${taskColumns}`, [result, row.id]);
  return updated === undefined ? null : toTask(updated, steps);
}

async function settled(db: Db, accountId: string, taskId: string): Promise<Task> {
  const task = await settle(db, accountId, taskId);
  if (task === null) {
    throw refuseTasks.taskNotFound();
  }
  return task;
}

async function audit(db: Db, actor: Actor, requestId: string | null, kind: "user" | "venom" | "system", action: string, subjectId: string, detail: Record<string, string | number | boolean | null> = {}): Promise<void> {
  await db`
    insert into audit_log (account_id, device_id, request_id, actor, action, subject_id, detail)
    values (${actor.account_id}, ${actor.id}, ${requestId}, ${kind}, ${action}, ${subjectId}, ${db.json(detail)})
  `;
}

async function readStrictness(db: Db, accountId: string): Promise<ConfirmationStrictness> {
  const [row] = await db<{ confirmation_strictness: ConfirmationStrictness }[]>`select confirmation_strictness from accounts where id = ${accountId}`;
  return row?.confirmation_strictness ?? "standard";
}

async function holdActiveSlot(db: TransactionSql, accountId: string): Promise<void> {
  await db`select pg_advisory_xact_lock(hashtextextended(${accountId}::text, 5))`;
  const [active] = await db<{ total: number }[]>`
    select count(*)::int as total from tasks where account_id = ${accountId} and status = any(${openTaskStatuses})
  `;
  if ((active?.total ?? 0) >= activeTaskLimit) {
    throw refuseTasks.tooManyTasks(activeTaskLimit);
  }
}

function scopeFilter(db: Db, scope: StopScope) {
  switch (scope.kind) {
    case "all":
      return db``;
    case "task":
      return db`and id = ${scope.task_id}`;
    case "device":
      return db`and target_device_id = ${scope.device_id}`;
  }
}

function findStep(steps: readonly StepRow[], stepId: string): StepRow {
  const step = steps.find((candidate) => candidate.id === stepId);
  if (step === undefined) {
    throw refuseTasks.stepNotFound();
  }
  return step;
}

async function resetToPending(db: Db, stepIds: readonly string[]): Promise<void> {
  if (stepIds.length > 0) {
    await db`
      update steps
      set status = 'pending', output = null, started_at = null, finished_at = null, asked_at = null, answered_at = null, answered_by = null
      where id = any(${stepIds}::uuid[])
    `;
  }
}

async function resume(db: TransactionSql, device: DeviceRef, task: TaskRow, steps: readonly StepRow[], requestId: string): Promise<Controlled> {
  if (task.status === "completed") {
    throw refuseTasks.finished();
  }
  if (!resumableTaskStatuses.includes(task.status)) {
    throw refuseTasks.alreadyRunning();
  }
  if (steps.some((step) => step.status === "running")) {
    throw refuseTasks.stillStopping();
  }
  const unfinished = steps.filter((step) => step.status === "stopped" || step.status === "failed");
  const unsafe = unfinished.find((step) => step.started_at !== null && !repeatable(step));
  if (unsafe !== undefined) {
    throw refuseTasks.notRepeatable(unsafe.position);
  }
  await holdActiveSlot(db, device.account_id);
  await resetToPending(
    db,
    unfinished.map((step) => step.id),
  );
  await db`update tasks set status = 'running', stop_id = null, updated_at = clock_timestamp() where id = ${task.id}`;
  await audit(db, device, requestId, "user", "task.resumed", task.id, { steps: unfinished.length });
  return { task: await settled(db, device.account_id, task.id), run: true };
}

async function markSetAside(db: Db, device: DeviceRef, step: StepRow, status: "skipped" | "ignored", reason: string, requestId: string): Promise<void> {
  await db`
    update steps
    set status = ${status}, set_aside_reason = ${reason}, set_aside_at = clock_timestamp(), set_aside_by = ${device.id}
    where id = ${step.id}
  `;
  await audit(db, device, requestId, "user", status === "skipped" ? "step.skipped" : "step.ignored", step.id);
}

export function createTasks({ sql }: { readonly sql: Sql }): Tasks {
  const system = (accountId: string): Actor => ({ account_id: accountId, id: null });

  return {
    async drill(device, kind, requestId) {
      const plan = drills[kind];
      return sql.begin(async (tx) => {
        await holdActiveSlot(tx, device.account_id);
        const strictness = await readStrictness(tx, device.account_id);
        const [task] = await tx<TaskRow[]>`
          insert into tasks (account_id, origin_device_id, target_device_id, request_text, status)
          values (${device.account_id}, ${device.id}, ${device.id}, ${plan.requestText}, 'running')
          returning id, account_id, origin_device_id, target_device_id, request_text, status, result, created_at, updated_at
        `;
        if (task === undefined) {
          throw new Error("Task insert returned no row");
        }
        for (const [position, step] of plan.steps.entries()) {
          const { requiresConfirmation } = assess(step, strictness);
          await tx`
            insert into steps (task_id, account_id, position, summary, action, params, target_device_id, effects, requires_confirmation, reversible, on_failure)
            values (
              ${task.id}, ${device.account_id}, ${position}, ${step.summary}, ${step.action}, ${tx.json({ seconds: step.seconds })},
              ${device.id}, ${[...step.effects]}, ${requiresConfirmation}, ${step.reversible}, ${step.onFailure}
            )
          `;
        }
        await audit(tx, device, requestId, "user", "task.created", task.id, { drill: kind, steps: plan.steps.length, strictness });
        const [loaded] = await loadTasks(tx, [task]);
        if (loaded === undefined) {
          throw new Error("Task vanished after insert");
        }
        return loaded;
      });
    },

    async get(accountId, taskId) {
      const row = await taskRow(sql, accountId, taskId);
      return row === null ? null : ((await loadTasks(sql, [row]))[0] ?? null);
    },

    async list(accountId) {
      const rows = await sql.unsafe<TaskRow[]>(
        `select ${taskColumns} from tasks where account_id = $1 order by created_at desc, id desc limit $2`,
        [accountId, safetyLimits.recentTasks],
      );
      const tasks = await loadTasks(sql, rows);
      const strictness = await readStrictness(sql, accountId);
      const waiting = await loadSteps(
        sql,
        rows.filter((row) => row.status === "awaiting_confirmation").map((row) => row.id),
      );
      return TaskList.parse({
        tasks,
        confirmations: waiting.filter((step) => step.status === "waiting").map((step) => toRequest(step, strictness)),
      });
    },

    async next(accountId, taskId) {
      const row = await taskRow(sql, accountId, taskId);
      if (row === null || !openTaskStatuses.includes(row.status)) {
        return { kind: "over" };
      }
      const steps = await loadSteps(sql, [row.id]);
      const step = steps.find((candidate) => candidate.status === "pending" || candidate.status === "waiting");
      if (step === undefined) {
        const skipped = steps.find((candidate) => candidate.status === "skipped");
        if (skipped !== undefined) {
          return { kind: "come_back", stepId: skipped.id };
        }
        return steps.every((candidate) => candidate.status === "done" || candidate.status === "ignored") ? { kind: "finished" } : { kind: "over" };
      }
      return {
        kind: "step",
        step: {
          id: step.id,
          action: DeviceAction.parse({ name: step.action, ...step.params }),
          targetDeviceId: step.target_device_id,
          targetName: step.target_name,
          requiresConfirmation: step.requires_confirmation,
          approved: step.answered_at !== null,
          waiting: step.status === "waiting",
        },
      };
    },

    async comeBack(accountId, stepId, requestId) {
      return sql.begin(async (tx) => {
        const [step] = await tx<{ task_id: string }[]>`
          update steps s set status = 'pending', set_aside_reason = null, set_aside_at = null, set_aside_by = null
          from tasks t
          where s.id = ${stepId} and s.account_id = ${accountId} and s.status = 'skipped'
            and t.id = s.task_id and t.status = 'running'
          returning s.task_id
        `;
        if (step === undefined) {
          return null;
        }
        await audit(tx, system(accountId), requestId, "venom", "step.came_back", stepId);
        return settle(tx, accountId, step.task_id);
      });
    },

    async ask(accountId, stepId, requestId) {
      return sql.begin(async (tx) => {
        const [step] = await tx<{ task_id: string }[]>`
          update steps s set status = 'waiting', asked_at = clock_timestamp()
          from tasks t
          where s.id = ${stepId} and s.account_id = ${accountId} and s.status = 'pending' and s.requires_confirmation and s.answered_at is null
            and t.id = s.task_id and t.status = 'running'
          returning s.task_id
        `;
        if (step === undefined) {
          return null;
        }
        await tx`update tasks set status = 'awaiting_confirmation', updated_at = clock_timestamp() where id = ${step.task_id}`;
        await audit(tx, system(accountId), requestId, "system", "confirmation.asked", stepId);
        const task = await settle(tx, accountId, step.task_id);
        const [waiting] = (await loadSteps(tx, [step.task_id])).filter((candidate) => candidate.id === stepId);
        if (task === null || waiting === undefined) {
          return null;
        }
        return { task, request: toRequest(waiting, await readStrictness(tx, accountId)) };
      });
    },

    async answer(device, taskId, stepId, decision, requestId) {
      return sql.begin(async (tx) => {
        const task = await taskRow(tx, device.account_id, taskId, true);
        if (task === null) {
          throw refuseTasks.taskNotFound();
        }
        const [step] = await tx<{ status: string; answered_by_name: string | null }[]>`
          select s.status, d.name as answered_by_name
          from steps s left join devices d on d.id = s.answered_by
          where s.id = ${stepId} and s.task_id = ${taskId}
        `;
        if (step === undefined) {
          throw refuseTasks.taskNotFound();
        }
        if (step.status !== "waiting") {
          throw step.answered_by_name === null ? refuseTasks.noLongerWaiting() : refuseTasks.alreadyAnswered(step.answered_by_name);
        }
        const approved = decision === "approve";
        await tx`
          update steps
          set status = ${approved ? "pending" : "stopped"},
              output = ${approved ? null : "You declined this step, so it never ran."},
              finished_at = ${approved ? null : tx`clock_timestamp()`},
              answered_at = clock_timestamp(),
              answered_by = ${device.id}
          where id = ${stepId}
        `;
        await tx`update tasks set status = ${approved ? "running" : "cancelled"}, updated_at = clock_timestamp() where id = ${taskId}`;
        await audit(tx, device, requestId, "user", "confirmation.answered", stepId, { decision });
        const current = await settle(tx, device.account_id, taskId);
        const [answeredStep] = (await loadSteps(tx, [taskId])).filter((candidate) => candidate.id === stepId);
        const [who] = await tx<{ name: string; answered_at: Date }[]>`
          select d.name, s.answered_at from steps s join devices d on d.id = s.answered_by where s.id = ${stepId}
        `;
        if (current === null || answeredStep === undefined || who === undefined) {
          throw refuseTasks.taskNotFound();
        }
        return {
          task: current,
          request: toRequest({ ...answeredStep, status: "waiting" }, await readStrictness(tx, device.account_id)),
          answered: ConfirmationAnswered.parse({
            outcome: approved ? "approved" : "declined",
            device_id: device.id,
            device_name: who.name,
            answered_at: who.answered_at.toISOString(),
          }),
        };
      });
    },

    async start(accountId, stepId, requestId) {
      return sql.begin(async (tx) => {
        const [step] = await tx<{ task_id: string }[]>`
          update steps s set status = 'running', started_at = clock_timestamp()
          from tasks t
          where s.id = ${stepId} and s.account_id = ${accountId} and s.status = 'pending'
            and (not s.requires_confirmation or s.answered_at is not null)
            and t.id = s.task_id and t.status = 'running'
          returning s.task_id
        `;
        if (step === undefined) {
          return null;
        }
        await audit(tx, system(accountId), requestId, "venom", "step.started", stepId);
        return settle(tx, accountId, step.task_id);
      });
    },

    async finish(accountId, stepId, outcome, detail, requestId) {
      return sql.begin(async (tx) => {
        const status = finishedAs[outcome];
        const [step] = await tx<{ task_id: string }[]>`
          update steps s
          set status = case when ${status} = 'failed' and t.status = 'stopped' then 'stopped' else ${status} end,
              output = ${detail},
              finished_at = clock_timestamp()
          from tasks t
          where s.id = ${stepId} and s.account_id = ${accountId} and s.status = 'running' and t.id = s.task_id
          returning s.task_id
        `;
        if (step === undefined) {
          return null;
        }
        if (status !== "done") {
          await tx`update tasks set status = ${status}, updated_at = clock_timestamp() where id = ${step.task_id} and status = any(${openTaskStatuses})`;
        }
        await audit(tx, system(accountId), requestId, "venom", "step.finished", stepId, { outcome });
        return settle(tx, accountId, step.task_id);
      });
    },

    async complete(accountId, taskId, requestId) {
      return sql.begin(async (tx) => {
        const [row] = await tx<{ id: string }[]>`
          update tasks set status = 'completed', updated_at = clock_timestamp()
          where id = ${taskId} and account_id = ${accountId} and status = 'running'
            and not exists (select 1 from steps where task_id = ${taskId} and status not in ('done', 'ignored'))
          returning id
        `;
        if (row === undefined) {
          return null;
        }
        await audit(tx, system(accountId), requestId, "venom", "task.completed", taskId);
        return settle(tx, accountId, taskId);
      });
    },

    async control(device, taskId, control, requestId) {
      return sql.begin(async (tx) => {
        const task = await taskRow(tx, device.account_id, taskId, true);
        if (task === null) {
          throw refuseTasks.taskNotFound();
        }
        const steps = await loadSteps(tx, [task.id]);
        if (control.kind === "resume") {
          return resume(tx, device, task, steps, requestId);
        }
        if (task.status === "completed") {
          throw refuseTasks.finished();
        }
        const step = findStep(steps, control.step_id);
        switch (control.kind) {
          case "retry":
            if (step.status !== "failed") {
              throw refuseTasks.cannotRetry();
            }
            if (!repeatable(step)) {
              throw refuseTasks.notRepeatable(step.position);
            }
            return resume(tx, device, task, steps, requestId);
          case "skip":
            if (!(step.status === "pending" || (step.status === "failed" && repeatable(step)))) {
              throw refuseTasks.cannotSkip();
            }
            await markSetAside(tx, device, step, "skipped", control.reason, requestId);
            break;
          case "ignore":
            if (!(step.status === "pending" || step.status === "skipped" || step.status === "failed")) {
              throw refuseTasks.cannotIgnore();
            }
            if (steps.filter((candidate) => candidate.status !== "ignored").length <= 1) {
              throw refuseTasks.lastCounted();
            }
            await markSetAside(tx, device, step, "ignored", control.reason, requestId);
            break;
          case "restore": {
            if (step.status !== "skipped" && step.status !== "ignored") {
              throw refuseTasks.cannotRestore();
            }
            const back = step.status === "ignored" && step.finished_at !== null ? "failed" : "pending";
            await tx`
              update steps set status = ${back}, set_aside_reason = null, set_aside_at = null, set_aside_by = null
              where id = ${step.id}
            `;
            await audit(tx, device, requestId, "user", "step.restored", step.id);
            break;
          }
        }
        await tx`update tasks set updated_at = clock_timestamp() where id = ${task.id}`;
        return { task: await settled(tx, device.account_id, task.id), run: false };
      });
    },

    async stop(device, { stop_id, scope }, requestId) {
      return sql.begin(async (tx) => {
        const [inserted] = await tx<{ account_id: string; stopped_at: Date }[]>`
          insert into stops (id, account_id, device_id, scope) values (${stop_id}, ${device.account_id}, ${device.id}, ${tx.json(scope)})
          on conflict (id) do nothing
          returning account_id, stopped_at
        `;
        const [existing] = inserted === undefined ? await tx<{ account_id: string; stopped_at: Date }[]>`select account_id, stopped_at from stops where id = ${stop_id}` : [inserted];
        if (existing === undefined || existing.account_id !== device.account_id) {
          throw refuseTasks.stopTaken();
        }
        const stopped = await tx<{ id: string }[]>`
          update tasks set status = 'stopped', stop_id = ${stop_id}, updated_at = clock_timestamp()
          where account_id = ${device.account_id}
            and (
              status = any(${openTaskStatuses})
              or (status = 'stopped' and stop_id is null and updated_at > clock_timestamp() - make_interval(secs => ${haltedRecentlySeconds}))
            )
            ${scopeFilter(tx, scope)}
          returning id
        `;
        const strictness = await readStrictness(tx, device.account_id);
        const closing = (await loadSteps(
          tx,
          stopped.map((row) => row.id),
        )).filter((step) => step.status === "waiting");
        if (closing.length > 0) {
          await tx`update steps set status = 'pending' where id = any(${closing.map((step) => step.id)}::uuid[])`;
        }
        if (inserted !== undefined) {
          await audit(tx, device, requestId, "user", "safety.stopped", stop_id, { scope: scope.kind, tasks: stopped.length });
        }
        const rows = await tx.unsafe<TaskRow[]>(`select ${taskColumns} from tasks where stop_id = $1 and account_id = $2 order by created_at`, [stop_id, device.account_id]);
        const tasks: Task[] = [];
        for (const row of rows) {
          const current = await settle(tx, device.account_id, row.id);
          if (current !== null) {
            tasks.push(current);
          }
        }
        return {
          receipt: StopReceipt.parse({ stop_id, stopped_at: existing.stopped_at.toISOString(), tasks }),
          closed: closing.map((step) => toRequest(step, strictness)),
        };
      });
    },

    async interruptAll() {
      return sql.begin(async (tx) => {
        const rows = await tx<{ id: string; account_id: string }[]>`
          update tasks set status = 'failed', updated_at = clock_timestamp()
          where status = any(${openTaskStatuses})
          returning id, account_id
        `;
        if (rows.length === 0) {
          return 0;
        }
        const ids = rows.map((row) => row.id);
        await tx`
          update steps set status = 'failed', output = 'VENOM restarted before this step finished.', finished_at = clock_timestamp()
          where task_id = any(${ids}::uuid[]) and status = 'running'
        `;
        await tx`update steps set status = 'pending' where task_id = any(${ids}::uuid[]) and status = 'waiting'`;
        for (const row of rows) {
          await audit(tx, system(row.account_id), null, "system", "task.interrupted", row.id);
          await settle(tx, row.account_id, row.id);
        }
        return rows.length;
      });
    },

    async strictness(accountId) {
      return readStrictness(sql, accountId);
    },

    async setStrictness(device, strictness, requestId) {
      return sql.begin(async (tx) => {
        await tx`update accounts set confirmation_strictness = ${strictness} where id = ${device.account_id}`;
        await audit(tx, device, requestId, "user", "settings.safety_changed", device.account_id, { confirmation_strictness: strictness });
        return strictness;
      });
    },
  };
}
