import { ApiError, MessageHistory, SendMessageAccepted, type DeviceSession } from "@venom/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeCodes } from "../src/app.ts";
import { call, createEnvironment, destroyEnvironment, openLive, signUpOverHttp, startGateway, type Environment } from "./harness.ts";

let environment: Environment;
let session: DeviceSession;

beforeAll(async () => {
  environment = await createEnvironment();
  const gateway = await startGateway(environment);
  session = await signUpOverHttp(gateway.base, environment.mailer, "skeleton@venom.test", "walking skeleton word");
  await gateway.stop();
});

afterAll(async () => {
  await destroyEnvironment(environment);
});

describe("walking skeleton, now signed in", () => {
  it("saves a message, streams tagged events in order, and keeps it after a restart", async () => {
    const gateway = await startGateway(environment);
    const live = openLive(gateway.base, session.device_token);
    await live.opened;

    const response = await call(gateway.base, "POST", "/v1/messages", { token: session.device_token, body: { text: "Hello VENOM" } });
    expect(response.status).toBe(202);
    const { request_id } = SendMessageAccepted.parse(await response.json());

    const events = await live.settled(request_id);
    expect(events.map((event) => event.sequence)).toEqual([0, 1, 2, 3]);
    expect(events.map((event) => (event.type === "message" ? `message:${event.message.speaker}` : event.type === "request" ? `request:${event.state}` : event.type))).toEqual([
      "request:accepted",
      "message:user",
      "message:venom",
      "request:completed",
    ]);

    live.socket.close();
    await gateway.stop();

    const restarted = await startGateway(environment);
    const history = MessageHistory.parse(await (await call(restarted.base, "GET", "/v1/messages", { token: session.device_token })).json());
    expect(history.messages.slice(-2).map((message) => [message.speaker, message.text])).toEqual([
      ["user", "Hello VENOM"],
      ["venom", "Hello VENOM"],
    ]);
    expect(history.messages.every((message) => message.account_id === session.account.id && message.device_id === session.device.id)).toBe(true);
    await restarted.stop();
  });

  it("keeps concurrent requests apart by request id", async () => {
    const gateway = await startGateway(environment);
    const live = openLive(gateway.base, session.device_token);
    await live.opened;

    const responses = await Promise.all(
      ["one", "two", "three"].map((text) => call(gateway.base, "POST", "/v1/messages", { token: session.device_token, body: { text } })),
    );
    const ids = await Promise.all(responses.map(async (response) => SendMessageAccepted.parse(await response.json()).request_id));
    const streams = await Promise.all(ids.map((id) => live.settled(id)));

    expect(new Set(ids).size).toBe(3);
    streams.forEach((stream, index) => {
      expect(stream.map((event) => event.sequence)).toEqual([0, 1, 2, 3]);
      const texts = stream.flatMap((event) => (event.type === "message" ? [event.message.text] : []));
      expect(texts).toEqual([["one", "two", "three"][index], ["one", "two", "three"][index]]);
    });

    live.socket.close();
    await gateway.stop();
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
