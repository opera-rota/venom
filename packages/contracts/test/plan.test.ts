import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ActionSpec, PlanDraft, planLimits, SafetySettings, Step, StepAction, type DraftStep } from "../src/index.ts";

function fixture<T>(kind: "valid" | "invalid", name: string): T {
  return JSON.parse(readFileSync(join(import.meta.dirname, "..", "fixtures", kind, name), "utf8")) as T;
}

const plan = fixture<PlanDraft>("valid", "PlanDraft.json");
const task = fixture<{ plan: Step[] }>("valid", "Task.json");
const openNotepad: DraftStep = { summary: "Open Notepad", spec: { name: "open_app", app: "Notepad" }, effects: [], reversible: true };

describe("a drafted plan", () => {
  it("has steps or a reason it cannot be done, never both and never neither", () => {
    expect(PlanDraft.safeParse(plan).success).toBe(true);
    expect(PlanDraft.safeParse({ ...plan, cannot: "I cannot do this." }).success).toBe(false);
    expect(PlanDraft.safeParse({ ...plan, steps: [] }).success).toBe(false);
  });

  it(`refuses more than ${planLimits.steps} steps`, () => {
    const steps = Array.from({ length: planLimits.steps + 1 }, () => openNotepad);
    expect(PlanDraft.safeParse({ ...plan, steps }).success).toBe(false);
    expect(PlanDraft.safeParse({ ...plan, steps: steps.slice(1) }).success).toBe(true);
  });

  it("offers exactly the actions of the fixed menu", () => {
    const named = ActionSpec.options.map((option) => option.shape.name.value).sort();
    expect(named).toEqual([...StepAction.options].sort());
  });
});

describe("a step", () => {
  it("carries details for its own action only", () => {
    const [step] = task.plan;
    expect(Step.safeParse(step).success).toBe(true);
    const mixed = Step.safeParse({ ...step, spec: { name: "wait", seconds: 5 } });
    expect(mixed.error?.issues.map((issue) => issue.path.join("."))).toEqual(["spec"]);
  });
});

describe("the don't ask me list", () => {
  it("lists each kind of action once", () => {
    expect(SafetySettings.safeParse({ confirmation_strictness: "standard", skip_asking: ["posts", "deletes"] }).success).toBe(true);
    expect(SafetySettings.safeParse({ confirmation_strictness: "standard", skip_asking: ["posts", "posts"] }).success).toBe(false);
  });
});
