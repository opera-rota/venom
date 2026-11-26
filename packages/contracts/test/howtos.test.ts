import { describe, expect, it } from "vitest";
import { ChangeHowTo, HowTo, HowToStep, howToApp, howToName, howToSteps, moveLabel, type TaskMove } from "../src/index.ts";

const base = {
  task_id: "0199d2a0-7c1e-7a3b-9f2d-1a2b3c4d5e92",
  seen: "Calculator",
  created_at: "2026-11-26T10:00:00.000Z",
  finished_at: "2026-11-26T10:00:01.000Z",
};

function move(number: number, intent: string, step: TaskMove["move"], status: TaskMove["status"] = "done", detail: string | null = null): TaskMove {
  return { ...base, effects: [], id: `0199d2a0-7c1e-7a3b-9f2d-1a2b3c4d5f${String(number).padStart(2, "0")}`, number, intent, move: step, status, detail };
}

const moves: TaskMove[] = [
  move(1, "Open the Calculator app.", { name: "open", app: "Calculator", open: null }),
  move(2, "Click the One button.", { name: "click", mark: 26, point: null, double: false }, "done", "Clicked mark 26 'One' in 'Calculator'."),
  move(3, "Click the Plus button.", { name: "click", mark: 29, point: null, double: false }, "failed", "The button did not answer."),
  move(4, "Type the rest of the sum.", { name: "type", text: "2+3+4+5+6+7+8+9", mark: null, enter: false }),
  move(5, "Press Enter to see the total.", { name: "key", key: "enter" }),
];

describe("how-tos made from a finished job", () => {
  it("keeps only the moves that worked, numbered again from one, with short labels", () => {
    const steps = howToSteps(moves);
    expect(steps.map((step) => [step.number, step.kind, step.label])).toEqual([
      [1, "open", "Calculator"],
      [2, "click", "One"],
      [3, "type", "“2+3+4+5+6+7+8+9”"],
      [4, "key", "Enter"],
    ]);
    expect(steps.every((step) => HowToStep.safeParse(step).success && step.note === null)).toBe(true);
  });

  it("names the app from the first open move, and the how-to from the request", () => {
    expect(howToApp(moves)).toBe("Calculator");
    expect(howToApp(moves.slice(1))).toBeNull();
    expect(howToName("open calculator and add the numbers.")).toBe("Open calculator and add the numbers");
    expect(howToName("x".repeat(100))).toHaveLength(60);
    expect(howToName("   ")).toBe("My how-to");
  });

  it("labels every kind of move in a few words", () => {
    expect(moveLabel({ move: { name: "scroll", direction: "down", steps: 2, mark: null }, detail: null })).toBe("Scroll down");
    expect(moveLabel({ move: { name: "pause", seconds: 2 }, detail: null })).toBe("2 s");
    expect(moveLabel({ move: { name: "key", key: "ctrl+l" }, detail: null })).toBe("Ctrl+L");
    expect(moveLabel({ move: { name: "click", mark: 3, point: null, double: true }, detail: null })).toBe("Double click");
  });

  it("refuses steps out of order, more wins than tries, and a change that changes nothing", () => {
    const steps = howToSteps(moves);
    const howto = {
      id: "0199d2a0-7c1e-7a3b-9f2d-1a2b3c4d5e91",
      account_id: "0199d2a0-7c1e-7a3b-9f2d-1a2b3c4d5e01",
      task_id: null,
      name: "Add numbers",
      app: "Calculator",
      learned: "job",
      pinned: false,
      applied: 1,
      worked: 1,
      seconds: 40,
      steps,
      created_at: "2026-11-26T10:00:00.000Z",
      updated_at: "2026-11-26T10:00:00.000Z",
    };
    expect(HowTo.safeParse(howto).success).toBe(true);
    expect(HowTo.safeParse({ ...howto, steps: [...steps].reverse() }).success).toBe(false);
    expect(HowTo.safeParse({ ...howto, worked: 2 }).success).toBe(false);
    expect(ChangeHowTo.safeParse({}).success).toBe(false);
    expect(ChangeHowTo.safeParse({ pinned: true }).success).toBe(true);
  });
});
