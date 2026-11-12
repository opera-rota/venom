import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Task } from "../src/index.ts";

function fixture(name: string): Task {
  return Task.parse(JSON.parse(readFileSync(join(import.meta.dirname, "..", "fixtures", "valid", name), "utf8")));
}

describe("a goal counts moves and a plan counts steps", () => {
  it("refuses a goal that carries a written plan", () => {
    const plan = fixture("Task.json");
    const goal = fixture("Task.goal.json");
    const mixed = { ...goal, plan: plan.plan, progress: plan.progress };
    expect(Task.safeParse(mixed).error?.issues.map((issue) => issue.message)).toEqual(["A goal is reached one move at a time, so it has no written plan."]);
  });

  it("refuses a plan that counts moves", () => {
    const plan = fixture("Task.json");
    expect(Task.safeParse({ ...plan, moves: 2 }).error?.issues.map((issue) => issue.message)).toEqual(["Only a goal counts moves."]);
  });
});
