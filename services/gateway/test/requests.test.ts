import { GatewayEvent, type Message } from "@venom/contracts";
import { describe, expect, it } from "vitest";
import { keptFailures, LiveRequests, unanswered } from "../src/requests.ts";

const account = "0199d2a0-7c1e-7a3b-9f2d-1a2b3c4d5e01";
const device = "0199d2a0-7c1e-7a3b-9f2d-1a2b3c4d5e02";

function id(n: number): string {
  return `0199d2a0-7c1e-7a3b-9f2d-${n.toString(16).padStart(12, "0")}`;
}

function message(n: number, createdAt: string): Message {
  return { id: id(n), account_id: account, device_id: device, speaker: "user", text: `Question ${n}`, created_at: createdAt };
}

function event(requestId: string, sequence: number, body: Record<string, unknown>): GatewayEvent {
  return GatewayEvent.parse({ request_id: requestId, sequence, emitted_at: "2026-10-31T18:00:00.000Z", ...body });
}

function fail(requests: LiveRequests, requestId: string, detail: string): void {
  requests.record(account, event(requestId, 1, { type: "request", state: "failed", detail, question: null }));
}

describe("live requests", () => {
  it("follows an answer while it is written and lets it go once it is finished", () => {
    const requests = new LiveRequests();
    const asked = message(1, "2026-10-31T18:00:00.000Z");
    requests.start(account, id(100), { request_id: id(100), message_id: asked.id });
    requests.record(account, event(id(100), 2, { type: "answer", delta: "Hello " }));
    requests.record(account, event(id(100), 3, { type: "answer", delta: "there" }));

    const writing = requests.capture(account).history({ messages: [asked], unanswered: [{ request_id: id(100), message_id: asked.id }] });
    expect(writing.pending).toEqual([{ request_id: id(100), question: { request_id: id(100), message_id: asked.id }, sequence: 3, text: "Hello there", failure: null }]);

    requests.record(account, event(id(100), 5, { type: "request", state: "completed", detail: null, question: null }));
    expect(requests.capture(account).history({ messages: [asked], unanswered: [] }).pending).toEqual([]);
  });

  it("replaces an older failure when the same question is answered again, and drops it when the question is forgotten", () => {
    const requests = new LiveRequests();
    const asked = message(1, "2026-10-31T18:00:00.000Z");
    const question = { request_id: id(100), message_id: asked.id };
    requests.start(account, id(100), question);
    fail(requests, id(100), "The model took too long to answer.");
    requests.start(account, id(101), question);

    const retried = requests.capture(account).history({ messages: [asked], unanswered: [question] }).pending;
    expect(retried.map((pending) => [pending.request_id, pending.failure])).toEqual([[id(101), null]]);

    fail(requests, id(101), "Still too slow.");
    expect(requests.capture(account).history({ messages: [asked], unanswered: [] }).pending).toHaveLength(1);
    requests.forget(account, [asked.id]);
    expect(requests.capture(account).history({ messages: [asked], unanswered: [] }).pending).toEqual([]);
  });

  it(`keeps only the newest ${keptFailures} failures of an account`, () => {
    const requests = new LiveRequests();
    const asked = Array.from({ length: keptFailures + 2 }, (_, index) => message(index + 1, "2026-10-31T18:00:00.000Z"));
    for (const [index, question] of asked.entries()) {
      requests.start(account, id(200 + index), { request_id: id(200 + index), message_id: question.id });
      fail(requests, id(200 + index), "Failed.");
    }
    const pending = requests.capture(account).history({ messages: asked, unanswered: [] }).pending;
    expect(pending).toHaveLength(keptFailures);
    expect(pending[0]?.request_id).toBe(id(202));
  });

  it("offers unanswered questions from before it started, but never guesses about newer ones", () => {
    const requests = new LiveRequests();
    const old = message(1, "2026-10-31T17:00:00.000Z");
    const recent = message(2, "2026-10-31T18:00:00.000Z");
    const waiting = [
      { request_id: id(300), message_id: old.id },
      { request_id: id(301), message_id: recent.id },
    ];

    expect(requests.capture(account).history({ messages: [old, recent], unanswered: waiting }).pending.map((pending) => pending.request_id)).toEqual([id(300), id(301)]);

    requests.asked(recent);
    expect(requests.capture(account).history({ messages: [old, recent], unanswered: waiting }).pending).toEqual([
      { request_id: id(300), question: waiting[0], sequence: 0, text: "", failure: unanswered },
    ]);
  });
});
