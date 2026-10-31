import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { progressOf, Task } from "../src/index.ts";

const fixture = JSON.parse(readFileSync(join(import.meta.dirname, "..", "fixtures", "valid", "Task.ignored-and-skipped.json"), "utf8")) as Task;

describe("progress is counted from the steps, never claimed", () => {
  it("counts done steps over the steps that still count", () => {
    expect(progressOf(["done", "done", "running", "skipped", "ignored"])).toEqual({
      done: 2,
      counted: 4,
      skipped: 1,
      ignored: 1,
      total: 5,
      percent: 50,
    });
  });

  it("rounds down, so a task never shows 100 before its last counted step is done", () => {
    expect(progressOf(["done", "done", "pending"]).percent).toBe(66);
    expect(progressOf(["done", "done", "done"]).percent).toBe(100);
    expect(progressOf([]).percent).toBe(0);
  });

  it("refuses a task whose progress disagrees with its plan", () => {
    expect(Task.safeParse(fixture).success).toBe(true);
    const claimed = Task.safeParse({ ...fixture, progress: { ...fixture.progress, percent: 70 } });
    expect(claimed.error?.issues.map((issue) => issue.path.join("."))).toEqual(["progress"]);
  });

  it("refuses a task that still counts an ignored step", () => {
    const stillCounted = { ...fixture.progress, counted: 5, ignored: 0, percent: 40 };
    expect(Task.safeParse({ ...fixture, progress: stillCounted }).success).toBe(false);
  });
});
