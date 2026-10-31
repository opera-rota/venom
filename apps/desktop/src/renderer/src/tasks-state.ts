import type { ConfirmationAnswered, ConfirmationEvent, ConfirmRequest, GatewayEvent, HaltEvent, Task, TaskEvent, TaskList } from "@venom/contracts";

export type SafetyEvent = TaskEvent | ConfirmationEvent | HaltEvent;

export interface Closed {
  readonly request: ConfirmRequest;
  readonly answered: ConfirmationAnswered;
}

export interface TasksState {
  readonly tasks: ReadonlyMap<string, Task>;
  readonly queue: readonly ConfirmRequest[];
  readonly closed: readonly Closed[];
  readonly halted: HaltEvent | null;
  readonly dismissed: ReadonlySet<string>;
}

export type TasksAction =
  | { readonly type: "list"; readonly list: TaskList }
  | { readonly type: "event"; readonly event: SafetyEvent }
  | { readonly type: "task"; readonly task: Task }
  | { readonly type: "dismiss"; readonly taskId: string }
  | { readonly type: "seen"; readonly stepId: string };

export const initialTasks: TasksState = {
  tasks: new Map(),
  queue: [],
  closed: [],
  halted: null,
  dismissed: new Set(),
};

const safetyEvents: ReadonlySet<GatewayEvent["type"]> = new Set(["task", "confirmation", "halt"]);

const openStatuses: ReadonlySet<Task["status"]> = new Set(["running", "awaiting_confirmation"]);

export function isSafetyEvent(event: GatewayEvent): event is SafetyEvent {
  return safetyEvents.has(event.type);
}

export function isOpen(task: Task): boolean {
  return openStatuses.has(task.status);
}

function newer(current: Task | undefined, incoming: Task): boolean {
  return current === undefined || incoming.updated_at >= current.updated_at;
}

function withTasks(tasks: ReadonlyMap<string, Task>, incoming: readonly Task[]): ReadonlyMap<string, Task> {
  const next = new Map(tasks);
  for (const task of incoming) {
    if (newer(next.get(task.id), task)) {
      next.set(task.id, task);
    }
  }
  return next;
}

function byAsked(left: ConfirmRequest, right: ConfirmRequest): number {
  return left.asked_at.localeCompare(right.asked_at);
}

function withoutStep(queue: readonly ConfirmRequest[], stepId: string): readonly ConfirmRequest[] {
  return queue.filter((request) => request.step_id !== stepId);
}

function apply(state: TasksState, event: SafetyEvent): TasksState {
  switch (event.type) {
    case "task": {
      const tasks = withTasks(state.tasks, [event.task]);
      const queue = isOpen(event.task) ? state.queue : state.queue.filter((request) => request.task_id !== event.task.id);
      return { ...state, tasks, queue };
    }
    case "halt":
      return { ...state, tasks: withTasks(state.tasks, event.tasks), halted: event };
    case "confirmation": {
      const { request, answered } = event;
      if (answered === null) {
        const known = state.queue.some((entry) => entry.step_id === request.step_id);
        return known ? state : { ...state, queue: [...state.queue, request].sort(byAsked) };
      }
      return {
        ...state,
        queue: withoutStep(state.queue, request.step_id),
        closed: [...state.closed.filter((entry) => entry.request.step_id !== request.step_id), { request, answered }].slice(-10),
      };
    }
  }
}

export function reduceTasks(state: TasksState, action: TasksAction): TasksState {
  switch (action.type) {
    case "list": {
      const settledBefore = action.list.tasks.filter((task) => !isOpen(task) && !state.tasks.has(task.id)).map((task) => task.id);
      return {
        ...state,
        tasks: withTasks(new Map(), action.list.tasks),
        queue: [...action.list.confirmations].sort(byAsked),
        dismissed: new Set([...state.dismissed, ...settledBefore]),
      };
    }
    case "event":
      return apply(state, action.event);
    case "task":
      return { ...state, tasks: withTasks(state.tasks, [action.task]) };
    case "dismiss":
      return { ...state, dismissed: new Set(state.dismissed).add(action.taskId) };
    case "seen":
      return { ...state, closed: state.closed.filter((entry) => entry.request.step_id !== action.stepId) };
  }
}

export function taskInView(state: TasksState): Task | null {
  const candidates = [...state.tasks.values()].filter((task) => !state.dismissed.has(task.id));
  const open = candidates.filter(isOpen).sort((left, right) => right.created_at.localeCompare(left.created_at));
  if (open[0] !== undefined) {
    return open[0];
  }
  const latest = candidates.sort((left, right) => right.updated_at.localeCompare(left.updated_at))[0];
  return latest ?? null;
}

export type TaskGroupName = "needs_you" | "running" | "finished" | "failed" | "stopped";

export interface TaskGroup {
  readonly name: TaskGroupName;
  readonly title: string;
  readonly tasks: readonly Task[];
}

const groupOf: Record<Task["status"], TaskGroupName> = {
  awaiting_confirmation: "needs_you",
  created: "running",
  planned: "running",
  running: "running",
  completed: "finished",
  failed: "failed",
  stopped: "stopped",
  cancelled: "stopped",
};

const groupTitles: readonly (readonly [TaskGroupName, string])[] = [
  ["needs_you", "Needs you"],
  ["running", "Running"],
  ["finished", "Finished"],
  ["failed", "Failed"],
  ["stopped", "Stopped"],
];

export function taskGroups(state: TasksState): readonly TaskGroup[] {
  const newestFirst = [...state.tasks.values()].sort((left, right) => right.created_at.localeCompare(left.created_at));
  return groupTitles
    .map(([name, title]) => ({ name, title, tasks: newestFirst.filter((task) => groupOf[task.status] === name) }))
    .filter((group) => group.tasks.length > 0);
}

export interface TaskCount {
  readonly open: number;
  readonly needsYou: boolean;
}

export function taskCount(state: TasksState): TaskCount {
  const open = [...state.tasks.values()].filter(isOpen);
  return { open: open.length, needsYou: open.some((task) => task.status === "awaiting_confirmation") };
}
