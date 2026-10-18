import { ApiError, DeviceList, Session, type DevicesEvent, type GatewayEvent } from "@venom/contracts";
import { beginSecretWordLogin } from "@venom/identity/client";
import { deviceInfo } from "@venom/identity/testing";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeCodes } from "../src/app.ts";
import {
  attachOverHttp,
  call,
  createEnvironment,
  destroyEnvironment,
  openLive,
  signUpOverHttp,
  startGateway,
  type Environment,
  type RunningGateway,
} from "./harness.ts";

const email = "ninette@venom.test";
const secretWord = "blue horse river";

let environment: Environment;
let gateway: RunningGateway;

const isDevices = (event: GatewayEvent): event is DevicesEvent => event.type === "devices";

beforeAll(async () => {
  environment = await createEnvironment();
  gateway = await startGateway(environment);
});

afterAll(async () => {
  await gateway?.stop();
  await destroyEnvironment(environment);
});

describe("Phase 3 definition of done, over the real gateway", () => {
  it("creates an account, attaches a second computer, and shows both as devices of one account", async () => {
    const first = await signUpOverHttp(gateway.base, environment.mailer, email, secretWord, deviceInfo("Work laptop"));
    const live = openLive(gateway.base, first.device_token);
    await live.opened;
    await live.until((event) => isDevices(event) && event.devices.some((device) => device.status === "active"));

    const second = await attachOverHttp(gateway.base, environment.mailer, email, secretWord, deviceInfo("Second profile"));
    expect(second.account.id).toBe(first.account.id);

    const seen = await live.until((event) => isDevices(event) && event.devices.length === 2);
    expect(isDevices(seen) && seen.devices.map((device) => device.name)).toEqual(["Work laptop", "Second profile"]);

    for (const session of [first, second]) {
      const list = DeviceList.parse(await (await call(gateway.base, "GET", "/v1/devices", { token: session.device_token })).json());
      expect(list.current_device_id).toBe(session.device.id);
      expect(list.devices.map((device) => device.id)).toEqual([first.device.id, second.device.id]);
    }

    const me = Session.parse(await (await call(gateway.base, "GET", "/v1/session", { token: second.device_token })).json());
    expect(me).toMatchObject({ account: { email }, device: { name: "Second profile" } });
    live.socket.close();
  });

  it("refuses the wrong secret word", async () => {
    const flow = await beginSecretWordLogin("blue horse ocean");
    const response = await call(gateway.base, "POST", "/v1/attach", { body: { email, start_login_request: flow.startLoginRequest } });
    expect(response.status).toBe(201);
    const challenge = (await response.json()) as { attach_id: string; login_response: string };
    expect(flow.finish(challenge.login_response)).toBeNull();

    const forge = () =>
      call(gateway.base, "POST", "/v1/attach/prove", {
        body: { attach_id: challenge.attach_id, secret_word_proof: randomBytes(192).toString("base64url") },
      });
    const refused = await forge();
    expect(refused.status).toBe(401);
    expect(ApiError.parse(await refused.json()).error).toBe("secret_word_incorrect");
    expect((await forge()).status).toBe(410);
  });

  it("removes a device: its live link closes and its token stops working", async () => {
    const owner = await attachOverHttp(gateway.base, environment.mailer, email, secretWord, deviceInfo("Keeper"));
    const lost = await attachOverHttp(gateway.base, environment.mailer, email, secretWord, deviceInfo("Lost laptop"));
    const live = openLive(gateway.base, lost.device_token);
    await live.opened;

    const removed = await call(gateway.base, "DELETE", `/v1/devices/${lost.device.id}`, { token: owner.device_token });
    expect(removed.status).toBe(200);
    expect(await live.closed).toBe(closeCodes.revoked);
    expect((await call(gateway.base, "GET", "/v1/session", { token: lost.device_token })).status).toBe(401);

    const list = DeviceList.parse(await (await call(gateway.base, "GET", "/v1/devices", { token: owner.device_token })).json());
    expect(list.devices.map((device) => device.name)).not.toContain("Lost laptop");
  });

  it("lets a device report only its own capabilities", async () => {
    const device = await attachOverHttp(gateway.base, environment.mailer, email, secretWord, deviceInfo("Reporter"));
    const capabilities = { ...device.device.capabilities, notifications: true };

    const own = await call(gateway.base, "PUT", "/v1/devices/current/capabilities", {
      token: device.device_token,
      body: { device_id: device.device.id, capabilities },
    });
    expect(own.status).toBe(200);

    const other = await call(gateway.base, "PUT", "/v1/devices/current/capabilities", {
      token: device.device_token,
      body: { device_id: device.account.id, capabilities },
    });
    expect(other.status).toBe(403);
  });

  it("marks a device active while connected and offline after it leaves", async () => {
    const watcher = await attachOverHttp(gateway.base, environment.mailer, email, secretWord, deviceInfo("Watcher"));
    const roamer = await attachOverHttp(gateway.base, environment.mailer, email, secretWord, deviceInfo("Roamer"));
    const watching = openLive(gateway.base, watcher.device_token);
    await watching.opened;

    const roaming = openLive(gateway.base, roamer.device_token);
    await roaming.opened;
    const statusOf = (event: GatewayEvent) => (isDevices(event) ? event.devices.find((device) => device.id === roamer.device.id)?.status : undefined);
    await watching.until((event) => statusOf(event) === "active");

    roaming.socket.close();
    await watching.until((event) => statusOf(event) === "offline");
    watching.socket.close();
  });

  it("explains signup problems in the shared error shape", async () => {
    const bad = await call(gateway.base, "POST", "/v1/signup", { body: { name: "", email: "nope" } });
    expect(bad.status).toBe(400);
    const error = ApiError.parse(await bad.json());
    expect(error.error).toBe("invalid_request");
    expect(new Set(error.issues?.map((issue) => issue.path))).toEqual(new Set(["email", "name"]));

    const started = (await (await call(gateway.base, "POST", "/v1/signup", { body: { name: "Again", email } })).json()) as { signup_id: string };
    const taken = await call(gateway.base, "POST", "/v1/signup/verify", {
      body: { signup_id: started.signup_id, code: environment.mailer.lastCodeFor(email) },
    });
    expect(taken.status).toBe(409);
    expect(ApiError.parse(await taken.json()).error).toBe("account_exists");
  });
});
