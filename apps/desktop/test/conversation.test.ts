import type { Device, ForgottenEvent, Message, MessageHistory, RequestEvent } from "@venom/contracts";
import { describe, expect, it } from "vitest";
import {
  arrange,
  heldRequests,
  initialConversation,
  isAnswering,
  isConversationEvent,
  mergeMessages,
  reduceConversation,
  sentFrom,
  type ConversationEvent,
  type ConversationState,
  type LiveEvent,
} from "../src/renderer/src/conversation.ts";

const base = {
  account_id: "01a12a2d-0000-7000-8000-000000000001",
  device_id: "01a12a2d-0000-7000-8000-000000000002",
};

const at = "2026-10-25T10:00:00.000Z";
const requestId = "01a12c54-8d81-756e-8439-b843a4fd7ef0";
const retryId = "01a12c54-8d81-756e-8439-b843a4fd7ef1";
const otherId = "01a12c54-8d81-756e-8439-b843a4fd7ef2";

function message(id: string, speaker: "user" | "venom", text: string, created_at = at): Message {
  return { ...base, id, created_at, speaker, text };
}

const question = message("01a12c54-0000-7000-8000-000000000001", "user", "Explain what a mutex is");
const reply = message("01a12c54-0000-7000-8000-000000000002", "venom", "A mutex is a lock.", "2026-10-25T10:00:02.000Z");
const asked = { request_id: requestId, message_id: question.id };

function accepted(id: string, origin = asked): RequestEvent {
  return { type: "request", request_id: id, sequence: 0, emitted_at: at, state: "accepted", detail: null, question: origin };
}

function completed(id: string, sequence: number): RequestEvent {
  return { type: "request", request_id: id, sequence, emitted_at: at, state: "completed", detail: null, question: null };
}

function failure(id: string, sequence: number): RequestEvent {
  return { type: "request", request_id: id, sequence, emitted_at: at, state: "failed", detail: "The model took too long to answer.", question: null };
}

function stream(id: string): LiveEvent[] {
  return [
    accepted(id),
    { type: "message", request_id: id, sequence: 1, emitted_at: at, message: question },
    { type: "answer", request_id: id, sequence: 2, emitted_at: at, delta: "A mutex " },
    { type: "answer", request_id: id, sequence: 3, emitted_at: at, delta: "is a lock." },
    { type: "message", request_id: id, sequence: 4, emitted_at: at, message: reply },
    completed(id, 5),
  ];
}

function retried(id: string): LiveEvent[] {
  return [
    accepted(id),
    { type: "answer", request_id: id, sequence: 1, emitted_at: at, delta: "A mutex is a lock." },
    { type: "message", request_id: id, sequence: 2, emitted_at: at, message: reply },
    completed(id, 3),
  ];
}

function play(events: readonly ConversationEvent[], state: ConversationState = initialConversation): ConversationState {
  return reduceConversation(state, { type: "events", events });
}

function pick(events: readonly LiveEvent[], ...positions: number[]): LiveEvent[] {
  return positions.map((position) => {
    const event = events[position];
    if (event === undefined) {
      throw new Error(`No event at ${position}`);
    }
    return event;
  });
}

function load(state: ConversationState, history: MessageHistory, replay: readonly ConversationEvent[] = []): ConversationState {
  return reduceConversation(state, { type: "history", history, replay });
}

describe("conversation state", () => {
  it("merges messages without duplicates, oldest first", () => {
    const later = message("01a12c54-0000-7000-8000-000000000003", "user", "later", "2026-10-25T10:00:05.000Z");
    expect(mergeMessages([later], [question, later]).map((item) => item.id)).toEqual([question.id, later.id]);
    const current = mergeMessages([], [question]);
    expect(mergeMessages(current, [question])).toBe(current);
  });

  it("streams an answer under its question and replaces it with the saved reply", () => {
    const events = stream(requestId);
    const streaming = play(events.slice(0, 4));
    expect(streaming.answers.get(requestId)).toMatchObject({ origin: requestId, askedId: question.id, text: "A mutex is a lock.", failure: null });
    expect(isAnswering(streaming)).toBe(true);
    expect(arrange(streaming).placed[0]?.answers.map((answer) => answer.text)).toEqual(["A mutex is a lock."]);

    const done = play(events.slice(4), streaming);
    expect(done.messages.map((item) => item.text)).toEqual(["Explain what a mutex is", "A mutex is a lock."]);
    expect(done.answers.size).toBe(0);
    expect(done.ordering.size).toBe(0);
    expect(isAnswering(done)).toBe(false);
  });

  it("puts events that arrive out of order back in order", () => {
    const events = stream(requestId);
    const shuffled = play(pick(events, 3, 0, 2));
    expect(shuffled.answers.get(requestId)?.text).toBe("");
    expect(heldRequests(shuffled)).toEqual([requestId]);

    const fixed = play(pick(events, 1), shuffled);
    expect(fixed.answers.get(requestId)?.text).toBe("A mutex is a lock.");
    expect(heldRequests(fixed)).toEqual([]);
    expect(play(pick(events, 5, 4), fixed).messages).toHaveLength(2);
  });

  it("drops duplicate events, including late ones for a finished request", () => {
    const events = stream(requestId);
    const once = play(events.slice(0, 3));
    expect(play(pick(events, 2, 1, 2), once).answers.get(requestId)?.text).toBe("A mutex ");
    expect(play(pick(events, 0), play(events)).answers.size).toBe(0);
  });

  it("applies what it has when a gap never fills", () => {
    const gapped = play(pick(stream(requestId), 0, 1, 3));
    expect(gapped.answers.get(requestId)?.text).toBe("");
    const closed = reduceConversation(gapped, { type: "gap", requestId });
    expect(closed.answers.get(requestId)?.text).toBe("is a lock.");
    expect(heldRequests(closed)).toEqual([]);
  });

  it("shows a failed answer under its question, and lets a retry from any device take its place", () => {
    const failed = play([...stream(requestId).slice(0, 3), failure(requestId, 3)]);
    expect(failed.answers.get(requestId)).toMatchObject({ askedId: question.id, failure: "The model took too long to answer." });
    expect(isAnswering(failed)).toBe(false);

    const retrying = play(retried(retryId).slice(0, 1), failed);
    expect(retrying.answers.has(requestId)).toBe(false);
    expect(retrying.answers.get(retryId)).toMatchObject({ origin: requestId, askedId: question.id, text: "", failure: null });

    const answered = play(retried(retryId).slice(1), retrying);
    expect(answered.answers.size).toBe(0);
    expect(answered.messages.at(-1)).toEqual(reply);
  });

  it("places a retry under its question even on a device that never saw the failure", () => {
    const elsewhere = load(initialConversation, { messages: [question], pending: [] });
    const writing = play(retried(retryId).slice(0, 2), elsewhere);
    expect(arrange(writing).placed[0]?.answers.map((answer) => answer.text)).toEqual(["A mutex is a lock."]);
    expect(arrange(writing).loose).toEqual([]);
  });

  it("shows a request that failed before naming its question as a notice", () => {
    const failed = play([{ ...accepted(requestId), question: null }, { ...failure(requestId, 1), detail: "VENOM could not save this message." }]);
    expect(failed.answers.size).toBe(0);
    expect(failed.notice).toBe("VENOM could not save this message.");
    expect(reduceConversation(failed, { type: "dismiss" }).notice).toBeNull();
  });

  it("follows chat and forgetting, and leaves power and devices to their own panels", () => {
    const power = {
      type: "power",
      request_id: retryId,
      sequence: 0,
      emitted_at: at,
      power: {
        engine: "dove",
        engine_class: "free",
        balance: 0,
        free_daily_answers: 30,
        free_used_today: 1,
        free_resets_at: "2026-10-26T00:00:00.000Z",
        answers_left: 29,
        answers_left_exact: true,
      },
    } as const;
    expect(isConversationEvent(power)).toBe(false);
    expect(isConversationEvent({ type: "devices", request_id: retryId, sequence: 0, emitted_at: at, devices: [] })).toBe(false);
    expect(isConversationEvent({ type: "forgotten", request_id: retryId, sequence: 0, emitted_at: at, item_id: question.id, message_ids: [] })).toBe(true);
    expect(isConversationEvent(completed(retryId, 1))).toBe(true);
  });

  it("replaces its copy with the cloud's after a reconnect, answers still being written included", () => {
    const streaming = play(stream(requestId).slice(0, 3));
    const failedLocally = play([...stream(retryId).slice(0, 2), failure(retryId, 2)]);
    const both: ConversationState = { ...streaming, answers: new Map([...streaming.answers, ...failedLocally.answers]) };
    const writing = { request_id: otherId, question: { request_id: otherId, message_id: question.id }, sequence: 3, text: "Half", failure: null };

    const replaced = load(both, { messages: [reply, question], pending: [writing] });
    expect(replaced.messages).toEqual([question, reply]);
    expect([...replaced.answers.keys()]).toEqual([otherId]);
    expect(replaced.answers.get(otherId)).toMatchObject({ origin: otherId, askedId: question.id, text: "Half", failure: null });

    const continued = play([{ type: "answer", request_id: otherId, sequence: 4, emitted_at: at, delta: " way" }], replaced);
    expect(continued.answers.get(otherId)?.text).toBe("Half way");
  });

  it("replays what arrived while the history was loading, without doubling anything", () => {
    const events = stream(requestId);
    const snapshot: MessageHistory = {
      messages: [question],
      pending: [{ request_id: requestId, question: asked, sequence: 2, text: "A mutex ", failure: null }],
    };
    const caughtUp = load(initialConversation, snapshot, pick(events, 2, 3, 4, 5));
    expect(caughtUp.messages).toEqual([question, reply]);
    expect(caughtUp.answers.size).toBe(0);

    const halfway = load(initialConversation, snapshot, pick(events, 2, 3));
    expect(halfway.answers.get(requestId)?.text).toBe("A mutex is a lock.");

    const forgotten = load(initialConversation, snapshot, [{ type: "forgotten", request_id: retryId, sequence: 0, emitted_at: at, item_id: question.id, message_ids: [question.id] }]);
    expect(forgotten.messages).toEqual([]);
    expect(forgotten.answers.size).toBe(0);
  });

  it("does not bring back an answer it already saw finish", () => {
    const done = play(stream(requestId));
    const stale = load(done, { messages: [question], pending: [{ request_id: requestId, question: asked, sequence: 3, text: "A mutex is a lock.", failure: null }] });
    expect(stale.answers.size).toBe(0);
  });

  it("removes forgotten messages and their answers", () => {
    const answered = play(stream(requestId));
    expect(answered.messages).toHaveLength(2);
    const forget: ForgottenEvent = { type: "forgotten", request_id: retryId, sequence: 0, emitted_at: at, item_id: question.id, message_ids: [question.id, reply.id] };

    const forgotten = play([forget], answered);
    expect(forgotten.messages).toEqual([]);
    expect(play([forget], forgotten)).toBe(forgotten);
  });

  it("says which device a question came from, except for this device and for VENOM", () => {
    const phone: Device = {
      id: "01a12a2d-0000-7000-8000-000000000009",
      account_id: base.account_id,
      type: "phone",
      name: "Pixel",
      platform: "android",
      capabilities: { screen_control: false, microphone: true, speaker: true, shortcuts: false, notifications: true, network: true },
      status: "active",
      last_seen_at: at,
    };
    const fromPhone = { ...question, device_id: phone.id };
    expect(sentFrom(question, [phone], base.device_id)).toBeNull();
    expect(sentFrom({ ...reply, device_id: phone.id }, [phone], base.device_id)).toBeNull();
    expect(sentFrom(fromPhone, [phone], base.device_id)).toBe("From Pixel");
    expect(sentFrom(fromPhone, [], base.device_id)).toBe("From another device");
  });
});
