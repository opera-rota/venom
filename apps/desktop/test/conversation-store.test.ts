import type { GatewayEvent, Message } from "@venom/contracts";
import { describe, expect, it } from "vitest";
import type { ConnectionState, SendResult, VenomBridge } from "../src/shared/bridge.ts";
import { createConversation, gapWaitMs, type Scheduler } from "../src/renderer/src/conversation-store.ts";

const at = "2026-10-25T10:00:00.000Z";
const requestId = "01a12c54-8d81-756e-8439-b843a4fd7ef0";
const question: Message = {
  id: "01a12c54-0000-7000-8000-000000000001",
  account_id: "01a12a2d-0000-7000-8000-000000000001",
  device_id: "01a12a2d-0000-7000-8000-000000000002",
  speaker: "user",
  text: "Explain what a mutex is",
  created_at: at,
};

function fakeBridge() {
  const eventListeners = new Set<(event: GatewayEvent) => void>();
  const connectionListeners = new Set<(state: ConnectionState) => void>();
  const sent: string[] = [];
  const retried: string[] = [];
  let historyCalls = 0;
  let history: Message[] = [];
  let sendResult: SendResult = { ok: true, requestId };

  const bridge = {
    onEvent: (listener: (event: GatewayEvent) => void) => {
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },
    onConnection: (listener: (state: ConnectionState) => void) => {
      connectionListeners.add(listener);
      return () => connectionListeners.delete(listener);
    },
    connection: async () => "online" as const,
    history: async () => {
      historyCalls += 1;
      return history;
    },
    send: async (text: string) => {
      sent.push(text);
      return sendResult;
    },
    retry: async (origin: string) => {
      retried.push(origin);
      return { ok: true, requestId: "01a12c54-8d81-756e-8439-b843a4fd7ef9" } as const;
    },
  } as unknown as VenomBridge;

  return {
    bridge,
    sent,
    retried,
    historyCalls: () => historyCalls,
    setHistory: (messages: Message[]) => (history = messages),
    failSends: (reason: string) => (sendResult = { ok: false, code: "network", reason }),
    emit: (event: GatewayEvent) => eventListeners.forEach((listener) => listener(event)),
    connect: (state: ConnectionState) => connectionListeners.forEach((listener) => listener(state)),
    listeners: () => eventListeners.size + connectionListeners.size,
  };
}

function manualScheduler() {
  const frames: (() => void)[] = [];
  const timers: { run: () => void; ms: number; cancelled: boolean }[] = [];
  const scheduler: Scheduler = {
    frame: (run) => {
      frames.push(run);
    },
    later: (run, ms) => {
      const timer = { run, ms, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
  };
  return {
    scheduler,
    paint: () => frames.splice(0).forEach((run) => run()),
    frames: () => frames.length,
    elapse: () => timers.splice(0).forEach((timer) => !timer.cancelled && timer.run()),
    timers: () => timers.filter((timer) => !timer.cancelled),
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("conversation store", () => {
  it("loads history when online and batches live events into one redraw per frame", async () => {
    const fake = fakeBridge();
    const clock = manualScheduler();
    fake.setHistory([question]);
    const { store, connect } = createConversation(fake.bridge, clock.scheduler);
    const disconnect = connect();
    await settle();

    expect(store.getState().connection).toBe("online");
    expect(store.getState().messages).toEqual([question]);

    let redraws = 0;
    store.subscribe(() => (redraws += 1));
    fake.emit({ type: "request", request_id: requestId, sequence: 0, emitted_at: at, state: "accepted", detail: null });
    fake.emit({ type: "answer", request_id: requestId, sequence: 1, emitted_at: at, delta: "A mutex" });
    fake.emit({ type: "answer", request_id: requestId, sequence: 2, emitted_at: at, delta: " is a lock." });
    fake.emit({ type: "devices", request_id: requestId, sequence: 0, emitted_at: at, devices: [] });
    expect(clock.frames()).toBe(1);
    expect(redraws).toBe(0);

    clock.paint();
    expect(redraws).toBe(1);
    expect(store.getState().answers.get(requestId)?.text).toBe("A mutex is a lock.");

    disconnect();
    expect(fake.listeners()).toBe(0);
  });

  it("asks the cloud again when a gap does not fill", async () => {
    const fake = fakeBridge();
    const clock = manualScheduler();
    const { connect } = createConversation(fake.bridge, clock.scheduler);
    connect();
    await settle();
    const before = fake.historyCalls();

    fake.emit({ type: "request", request_id: requestId, sequence: 0, emitted_at: at, state: "accepted", detail: null });
    fake.emit({ type: "answer", request_id: requestId, sequence: 2, emitted_at: at, delta: "later" });
    clock.paint();
    expect(clock.timers().map((timer) => timer.ms)).toEqual([gapWaitMs]);

    clock.elapse();
    await settle();
    expect(fake.historyCalls()).toBe(before + 1);
  });

  it("reports a send that did not reach the gateway", async () => {
    const fake = fakeBridge();
    const { store, connect } = createConversation(fake.bridge, manualScheduler().scheduler);
    connect();
    fake.failSends("VENOM's gateway is not reachable. Your message was not sent.");

    expect(await store.getState().send("Hello")).toBe(false);
    expect(fake.sent).toEqual(["Hello"]);
    expect(store.getState().notice).toBe("VENOM's gateway is not reachable. Your message was not sent.");
  });

  it("retries a failed answer by its original request", async () => {
    const fake = fakeBridge();
    const clock = manualScheduler();
    fake.setHistory([question]);
    const { store, connect } = createConversation(fake.bridge, clock.scheduler);
    connect();
    await settle();
    fake.emit({ type: "request", request_id: requestId, sequence: 0, emitted_at: at, state: "accepted", detail: null });
    fake.emit({ type: "message", request_id: requestId, sequence: 1, emitted_at: at, message: question });
    fake.emit({ type: "request", request_id: requestId, sequence: 2, emitted_at: at, state: "failed", detail: "Too slow." });
    clock.paint();

    const failed = store.getState().answers.get(requestId);
    if (failed === undefined) {
      throw new Error("the failed answer is missing");
    }
    expect(await store.getState().retry(failed)).toBe(true);
    expect(fake.retried).toEqual([requestId]);
    expect(store.getState().answers.get("01a12c54-8d81-756e-8439-b843a4fd7ef9")).toMatchObject({ origin: requestId, askedId: question.id });
  });
});
