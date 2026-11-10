import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MoveChoice, NextMove, Observation, ScreenClick, ScreenKey, ScreenMove, screenKeys, screenLimits } from "../src/index.ts";

function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(join(import.meta.dirname, "..", "fixtures", "valid", name), "utf8")) as T;
}

const seen = fixture<Observation>("Observation.json");

describe("a look at the screen", () => {
  it("numbers its marks 1, 2, 3 in order", () => {
    expect(Observation.safeParse(seen).success).toBe(true);
    const shuffled = { ...seen, marks: [...seen.marks].reverse() };
    expect(Observation.safeParse(shuffled).error?.issues.map((issue) => issue.path.join("."))).toEqual(["marks"]);
  });

  it("names a focused mark that exists", () => {
    expect(Observation.safeParse({ ...seen, focused: seen.marks.length }).success).toBe(true);
    expect(Observation.safeParse({ ...seen, focused: seen.marks.length + 1 }).success).toBe(false);
    expect(Observation.safeParse({ ...seen, marks: [], focused: null }).success).toBe(true);
  });

  it(`keeps the picture under ${screenLimits.pictureCharacters} characters of base64`, () => {
    expect(Observation.safeParse({ ...seen, picture: "A".repeat(screenLimits.pictureCharacters + 4) }).success).toBe(false);
    expect(Observation.safeParse({ ...seen, picture: "not base64!" }).success).toBe(false);
  });
});

describe("a move", () => {
  it("clicks exactly one of a mark or a point", () => {
    expect(ScreenClick.safeParse({ name: "click", mark: 2, point: null, double: false }).success).toBe(true);
    expect(ScreenClick.safeParse({ name: "click", mark: null, point: { x: 10, y: 20 }, double: true }).success).toBe(true);
    expect(ScreenClick.safeParse({ name: "click", mark: 2, point: { x: 10, y: 20 }, double: false }).success).toBe(false);
    expect(ScreenClick.safeParse({ name: "click", mark: null, point: null, double: false }).success).toBe(false);
  });

  it("checks a click inside a chosen move too", () => {
    const choice = { kind: "move", intent: "Click somewhere", effects: [], move: { name: "click", mark: null, point: null, double: false } };
    expect(MoveChoice.safeParse(choice).success).toBe(false);
  });

  it("comes only from the fixed menu", () => {
    const named = ScreenMove.options.map((option) => option.shape.name.value).sort();
    expect(named).toEqual(["click", "key", "open", "pause", "scroll", "type"]);
    expect([...ScreenKey.options]).toEqual([...screenKeys]);
    expect(ScreenKey.safeParse("alt+f4").success).toBe(false);
  });

  it("is chosen with what the screen shows", () => {
    expect(NextMove.safeParse(fixture("NextMove.json")).success).toBe(true);
    expect(NextMove.safeParse({ ...fixture<NextMove>("NextMove.json"), seen: " " }).success).toBe(false);
  });
});
