import type { GatewayEvent, HowTo } from "@venom/contracts";
import { describe, expect, it } from "vitest";
import { applyHowToEvent, findHowTos, savedFrom, withHowTo } from "../src/renderer/src/howtos-state.ts";

const account = "01a12a2d-0000-7000-8000-000000000001";

function howto(id: string, name: string, updated_at: string, pinned = false): HowTo {
  return {
    id,
    account_id: account,
    task_id: `${id.slice(0, -2)}ff`,
    name,
    app: "Calculator",
    learned: "job",
    pinned,
    applied: 0,
    worked: 0,
    seconds: 40,
    steps: [{ number: 1, kind: "key", label: "Enter", said: "Press Enter to see the total.", note: "Use the keyboard" }],
    created_at: updated_at,
    updated_at,
  };
}

const sums = howto("01a12c54-0000-7000-8000-0000000000a1", "Add numbers", "2026-11-26T08:00:00.000Z");
const weather = howto("01a12c54-0000-7000-8000-0000000000a2", "Kigali weather", "2026-11-26T09:00:00.000Z");
const stamp = { request_id: "01a12c54-8d81-756e-8439-b843a4fd7ef0", sequence: 0, emitted_at: "2026-11-26T09:00:01.000Z" };

describe("how-tos in the window", () => {
  it("shows pinned how-tos first, then the newest, and replaces a changed one in place", () => {
    const listed = withHowTo(withHowTo([], sums), weather);
    expect(listed.map((entry) => entry.name)).toEqual(["Kigali weather", "Add numbers"]);
    const pinned = withHowTo(listed, { ...sums, pinned: true });
    expect(pinned.map((entry) => [entry.name, entry.pinned])).toEqual([["Add numbers", true], ["Kigali weather", false]]);
  });

  it("follows how-to events from any device and ignores the rest", () => {
    const saved: GatewayEvent = { type: "howto", ...stamp, howto: weather };
    const removed: GatewayEvent = { type: "howto_removed", ...stamp, howto_id: sums.id };
    const devices: GatewayEvent = { type: "devices", ...stamp, devices: [] };
    expect(applyHowToEvent(applyHowToEvent([sums], saved), removed)).toEqual([weather]);
    const same = [sums];
    expect(applyHowToEvent(same, devices)).toBe(same);
  });

  it("finds a how-to by its name, app, steps or notes, and knows which job it came from", () => {
    expect(findHowTos([sums, weather], "kigali").map((entry) => entry.id)).toEqual([weather.id]);
    expect(findHowTos([sums, weather], "keyboard calculator")).toHaveLength(2);
    expect(findHowTos([sums, weather], "   ")).toHaveLength(2);
    expect(savedFrom([sums, weather], sums.task_id ?? "")).toBe(sums);
    expect(savedFrom([sums], "01a12c54-0000-7000-8000-000000000000")).toBeNull();
  });
});
