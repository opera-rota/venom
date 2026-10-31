import { MessageHistory, SendMessageAccepted, type DeviceSession, type GatewayEvent, type RequestEvent } from "@venom/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { answerWith, scriptedUsage, type BrainStep } from "../src/testing.ts";
import { unanswered } from "../src/requests.ts";
import { attachOverHttp, call, createEnvironment, destroyEnvironment, openLive, signUpOverHttp, startGateway, type Environment, type RunningGateway } from "./harness.ts";

let environment: Environment;
let accounts = 0;

beforeAll(async () => {
  environment = await createEnvironment();
});

afterAll(async () => {
  await destroyEnvironment(environment);
});

interface Pair {
  readonly here: DeviceSession;
  readonly there: DeviceSession;
}

async function pair(gateway: RunningGateway): Promise<Pair> {
  accounts += 1;
  const email = `sync-${accounts}@venom.test`;
  const here = await signUpOverHttp(gateway.base, environment.mailer, email, "sync secret word");
  const there = await attachOverHttp(gateway.base, environment.mailer, email, "sync secret word");
  return { here, there };
}

async function send(gateway: RunningGateway, token: string, text: string): Promise<string> {
  const response = await call(gateway.base, "POST", "/v1/messages", { token, body: { text } });
  expect(response.status).toBe(202);
  return SendMessageAccepted.parse(await response.json()).request_id;
}

async function retry(gateway: RunningGateway, token: string, requestId: string): Promise<string> {
  const response = await call(gateway.base, "POST", "/v1/messages/retry", { token, body: { request_id: requestId } });
  expect(response.status).toBe(202);
  return SendMessageAccepted.parse(await response.json()).request_id;
}

async function history(gateway: RunningGateway, token: string): Promise<MessageHistory> {
  return MessageHistory.parse(await (await call(gateway.base, "GET", "/v1/messages", { token })).json());
}

function shape(events: readonly GatewayEvent[]): unknown[] {
  return events.map(({ emitted_at: _emittedAt, ...event }) => event);
}

function accepted(events: readonly GatewayEvent[]): RequestEvent {
  const first = events[0];
  if (first?.type !== "request" || first.state !== "accepted") {
    throw new Error("the stream did not start with accepted");
  }
  return first;
}

function released(): { readonly hold: Promise<void>; release(): void } {
  let release = () => {};
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { hold, release };
}

describe("sync spine", () => {
  it("shows every exchange on every device of the account, and on no other account", async () => {
    const gateway = await startGateway(environment);
    const { here, there } = await pair(gateway);
    accounts += 1;
    const stranger = await signUpOverHttp(gateway.base, environment.mailer, `sync-${accounts}@venom.test`, "stranger secret word");
    const hereLive = openLive(gateway.base, here.device_token);
    const thereLive = openLive(gateway.base, there.device_token);
    const strangerLive = openLive(gateway.base, stranger.device_token);
    await Promise.all([hereLive.opened, thereLive.opened, strangerLive.opened]);

    const requestId = await send(gateway, here.device_token, "How far is Musanze from Kigali?");
    const [spoken, seen] = await Promise.all([hereLive.settled(requestId), thereLive.settled(requestId)]);

    expect(shape(seen)).toEqual(shape(spoken));
    expect(seen.map((event) => event.sequence)).toEqual(seen.map((_, index) => index));
    const question = seen.find((event) => event.type === "message" && event.message.speaker === "user");
    expect(question?.type === "message" && question.message.device_id).toBe(here.device.id);
    expect(accepted(seen).question).toEqual({ request_id: requestId, message_id: question?.type === "message" ? question.message.id : null });
    expect(seen.at(-1)).toMatchObject({ type: "request", state: "completed", question: null });
    expect(strangerLive.events.some((event) => event.request_id === requestId)).toBe(false);
    expect((await history(gateway, stranger.device_token)).messages).toEqual([]);

    for (const live of [hereLive, thereLive, strangerLive]) live.socket.close();
    await gateway.stop();
  });

  it("lets a device that was away catch up on an answer that is still being written", async () => {
    const gate = released();
    const steps: BrainStep[] = [
      { type: "delta", text: "About " },
      { type: "delta", text: "60 miles" },
      { hold: gate.hold },
      { type: "delta", text: "." },
      { type: "done", intent: "question", text: "About 60 miles.", model: "scripted-model", usage: scriptedUsage },
    ];
    const gateway = await startGateway(environment);
    gateway.brain.script = () => steps;
    const { here, there } = await pair(gateway);
    const hereLive = openLive(gateway.base, here.device_token);
    await hereLive.opened;

    const requestId = await send(gateway, here.device_token, "How far is Musanze in miles?");
    await hereLive.until((event) => event.request_id === requestId && event.type === "answer" && event.delta === "60 miles");

    const away = await history(gateway, there.device_token);
    const question = away.messages.at(-1);
    expect(question?.text).toBe("How far is Musanze in miles?");
    expect(away.pending).toEqual([
      { request_id: requestId, question: { request_id: requestId, message_id: question?.id }, sequence: 3, text: "About 60 miles", failure: null },
    ]);

    const thereLive = openLive(gateway.base, there.device_token);
    await thereLive.opened;
    gate.release();
    const rest = await thereLive.settled(requestId);

    expect(rest.every((event) => event.sequence > 3)).toBe(true);
    expect(away.pending[0]?.text + rest.flatMap((event) => (event.type === "answer" ? [event.delta] : [])).join("")).toBe("About 60 miles.");
    expect(rest.map((event) => event.type)).toEqual(["answer", "message", "request"]);
    const caughtUp = await history(gateway, there.device_token);
    expect(caughtUp.pending).toEqual([]);
    expect(caughtUp.messages.at(-1)?.text).toBe("About 60 miles.");

    hereLive.socket.close();
    thereLive.socket.close();
    await gateway.stop();
  });

  it("keeps a failed answer for every device, and lets another device answer it again", async () => {
    const gateway = await startGateway(environment);
    gateway.brain.script = () => [
      { type: "delta", text: "Half" },
      { type: "failed", reason: "timeout", detail: "The model took too long to answer." },
    ];
    const { here, there } = await pair(gateway);
    const hereLive = openLive(gateway.base, here.device_token);
    const thereLive = openLive(gateway.base, there.device_token);
    await Promise.all([hereLive.opened, thereLive.opened]);

    const failedId = await send(gateway, here.device_token, "What is a semaphore?");
    await Promise.all([hereLive.settled(failedId), thereLive.settled(failedId)]);
    const failed = await history(gateway, there.device_token);
    const question = failed.messages.at(-1);
    expect(failed.pending).toEqual([
      {
        request_id: failedId,
        question: { request_id: failedId, message_id: question?.id },
        sequence: 3,
        text: "Half",
        failure: "The model took too long to answer.",
      },
    ]);

    gateway.brain.script = answerWith(() => "A semaphore counts permits.");
    const retriedId = await retry(gateway, there.device_token, failedId);
    const [onHere] = await Promise.all([hereLive.settled(retriedId), thereLive.settled(retriedId)]);
    expect(accepted(onHere).question).toEqual({ request_id: failedId, message_id: question?.id });
    expect(onHere.some((event) => event.type === "message" && event.message.speaker === "user")).toBe(false);

    const answered = await history(gateway, here.device_token);
    expect(answered.pending).toEqual([]);
    expect(answered.messages.at(-1)?.text).toBe("A semaphore counts permits.");

    hereLive.socket.close();
    thereLive.socket.close();
    await gateway.stop();
  });

  it("after a restart, still offers to answer a question that was never answered", async () => {
    const first = await startGateway(environment);
    first.brain.script = () => [{ type: "delta", text: "Thinking" }, { pause: 60_000 }];
    const { here, there } = await pair(first);
    const live = openLive(first.base, here.device_token);
    await live.opened;
    const lostId = await send(first, here.device_token, "A question cut off by a restart");
    await live.until((event) => event.request_id === lostId && event.type === "answer");
    live.socket.close();
    await first.stop();

    const gateway = await startGateway(environment);
    const thereLive = openLive(gateway.base, there.device_token);
    await thereLive.opened;
    await thereLive.settled(await send(gateway, there.device_token, "A question after the restart"));

    const after = await history(gateway, there.device_token);
    const lost = after.messages.find((message) => message.text === "A question cut off by a restart");
    expect(after.pending).toEqual([{ request_id: lostId, question: { request_id: lostId, message_id: lost?.id }, sequence: 0, text: "", failure: unanswered }]);

    await thereLive.settled(await retry(gateway, there.device_token, lostId));
    expect((await history(gateway, here.device_token)).pending).toEqual([]);

    thereLive.socket.close();
    await gateway.stop();
  });
});
