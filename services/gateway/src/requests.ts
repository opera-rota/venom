import type { GatewayEvent, Message, MessageHistory, PendingAnswer, QuestionRef } from "@venom/contracts";
import type { Conversation } from "@venom/db";

export const keptFailures = 50;
export const unanswered = "VENOM did not answer this message.";

interface Tracked {
  readonly requestId: string;
  readonly question: QuestionRef;
  sequence: number;
  text: string;
  failure: string | null;
}

export interface Capture {
  history(conversation: Conversation): MessageHistory;
}

function toPending({ requestId, question, sequence, text, failure }: Tracked): PendingAnswer {
  return { request_id: requestId, question, sequence, text, failure };
}

export class LiveRequests {
  readonly #byAccount = new Map<string, Map<string, Tracked>>();
  #trackedSince: string | null = null;

  asked(message: Message): void {
    if (this.#trackedSince === null || message.created_at < this.#trackedSince) {
      this.#trackedSince = message.created_at;
    }
  }

  start(accountId: string, requestId: string, question: QuestionRef): void {
    const requests = this.#requests(accountId);
    for (const [id, tracked] of requests) {
      if (tracked.question.message_id === question.message_id) {
        requests.delete(id);
      }
    }
    requests.set(requestId, { requestId, question, sequence: 0, text: "", failure: null });
  }

  record(accountId: string, event: GatewayEvent): void {
    const requests = this.#byAccount.get(accountId);
    const tracked = requests?.get(event.request_id);
    if (requests === undefined || tracked === undefined) {
      return;
    }
    tracked.sequence = Math.max(tracked.sequence, event.sequence);
    if (event.type === "answer") {
      tracked.text += event.delta;
      return;
    }
    if (event.type !== "request") {
      return;
    }
    if (event.state === "completed") {
      this.#remove(accountId, requests, event.request_id);
    } else if (event.state === "failed") {
      tracked.failure = event.detail ?? unanswered;
      this.#trim(requests);
    }
  }

  forget(accountId: string, messageIds: readonly string[]): void {
    const requests = this.#byAccount.get(accountId);
    if (requests === undefined) {
      return;
    }
    const removed = new Set(messageIds);
    for (const [id, tracked] of requests) {
      if (removed.has(tracked.question.message_id)) {
        this.#remove(accountId, requests, id);
      }
    }
  }

  capture(accountId: string): Capture {
    const tracked = [...(this.#byAccount.get(accountId)?.values() ?? [])].map((entry) => ({ ...entry }));
    const since = this.#trackedSince;
    return {
      history({ messages, unanswered: waiting }) {
        const listed = new Set(messages.map((message) => message.id));
        const asked = new Map(messages.map((message) => [message.id, message.created_at]));
        const covered = new Set(tracked.map((entry) => entry.question.message_id));
        const live = tracked.filter((entry) => entry.failure === null || listed.has(entry.question.message_id)).map(toPending);
        const untracked = waiting
          .filter((question) => !covered.has(question.message_id))
          .filter((question) => since === null || (asked.get(question.message_id) ?? since) < since)
          .map((question) => ({ request_id: question.request_id, question, sequence: 0, text: "", failure: unanswered }));
        return { messages, pending: [...untracked, ...live] };
      },
    };
  }

  #requests(accountId: string): Map<string, Tracked> {
    const existing = this.#byAccount.get(accountId);
    if (existing !== undefined) {
      return existing;
    }
    const created = new Map<string, Tracked>();
    this.#byAccount.set(accountId, created);
    return created;
  }

  #trim(requests: Map<string, Tracked>): void {
    const failed = [...requests.values()].filter((entry) => entry.failure !== null);
    for (const entry of failed.slice(0, Math.max(0, failed.length - keptFailures))) {
      requests.delete(entry.requestId);
    }
  }

  #remove(accountId: string, requests: Map<string, Tracked>, requestId: string): void {
    requests.delete(requestId);
    if (requests.size === 0) {
      this.#byAccount.delete(accountId);
    }
  }
}
