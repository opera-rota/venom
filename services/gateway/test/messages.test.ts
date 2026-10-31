import { ApiError, MessageHistory, SendMessageAccepted, type DeviceSession, type GatewayEvent } from "@venom/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeCodes } from "../src/app.ts";
import { answerWith, scriptedBrain } from "../src/testing.ts";
import { call, createEnvironment, destroyEnvironment, openLive, signUpOverHttp, startGateway, type Environment } from "./harness.ts";

let environment: Environment;
let session: DeviceSession;

beforeAll(async () => {
  environment = await createEnvironment();
  const gateway = await startGateway(environment);
  session = await signUpOverHttp(gateway.base, environment.mailer, "conversation@venom.test", "conversation secret word");
  await gateway.stop();
});

afterAll(async () => {
  await destroyEnvironment(environment);
});

function label(event: GatewayEvent): string {
  switch (event.type) {
    case "message":
      return `message:${event.message.speaker}`;
    case "request":
      return `request:${event.state}`;
    case "answer":
      return "answer";
    case "devices":
      return "devices";
    case "power":
      return "power";
    case "memory":
      return "memory";
    case "forgotten":
      return "forgotten";
  }
}

function streamed(events: readonly GatewayEvent[]): string {
  return events.flatMap((event) => (event.type === "answer" ? [event.delta] : [])).join("");
}

async function send(base: string, text: string): Promise<string> {
  const response = await call(base, "POST", "/v1/messages", { token: session.device_token, body: { text } });
  expect(response.status).toBe(202);
  return SendMessageAccepted.parse(await response.json()).request_id;
}

async function history(base: string) {
  return MessageHistory.parse(await (await call(base, "GET", "/v1/messages", { token: session.device_token })).json()).messages;
}

describe("conversation through the gateway", () => {
  it("streams a real answer in order, saves it, and keeps it after a restart", async () => {
    const gateway = await startGateway(environment);
    const live = openLive(gateway.base, session.device_token);
    await live.opened;

    const requestId = await send(gateway.base, "Explain what a mutex is");
    const events = await live.settled(requestId);

    expect(events.map((event) => event.sequence)).toEqual(events.map((_, index) => index));
    const labels = events.map(label);
    expect(labels[0]).toBe("request:accepted");
    expect(labels[1]).toBe("message:user");
    expect(labels.slice(2, -2).every((name) => name === "answer")).toBe(true);
    expect(labels.slice(-2)).toEqual(["message:venom", "request:completed"]);
    expect(streamed(events)).toBe("You asked: Explain what a mutex is");

    const [asked] = gateway.brain.requests;
    expect(asked).toMatchObject({ request_id: requestId, account_id: session.account.id, device_id: session.device.id, text: "Explain what a mutex is" });

    live.socket.close();
    await gateway.stop();

    const restarted = await startGateway(environment);
    expect((await history(restarted.base)).slice(-2).map((message) => [message.speaker, message.text])).toEqual([
      ["user", "Explain what a mutex is"],
      ["venom", "You asked: Explain what a mutex is"],
    ]);
    await restarted.stop();
  });

  it("gives the brain the conversation so far", async () => {
    const gateway = await startGateway(environment);
    const live = openLive(gateway.base, session.device_token);
    await live.opened;

    await live.settled(await send(gateway.base, "Does a mutex block?"));
    const request = gateway.brain.requests.at(-1);
    expect(request?.history.slice(-2)).toEqual([
      { speaker: "user", text: "Explain what a mutex is" },
      { speaker: "venom", text: "You asked: Explain what a mutex is" },
    ]);
    expect(request?.history.some((entry) => entry.text === "Does a mutex block?")).toBe(false);

    live.socket.close();
    await gateway.stop();
  });

  it("keeps concurrent answers apart by request id", async () => {
    const gateway = await startGateway(environment);
    const live = openLive(gateway.base, session.device_token);
    await live.opened;

    const texts = ["one", "two", "three"];
    const ids = await Promise.all(texts.map((text) => send(gateway.base, text)));
    const streams = await Promise.all(ids.map((id) => live.settled(id)));

    expect(new Set(ids).size).toBe(3);
    streams.forEach((stream, index) => {
      expect(stream.map((event) => event.sequence)).toEqual(stream.map((_, position) => position));
      expect(streamed(stream)).toBe(`You asked: ${texts[index]}`);
    });

    live.socket.close();
    await gateway.stop();
  });

  it("fails an answer cleanly, then answers it on retry exactly once", async () => {
    const brain = scriptedBrain(() => [
      { type: "delta", text: "Half" },
      { type: "failed", reason: "timeout", detail: "The model took too long to answer." },
    ]);
    const gateway = await startGateway(environment, { brain });
    const live = openLive(gateway.base, session.device_token);
    await live.opened;

    const failedId = await send(gateway.base, "What is a semaphore?");
    const failed = await live.settled(failedId);
    expect(failed.map(label)).toEqual(["request:accepted", "message:user", "answer", "request:failed"]);
    expect(failed.at(-1)).toMatchObject({ detail: "The model took too long to answer." });
    expect((await history(gateway.base)).at(-1)?.text).toBe("What is a semaphore?");

    brain.script = answerWith(() => "A semaphore counts permits.");
    const retry = await call(gateway.base, "POST", "/v1/messages/retry", { token: session.device_token, body: { request_id: failedId } });
    expect(retry.status).toBe(202);
    const retried = await live.settled(SendMessageAccepted.parse(await retry.json()).request_id);
    expect(retried.map(label)[0]).toBe("request:accepted");
    expect(retried.map(label).slice(-2)).toEqual(["message:venom", "request:completed"]);
    expect(retried.some((event) => event.type === "message" && event.message.speaker === "user")).toBe(false);
    expect(brain.requests.at(-1)?.text).toBe("What is a semaphore?");

    const messages = await history(gateway.base);
    expect(messages.filter((message) => message.text === "What is a semaphore?")).toHaveLength(1);
    expect(messages.at(-1)?.text).toBe("A semaphore counts permits.");

    const again = await call(gateway.base, "POST", "/v1/messages/retry", { token: session.device_token, body: { request_id: failedId } });
    expect(again.status).toBe(409);
    expect(ApiError.parse(await again.json()).error).toBe("conflict");

    const unknown = await call(gateway.base, "POST", "/v1/messages/retry", {
      token: session.device_token,
      body: { request_id: "0199d2a0-7c1e-7a3b-9f2d-1a2b3c4d5e99" },
    });
    expect(unknown.status).toBe(404);

    live.socket.close();
    await gateway.stop();
  });

  it("explains in plain words when the brain cannot be reached", async () => {
    const gateway = await startGateway(environment, { brain: scriptedBrain(() => [{ crash: "unreachable" }]) });
    const live = openLive(gateway.base, session.device_token);
    await live.opened;

    const events = await live.settled(await send(gateway.base, "Hello?"));
    expect(events.at(-1)).toMatchObject({
      type: "request",
      state: "failed",
      detail: "VENOM's brain is not reachable right now. Try again in a moment.",
    });

    live.socket.close();
    await gateway.stop();
  });

  it("stops an unfinished answer quickly when the gateway shuts down", async () => {
    const gateway = await startGateway(environment, { brain: scriptedBrain(() => [{ type: "delta", text: "Thinking" }, { pause: 60_000 }]) });
    const live = openLive(gateway.base, session.device_token);
    await live.opened;

    const requestId = await send(gateway.base, "A very long question");
    await live.until((event) => event.request_id === requestId && event.type === "answer");
    const started = Date.now();
    await gateway.stop();
    expect(Date.now() - started).toBeLessThan(5000);

    const restarted = await startGateway(environment);
    expect((await history(restarted.base)).at(-1)?.text).toBe("A very long question");
    await restarted.stop();
  });

  it("refuses messages without a valid device token", async () => {
    const gateway = await startGateway(environment);

    const anonymous = await call(gateway.base, "POST", "/v1/messages", { body: { text: "hi" } });
    expect(anonymous.status).toBe(401);
    expect(ApiError.parse(await anonymous.json()).error).toBe("unauthorized");

    expect((await call(gateway.base, "GET", "/v1/messages", { token: "vnm_not-a-real-token" })).status).toBe(401);
    expect((await call(gateway.base, "POST", "/v1/messages", { token: session.device_token, body: { text: "   " } })).status).toBe(400);
    expect(
      (await call(gateway.base, "POST", "/v1/messages", { token: session.device_token, body: { text: "hi", device_id: session.device.id } })).status,
    ).toBe(400);
    expect((await call(gateway.base, "POST", "/v1/messages/retry", { body: { request_id: session.device.id } })).status).toBe(401);

    await gateway.stop();
  });

  it("closes live connections that are not signed in", async () => {
    const gateway = await startGateway(environment);
    expect(await openLive(gateway.base).closed).toBe(closeCodes.unauthorized);
    expect(await openLive(gateway.base, `vnm_${"x".repeat(43)}`).closed).toBe(closeCodes.unauthorized);
    await gateway.stop();
  });

  it("answers health and unknown addresses in the shared error shape", async () => {
    const gateway = await startGateway(environment);
    expect(await (await fetch(`${gateway.base}/healthz`)).json()).toEqual({ status: "ok" });
    const missing = await fetch(`${gateway.base}/v1/nothing-here`);
    expect(missing.status).toBe(404);
    expect(ApiError.parse(await missing.json()).error).toBe("not_found");
    await gateway.stop();
  });
});
