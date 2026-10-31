import type { GatewayEvent, MemoryItem } from "@venom/contracts";
import { describe, expect, it } from "vitest";
import { applyMemoryEvent, matching, withItem } from "../src/renderer/src/memory-state.ts";

const account = "01a12a2d-0000-7000-8000-000000000001";

function item(id: string, content: string, created_at: string): MemoryItem {
  return { id, account_id: account, type: "fact", content, source: "settings", created_at, updated_at: created_at, status: "active" };
}

const car = item("01a12c54-0000-7000-8000-0000000000a1", "My car is a blue Toyota", "2026-10-31T08:00:00.000Z");
const sister = item("01a12c54-0000-7000-8000-0000000000a2", "My sister Ana's birthday is on 12 March", "2026-10-31T09:00:00.000Z");

const stamp = { request_id: "01a12c54-8d81-756e-8439-b843a4fd7ef0", sequence: 0, emitted_at: "2026-10-31T09:00:01.000Z" };

describe("memory list in the window", () => {
  it("shows the newest first and replaces an edited memory in place", () => {
    const items = withItem(withItem([], car), sister);
    expect(items.map((entry) => entry.id)).toEqual([sister.id, car.id]);
    const edited = withItem(items, { ...car, content: "My car is a red Toyota", updated_at: "2026-10-31T10:00:00.000Z" });
    expect(edited.map((entry) => entry.content)).toEqual([sister.content, "My car is a red Toyota"]);
  });

  it("follows memory and forgotten events from any device", () => {
    const saved: GatewayEvent = { type: "memory", ...stamp, item: sister };
    const forgotten: GatewayEvent = { type: "forgotten", ...stamp, item_id: car.id, message_ids: [] };
    const devices: GatewayEvent = { type: "devices", ...stamp, devices: [] };

    const after = applyMemoryEvent(applyMemoryEvent([car], saved), forgotten);
    expect(after).toEqual([sister]);
    const same = [car];
    expect(applyMemoryEvent(same, devices)).toBe(same);
  });

  it("searches by every word typed, ignoring case", () => {
    expect(matching([car, sister], "  ANA birthday ")).toEqual([sister]);
    expect(matching([car, sister], "")).toEqual([car, sister]);
    expect(matching([car, sister], "boat")).toEqual([]);
  });
});
