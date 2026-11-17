import { describe, expect, it } from "vitest";
import { Message } from "../src/index.ts";

const base = {
  id: "0199d2a0-7c1e-7a3b-9f2d-1a2b3c4d5e11",
  account_id: "0199d2a0-7c1e-7a3b-9f2d-1a2b3c4d5e01",
  device_id: "0199d2a0-7c1e-7a3b-9f2d-1a2b3c4d5e02",
  text: "Hello",
  document: null,
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

describe("only a plain VENOM answer carries a document", () => {
  const document = { title: "Shopping list", body: "- Milk\n- Bread" };
  const none = { task_id: null, step_id: null, move_id: null };

  it("accepts a document on a VENOM text answer", () => {
    expect(Message.safeParse({ ...base, ...none, speaker: "venom", kind: "text", document }).success).toBe(true);
  });

  it.each([
    ["user", "text", none],
    ["venom", "report", { ...none, task_id: task }],
  ] as const)("refuses a document on a %s %s message", (speaker, kind, links) => {
    expect(Message.safeParse({ ...base, ...links, speaker, kind, document }).success).toBe(false);
  });

  it.each([
    { title: "", body: "- Milk" },
    { title: "List", body: " \n " },
    { title: "x".repeat(121), body: "- Milk" },
    { title: "List", body: "x".repeat(32_001) },
  ])("refuses a document without a real title or body", (broken) => {
    expect(Message.safeParse({ ...base, ...none, speaker: "venom", kind: "text", document: broken }).success).toBe(false);
  });
});
