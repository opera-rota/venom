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
const move = "0199d2a0-7c1e-7a3b-9f2d-1a2b3c4d5e06";

describe("a message links to a task, a step or a move exactly as its kind says", () => {
  it.each([
    ["user", "text", null, null, null],
    ["venom", "text", null, null, null],
    ["venom", "plan", task, null, null],
    ["venom", "report", task, null, null],
    ["venom", "question", task, step, null],
    ["venom", "question", task, null, move],
  ] as const)("accepts %s %s with task %s, step %s and move %s", (speaker, kind, task_id, step_id, move_id) => {
    expect(Message.safeParse({ ...base, speaker, kind, task_id, step_id, move_id }).success).toBe(true);
  });

  it.each([
    ["venom", "text", task, null, null],
    ["venom", "text", null, null, move],
    ["venom", "plan", null, null, null],
    ["venom", "plan", task, step, null],
    ["venom", "report", null, null, null],
    ["venom", "report", task, null, move],
    ["venom", "question", task, null, null],
    ["venom", "question", task, step, move],
    ["user", "plan", task, null, null],
    ["user", "question", task, step, null],
    ["user", "question", task, null, move],
  ] as const)("refuses %s %s with task %s, step %s and move %s", (speaker, kind, task_id, step_id, move_id) => {
    expect(Message.safeParse({ ...base, speaker, kind, task_id, step_id, move_id }).success).toBe(false);
  });
});
