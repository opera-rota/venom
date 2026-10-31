import type { Message, RequestEvent } from "@venom/contracts";
import { describe, expect, it } from "vitest";
import {
  arrange,
  heldRequests,
  initialConversation,
  isAnswering,
  isLiveEvent,
  mergeMessages,
  reduceConversation,
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

function message(id: string, speaker: "user" | "venom", text: string, created_at = at): Message {
  return { ...base, id, created_at, speaker, text };
}

const question = message("01a12c54-0000-7000-8000-000000000001", "user", "Explain what a mutex is");
const reply = message("01a12c54-0000-7000-8000-000000000002", "venom", "A mutex is a lock.", "2026-10-25T10:00:02.000Z");

function stream(id: string): LiveEvent[] {
  return [
    { type: "request", request_id: id, sequence: 0, emitted_at: at, state: "accepted", detail: null },
    { type: "message", request_id: id, sequence: 1, emitted_at: at, message: question },
    { type: "answer", request_id: id, sequence: 2, emitted_at: at, delta: "A mutex " },
    { type: "answer", request_id: id, sequence: 3, emitted_at: at, delta: "is a lock." },
    { type: "message", request_id: id, sequence: 4, emitted_at: at, message: reply },
    { type: "request", request_id: id, sequence: 5, emitted_at: at, state: "completed", detail: null },
  ];
}

function failure(id: string, sequence: number): RequestEvent {
  return { type: "request", request_id: id, sequence, emitted_at: at, state: "failed", detail: "The model took too long to answer." };
}

function play(events: readonly LiveEvent[], state: ConversationState = initialConversation): ConversationState {
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
    expect(streaming.answers.get(requestId)).toMatchObject({ askedId: question.id, text: "A mutex is a lock.", failure: null });
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

  it("shows a failed answer under its question and moves it to the retry", () => {
    const failed = play([...stream(requestId).slice(0, 3), failure(requestId, 3)]);
    expect(failed.answers.get(requestId)).toMatchObject({ askedId: question.id, failure: "The model took too long to answer." });
    expect(isAnswering(failed)).toBe(false);

    const retrying = reduceConversation(failed, { type: "retrying", from: requestId, to: retryId });
    expect(retrying.answers.has(requestId)).toBe(false);
    expect(retrying.answers.get(retryId)).toMatchObject({ origin: requestId, askedId: question.id, text: "", failure: null });

    const answered = play(
      [
        { type: "request", request_id: retryId, sequence: 0, emitted_at: at, state: "accepted", detail: null },
        { type: "answer", request_id: retryId, sequence: 1, emitted_at: at, delta: "A mutex is a lock." },
        { type: "message", request_id: retryId, sequence: 2, emitted_at: at, message: reply },
        { type: "request", request_id: retryId, sequence: 3, emitted_at: at, state: "completed", detail: null },
      ],
      retrying,
    );
    expect(answered.answers.size).toBe(0);
    expect(answered.messages.at(-1)).toEqual(reply);
  });

  it("does not leave a stuck answer when the retry finished before its reply arrived", () => {
    const failed = play([...stream(requestId).slice(0, 2), failure(requestId, 2)]);
    const finishedFirst = play(
      [
        { type: "request", request_id: retryId, sequence: 0, emitted_at: at, state: "accepted", detail: null },
        { type: "message", request_id: retryId, sequence: 1, emitted_at: at, message: reply },
        { type: "request", request_id: retryId, sequence: 2, emitted_at: at, state: "completed", detail: null },
      ],
      failed,
    );
    const settled = reduceConversation(finishedFirst, { type: "retrying", from: requestId, to: retryId });
    expect(settled.answers.size).toBe(0);
  });

  it("shows a request that failed before saving the message as a notice", () => {
    const failed = play([...pick(stream(requestId), 0), { ...failure(requestId, 1), detail: "VENOM could not save this message." }]);
    expect(failed.answers.size).toBe(0);
    expect(failed.notice).toBe("VENOM could not save this message.");
    expect(reduceConversation(failed, { type: "dismiss" }).notice).toBeNull();
  });

  it("leaves power and device updates to their own panels", () => {
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
    expect(isLiveEvent(power)).toBe(false);
  });

  it("replaces its copy with the cloud history after a reconnect", () => {
    const streaming = play(stream(requestId).slice(0, 3));
    const failedElsewhere = play([...stream(retryId).slice(0, 2), failure(retryId, 2)]);
    const both: ConversationState = { ...streaming, answers: new Map([...streaming.answers, ...failedElsewhere.answers]) };
    const replaced = reduceConversation(both, { type: "history", messages: [reply, question] });

    expect(replaced.messages).toEqual([question, reply]);
    expect([...replaced.answers.keys()]).toEqual([retryId]);
    expect(replaced.ordering.size).toBe(0);
  });
});
