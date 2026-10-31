import type { ConfirmRequest, GatewayEvent, Task } from "@venom/contracts";
import { describe, expect, it } from "vitest";
import { initialTasks, reduceTasks, taskInView, type SafetyEvent, type TasksState } from "../src/renderer/src/tasks-state.ts";

const accountId = "0199d2a0-7c1e-7a3b-9f2d-1a2b3c4d5e01";
const deviceId = "0199d2a0-7c1e-7a3b-9f2d-1a2b3c4d5e02";
const taskId = "0199d2a0-7c1e-7a3b-9f2d-1a2b3c4d5e03";
const stepId = "0199d2a0-7c1e-7a3b-9f2d-1a2b3c4d5e04";
const otherDevice = "0199d2a0-7c1e-7a3b-9f2d-1a2b3c4d5e09";

function task(status: Task["status"], stepStatus: Task["plan"][number]["status"], updatedAt: string, id = taskId): Task {
  return {
    id,
    account_id: accountId,
    origin_device_id: deviceId,
    target_device_id: deviceId,
    request_text: "Safety drill: a step that needs your confirmation",
    plan: [
      {
        id: stepId,
        task_id: id,
        order: 0,
        summary: "Pretend to delete a file (nothing is really deleted)",
        action: "wait",
        target: { kind: "device", device_id: deviceId },
        effects: ["deletes"],
        requires_confirmation: true,
        reversible: false,
        on_failure: "abort",
        status: stepStatus,
        output: null,
      },
    ],
    status,
    result: null,
    created_at: "2026-10-31T19:00:00.000Z",
    updated_at: updatedAt,
  };
}

const request: ConfirmRequest = {
  task_id: taskId,
  step_id: stepId,
  plain_language: "Pretend to delete a file (nothing is really deleted) on Work laptop. This cannot be undone.",
  target_name: "Work laptop",
  reversible: false,
  risk: "high",
  reasons: ["deletes"],
  asked_at: "2026-10-31T19:00:03.000Z",
};

const stamp = { request_id: taskId, sequence: 0, emitted_at: "2026-10-31T19:00:05.000Z" };

function play(events: readonly SafetyEvent[], from: TasksState = initialTasks): TasksState {
  return events.reduce((state, event) => reduceTasks(state, { type: "event", event }), from);
}

describe("tasks state follows the cloud", () => {
  it("keeps the newest copy of a task even when an older event arrives late", () => {
    const state = play([
      { type: "task", ...stamp, task: task("running", "running", "2026-10-31T19:00:06.000Z") },
      { type: "task", ...stamp, task: task("awaiting_confirmation", "waiting", "2026-10-31T19:00:04.000Z") },
    ]);
    expect(state.tasks.get(taskId)?.status).toBe("running");
  });

  it("queues a confirmation once and closes it when answered on another device", () => {
    const asked: GatewayEvent = { type: "confirmation", ...stamp, request, answered: null };
    const answered = {
      type: "confirmation" as const,
      ...stamp,
      request,
      answered: { outcome: "approved" as const, device_id: otherDevice, device_name: "Second laptop", answered_at: "2026-10-31T19:00:07.000Z" },
    };
    const open = play([asked, asked]);
    expect(open.queue).toHaveLength(1);
    const closed = play([answered], open);
    expect(closed.queue).toEqual([]);
    expect(closed.closed.map((entry) => entry.answered.device_name)).toEqual(["Second laptop"]);
    expect(reduceTasks(closed, { type: "seen", stepId }).closed).toEqual([]);
  });

  it("drops the confirmation when its task stops, and keeps the stop record in view", () => {
    const stopped = task("stopped", "pending", "2026-10-31T19:00:09.000Z");
    const state = play([
      { type: "confirmation", ...stamp, request, answered: null },
      { type: "halt", ...stamp, stop_id: stepId, stopped_at: "2026-10-31T19:00:09.000Z", tasks: [stopped] },
      { type: "task", ...stamp, task: stopped },
    ]);
    expect(state.queue).toEqual([]);
    expect(state.halted?.stop_id).toBe(stepId);
    expect(taskInView(state)?.status).toBe("stopped");
  });

  it("does not bring back tasks that ended before the window opened, but shows open ones", () => {
    const finished = task("completed", "done", "2026-10-31T18:00:00.000Z", otherDevice);
    const loaded = reduceTasks(initialTasks, { type: "list", list: { tasks: [finished], confirmations: [] } });
    expect(taskInView(loaded)).toBeNull();
    const running = reduceTasks(loaded, { type: "list", list: { tasks: [finished, task("running", "running", "2026-10-31T19:00:00.000Z")], confirmations: [] } });
    expect(taskInView(running)?.id).toBe(taskId);
  });
});
