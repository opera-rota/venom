import type { GatewayEvent, Message } from "@venom/contracts";
import { describe, expect, it } from "vitest";
import { initialConversation, mergeMessages, reduceConversation } from "../src/renderer/src/conversation.ts";

const base = {
  account_id: "01a12a2d-0000-7000-8000-000000000001",
  device_id: "01a12a2d-0000-7000-8000-000000000002",
};

function message(id: string, created_at: string, text = id): Message {
  return { ...base, id, created_at, speaker: "user", text };
}

const requestId = "01a12c54-8d81-756e-8439-b843a4fd7ef0";

function requestEvent(state: "accepted" | "completed" | "failed", sequence: number): GatewayEvent {
  return {
    type: "request",
    request_id: requestId,
    sequence,
    emitted_at: "2026-10-11T10:00:00.000Z",
    state,
    detail: state === "failed" ? "Could not save." : null,
  };
}

const first = message("01a12c54-0000-7000-8000-000000000001", "2026-10-11T10:00:00.000Z");
const second = message("01a12c54-0000-7000-8000-000000000002", "2026-10-11T10:00:01.000Z");
const third = message("01a12c54-0000-7000-8000-000000000003", "2026-10-11T10:00:01.000Z");

describe("conversation state", () => {
  it("merges history and live messages without duplicates, oldest first", () => {
    const merged = mergeMessages([third, first], [second, first, third]);
    expect(merged.map((m) => m.id)).toEqual([first.id, second.id, third.id]);
  });

  it("keeps the same list when nothing new arrives", () => {
    const current = mergeMessages([], [first]);
    expect(mergeMessages(current, [first])).toBe(current);
  });

  it("tracks a request from accepted to completed", () => {
    const accepted = reduceConversation(initialConversation, { type: "event", event: requestEvent("accepted", 0) });
    expect(accepted.pending.has(requestId)).toBe(true);
    const withMessage = reduceConversation(accepted, {
      type: "event",
      event: { type: "message", request_id: requestId, sequence: 1, emitted_at: first.created_at, message: first },
    });
    expect(withMessage.messages).toEqual([first]);
    const completed = reduceConversation(withMessage, { type: "event", event: requestEvent("completed", 2) });
    expect(completed.pending.size).toBe(0);
    expect(completed.failure).toBeNull();
  });

  it("shows a failed request and lets the user dismiss it", () => {
    const failed = reduceConversation(
      reduceConversation(initialConversation, { type: "event", event: requestEvent("accepted", 0) }),
      { type: "event", event: requestEvent("failed", 1) },
    );
    expect(failed.pending.size).toBe(0);
    expect(failed.failure).toBe("Could not save.");
    expect(reduceConversation(failed, { type: "dismiss" }).failure).toBeNull();
  });
});
