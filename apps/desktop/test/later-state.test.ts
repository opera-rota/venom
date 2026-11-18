import type { GatewayEvent, LaterItem } from "@venom/contracts";
import { describe, expect, it } from "vitest";
import { applyLaterEvent, laterPreview, unseenCount, withLater } from "../src/renderer/src/later-state.ts";

const account = "01a12a2d-0000-7000-8000-000000000001";

function item(id: string, title: string, created_at: string, seen_at: string | null = null): LaterItem {
  return { id, account_id: account, task_id: null, title, body: `${title}, kept.`, seen_at, created_at };
}

const weather = item("01a12c54-0000-7000-8000-0000000000b1", "Weather in Kigali", "2026-11-17T08:00:00.000Z");
const buses = item("01a12c54-0000-7000-8000-0000000000b2", "Bus times", "2026-11-17T09:00:00.000Z");

const stamp = { request_id: "01a12c54-8d81-756e-8439-b843a4fd7ef0", sequence: 0, emitted_at: "2026-11-17T09:00:01.000Z" };

describe("for later items in the window", () => {
  it("shows the newest first and replaces an item marked seen in place", () => {
    const items = withLater(withLater([], weather), buses);
    expect(items.map((entry) => entry.title)).toEqual(["Bus times", "Weather in Kigali"]);
    expect(unseenCount(items)).toBe(2);
    const seen = withLater(items, { ...weather, seen_at: "2026-11-17T10:00:00.000Z" });
    expect(seen.map((entry) => entry.title)).toEqual(["Bus times", "Weather in Kigali"]);
    expect(unseenCount(seen)).toBe(1);
  });

  it.each([
    ["The capital of Kenya is **Nairobi**.", "The capital of Kenya is Nairobi."],
    ["## Produce\n- Bananas, 2 lb\n- *Fresh* spinach\n\n1. Rice\n- [x] Milk", "Produce · Bananas, 2 lb · Fresh spinach · Rice · Milk"],
    ["See [the map](https://example.com) and `code`, snake_case_name stays.\n\n---", "See the map and code, snake_case_name stays."],
    ["Done. Typed \"hello buddy\" (11 characters).", "Done. Typed \"hello buddy\" (11 characters)."],
  ])("shows a plain preview of %j", (body, preview) => {
    expect(laterPreview(body)).toBe(preview);
  });

  it("follows later and later_removed events from any device and ignores the rest", () => {
    const kept: GatewayEvent = { type: "later", ...stamp, item: buses };
    const removed: GatewayEvent = { type: "later_removed", ...stamp, item_id: weather.id };
    const devices: GatewayEvent = { type: "devices", ...stamp, devices: [] };

    expect(applyLaterEvent(applyLaterEvent([weather], kept), removed)).toEqual([buses]);
    const untouched = [weather];
    expect(applyLaterEvent(untouched, devices)).toBe(untouched);
  });
});
