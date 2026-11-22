import { describe, expect, it } from "vitest";
import { Awake, awakeLevel, type BlockerKind } from "../src/main/awake.ts";

function blocker() {
  const held = new Map<number, BlockerKind>();
  let next = 0;
  return {
    held,
    start(kind: BlockerKind) {
      next += 1;
      held.set(next, kind);
      return next;
    },
    stop(id: number) {
      held.delete(id);
    },
  };
}

describe("keeping the computer in use awake", () => {
  it("holds exactly one blocker for the level asked, and lets go when nothing needs it", () => {
    const power = blocker();
    const awake = new Awake(power);
    awake.set("system");
    expect([...power.held.values()]).toEqual(["prevent-app-suspension"]);
    awake.set("system");
    expect(power.held.size).toBe(1);
    awake.set("display");
    expect([...power.held.values()]).toEqual(["prevent-display-sleep"]);
    awake.set("none");
    expect(power.held.size).toBe(0);
    expect(awake.level).toBe("none");
  });

  it("accepts only the three known levels from the window", () => {
    expect(awakeLevel("display")).toBe("display");
    expect(awakeLevel("forever")).toBeNull();
    expect(awakeLevel(3)).toBeNull();
  });
});
