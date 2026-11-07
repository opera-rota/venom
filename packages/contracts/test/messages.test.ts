import { describe, expect, it } from "vitest";
import { Message } from "../src/index.ts";

const base = {
  id: "0199d2a0-7c1e-7a3b-9f2d-1a2b3c4d5e11",
  account_id: "0199d2a0-7c1e-7a3b-9f2d-1a2b3c4d5e01",
  device_id: "0199d2a0-7c1e-7a3b-9f2d-1a2b3c4d5e02",
  text: "Hello",
  created_at: "2026-11-03T19:00:00.000Z",
};
const task = "0199d2a0-7c1e-7a3b-9f2d-1a2b3c4d5e03";
const step = "0199d2a0-7c1e-7a3b-9f2d-1a2b3c4d5e05";

describe("a message links to a task and a step exactly as its kind says", () => {
  it.each([
    ["user", "text", null, null],
    ["venom", "text", null, null],
    ["venom", "plan", task, null],
    ["venom", "report", task, null],
    ["venom", "question", task, step],
  ] as const)("accepts %s %s", (speaker, kind, task_id, step_id) => {
    expect(Message.safeParse({ ...base, speaker, kind, task_id, step_id }).success).toBe(true);
  });

  it.each([
    ["venom", "text", task, null],
    ["venom", "plan", null, null],
    ["venom", "plan", task, step],
    ["venom", "report", null, null],
    ["venom", "question", task, null],
    ["user", "plan", task, null],
    ["user", "question", task, step],
  ] as const)("refuses %s %s with task %s and step %s", (speaker, kind, task_id, step_id) => {
    expect(Message.safeParse({ ...base, speaker, kind, task_id, step_id }).success).toBe(false);
  });
});
