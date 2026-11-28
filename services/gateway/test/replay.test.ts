import { Observation, type ScreenMark } from "@venom/contracts";
import type { ReplayStep } from "@venom/db";
import { describe, expect, it } from "vitest";
import { knownMove, replayed, targetOf } from "../src/replay.ts";

function mark(id: number, name: string, kind: ScreenMark["kind"] = "button", password = false): ScreenMark {
  return { id, kind, name, editable: kind === "box", password, box: { x: id * 10, y: 10, width: 8, height: 8 } };
}

function screen(marks: readonly ScreenMark[], window = "Calculator"): Observation {
  return Observation.parse({ picture: "AAAA", width: 100, height: 60, window, app: "Calculator", marks, focused: null });
}

function step(move: ReplayStep["move"], target: ReplayStep["target"], note: string | null = null): ReplayStep {
  return { number: 1, said: "Press the button.", note, move, effects: [], target };
}

const plus = { kind: "button" as const, name: "Plus", window: "Calculator" };

describe("replay: known steps are made exactly, without thinking", () => {
  it("records which button a move touched, by name and window", () => {
    const seen = screen([mark(1, "Seven"), mark(2, "Plus")]);
    expect(targetOf({ name: "click", mark: 2, point: null, double: false }, seen)).toEqual(plus);
    expect(targetOf({ name: "key", key: "enter" }, seen)).toEqual({ kind: null, name: null, window: "Calculator" });
    expect(targetOf({ name: "open", app: "Calculator", open: null }, seen)).toBeNull();
  });

  it("finds the same button again even when its mark number moved", () => {
    const seen = screen([mark(1, "Memory"), mark(2, "Seven"), mark(3, "Plus")]);
    expect(replayed(step({ name: "click", mark: 2, point: null, double: false }, plus), seen)).toEqual({ name: "click", mark: 3, point: null, double: false });
  });

  it("hands over to thinking when the button is missing, doubled, in another window, or only a point", () => {
    const click = { name: "click" as const, mark: 2, point: null, double: false };
    expect(replayed(step(click, plus), screen([mark(1, "Seven")]))).toBeNull();
    expect(replayed(step(click, plus), screen([mark(1, "Plus"), mark(2, "Plus")]))).toBeNull();
    expect(replayed(step(click, plus), screen([mark(1, "Plus")], "Notepad"))).toBeNull();
    expect(replayed(step(click, { ...plus, kind: "link" }), screen([mark(1, "Plus")]))).toBeNull();
    expect(replayed(step({ name: "click", mark: null, point: { x: 4, y: 4 }, double: false }, plus), screen([mark(1, "Plus")]))).toBeNull();
    expect(replayed(step(click, null), screen([mark(1, "Plus")]))).toBeNull();
  });

  it("presses keys and types only in the same window, and never types into a password box", () => {
    const enter = { name: "key" as const, key: "enter" as const };
    const here = { kind: null, name: null, window: "Calculator" };
    expect(replayed(step(enter, here), screen([]))).toEqual(enter);
    expect(replayed(step(enter, here), screen([], "Mail"))).toBeNull();
    expect(replayed(step(enter, null), screen([]))).toBeNull();
    const typing = { name: "type" as const, text: "hello", mark: 1, enter: false };
    const box = { kind: "box" as const, name: "Search", window: "Calculator" };
    expect(replayed(step(typing, box), screen([mark(1, "Other"), mark(2, "Search", "box")]))).toEqual({ ...typing, mark: 2 });
    expect(replayed(step(typing, box), screen([mark(1, "Search", "box", true)]))).toBeNull();
  });

  it("leaves a step with a note to thinking, and keeps the step's own words", () => {
    const open = { name: "open" as const, app: "Calculator", open: null };
    expect(knownMove(step(open, null, "Use the scientific mode."), screen([]))).toBeNull();
    expect(knownMove(step(open, null), screen([]))).toEqual({ kind: "move", intent: "Press the button.", effects: [], move: open });
  });
});
