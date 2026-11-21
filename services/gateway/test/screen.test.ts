import type { DeviceSession, ScreenSignalEvent } from "@venom/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { attachOverHttp, call, createEnvironment, destroyEnvironment, openLive, signUpOverHttp, startGateway, type Environment, type RunningGateway } from "./harness.ts";

let environment: Environment;
let accounts = 0;

beforeAll(async () => {
  environment = await createEnvironment();
});

afterAll(async () => {
  await destroyEnvironment(environment);
});

async function account(gateway: RunningGateway): Promise<{ readonly laptop: DeviceSession; readonly phone: DeviceSession }> {
  accounts += 1;
  const email = `screen-${accounts}@venom.test`;
  const laptop = await signUpOverHttp(gateway.base, environment.mailer, email, "screen secret word");
  const phone = await attachOverHttp(gateway.base, environment.mailer, email, "screen secret word");
  return { laptop, phone };
}

function signal(to: string, kind: "watch" | "leave" = "watch") {
  return { to_device_id: to, session_id: crypto.randomUUID(), signal: { kind } };
}

const isSignal = (event: { readonly type: string }): event is ScreenSignalEvent => event.type === "screen_signal";

describe("live screen signals", () => {
  it("carries a signal only to the chosen device of the same account, naming who sent it", async () => {
    const gateway = await startGateway(environment);
    const { laptop, phone } = await account(gateway);
    const laptopLive = openLive(gateway.base, laptop.device_token);
    const phoneLive = openLive(gateway.base, phone.device_token);
    await Promise.all([laptopLive.opened, phoneLive.opened]);

    const sent = signal(laptop.device.id);
    const response = await call(gateway.base, "POST", "/v1/screen/signal", { token: phone.device_token, body: sent });
    expect(response.status).toBe(204);

    const received = await laptopLive.until(isSignal);
    expect(received).toMatchObject({ from_device_id: phone.device.id, session_id: sent.session_id, signal: { kind: "watch" } });
    expect(phoneLive.events.some(isSignal)).toBe(false);

    for (const live of [laptopLive, phoneLive]) live.socket.close();
    await gateway.stop();
  });

  it("refuses a device of another account, a device that is away, and the sender itself", async () => {
    const gateway = await startGateway(environment);
    const { laptop, phone } = await account(gateway);
    const stranger = await account(gateway);
    const strangerLive = openLive(gateway.base, stranger.laptop.device_token);
    await strangerLive.opened;

    const toStranger = await call(gateway.base, "POST", "/v1/screen/signal", { token: phone.device_token, body: signal(stranger.laptop.device.id) });
    expect(toStranger.status).toBe(409);
    const toAway = await call(gateway.base, "POST", "/v1/screen/signal", { token: phone.device_token, body: signal(laptop.device.id) });
    expect(toAway.status).toBe(409);
    const phoneLive = openLive(gateway.base, phone.device_token);
    await phoneLive.opened;
    const toItself = await call(gateway.base, "POST", "/v1/screen/signal", { token: phone.device_token, body: signal(phone.device.id) });
    expect(toItself.status).toBe(409);
    expect(strangerLive.events.some(isSignal)).toBe(false);

    for (const live of [strangerLive, phoneLive]) live.socket.close();
    await gateway.stop();
  });

  it("refuses an unknown signal and a signal from a device that is not signed in", async () => {
    const gateway = await startGateway(environment);
    const { laptop, phone } = await account(gateway);
    const laptopLive = openLive(gateway.base, laptop.device_token);
    await laptopLive.opened;

    const invented = await call(gateway.base, "POST", "/v1/screen/signal", {
      token: phone.device_token,
      body: { to_device_id: laptop.device.id, session_id: crypto.randomUUID(), signal: { kind: "click", x: 0.5, y: 0.5 } },
    });
    expect(invented.status).toBe(400);
    const anonymous = await call(gateway.base, "POST", "/v1/screen/signal", { body: signal(laptop.device.id) });
    expect(anonymous.status).toBe(401);
    expect(laptopLive.events.some(isSignal)).toBe(false);

    laptopLive.socket.close();
    await gateway.stop();
  });
});
