import { StepStatus } from "@venom/contracts";
import { describe, expect, it } from "vitest";
import { canMoveStep, progressOf } from "../src/index.ts";

type Plan = readonly StepStatus[];

function* plans(length: number): Generator<Plan> {
  if (length === 0) {
    yield [];
    return;
  }
  for (const rest of plans(length - 1)) {
    for (const status of StepStatus.options) {
      yield [...rest, status];
    }
  }
}

function* everyPlan(longest: number): Generator<Plan> {
  for (let length = 1; length <= longest; length += 1) {
    yield* plans(length);
  }
}

function changed(plan: Plan, index: number, status: StepStatus): Plan {
  return plan.map((current, position) => (position === index ? status : current));
}

function percent(plan: Plan): number {
  return progressOf(plan).percent;
}

function breaches(longest: number, rule: (plan: Plan) => boolean): Plan[] {
  const found: Plan[] = [];
  for (const plan of everyPlan(longest)) {
    if (!rule(plan)) {
      found.push(plan);
    }
  }
  return found;
}

function eachMove(plan: Plan, from: (status: StepStatus) => boolean, to: StepStatus, holds: (before: number, after: number) => boolean): boolean {
  const before = percent(plan);
  return plan.every((status, index) => !from(status) || !canMoveStep(status, to) || holds(before, percent(changed(plan, index, to))));
}

describe("the progress engine, checked on every plan of up to six steps", () => {
  it("covers every plan of one to six steps", () => {
    expect([...everyPlan(6)].length).toBe(299_592);
  });

  it("always stays between 0 and 100", () => {
    expect(
      breaches(6, (plan) => {
        const { percent: value, done, counted } = progressOf(plan);
        return value >= 0 && value <= 100 && done <= counted;
      }),
    ).toEqual([]);
  });

  it("never decreases when a step completes", () => {
    expect(breaches(6, (plan) => eachMove(plan, (status) => status === "running", "done", (before, after) => after >= before))).toEqual([]);
  });

  it("never lowers the number when a step is ignored", () => {
    expect(
      breaches(6, (plan) => progressOf(plan).counted <= 1 || eachMove(plan, (status) => status !== "ignored", "ignored", (before, after) => after >= before)),
    ).toEqual([]);
  });

  it("does not move when a step is skipped, because a skipped step still counts", () => {
    expect(breaches(6, (plan) => eachMove(plan, (status) => status !== "skipped", "skipped", (before, after) => after === before))).toEqual([]);
  });

  it("reaches 100 only when every counted step is done", () => {
    expect(
      breaches(6, (plan) => {
        const counted = plan.filter((status) => status !== "ignored");
        return (percent(plan) === 100) === (counted.length > 0 && counted.every((status) => status === "done"));
      }),
    ).toEqual([]);
  });

  it("rounds down, so a long task never shows 100 while a step is left", () => {
    const longPlan = (total: number, done: number): Plan => Array.from({ length: total }, (_, index) => (index < done ? "done" : "pending"));
    expect(percent(longPlan(200, 199))).toBe(99);
    expect(percent(longPlan(3, 2))).toBe(66);
    expect(percent(longPlan(99, 99))).toBe(100);
  });
});
