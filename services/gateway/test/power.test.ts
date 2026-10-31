import { ApiError, EngineList, PowerStatus, SendMessageAccepted, type DeviceSession, type PowerEvent } from "@venom/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { answerWith } from "../src/testing.ts";
import { call, createEnvironment, destroyEnvironment, openLive, signUpOverHttp, startGateway, type Environment, type RunningGateway } from "./harness.ts";

let environment: Environment;

beforeAll(async () => {
  environment = await createEnvironment();
});

afterAll(async () => {
  await destroyEnvironment(environment);
});

let accounts = 0;

async function newAccount(gateway: RunningGateway): Promise<DeviceSession & { readonly email: string }> {
  accounts += 1;
  const email = `power-${accounts}@venom.test`;
  return { ...(await signUpOverHttp(gateway.base, environment.mailer, email, "power secret word")), email };
}

async function send(gateway: RunningGateway, token: string, text: string): Promise<Response> {
  return call(gateway.base, "POST", "/v1/messages", { token, body: { text } });
}

async function choose(gateway: RunningGateway, token: string, engine: string): Promise<Response> {
  return call(gateway.base, "PUT", "/v1/engines/current", { token, body: { engine } });
}

describe("power through the gateway", () => {
  it("lists only the engines the brain can use, without their models", async () => {
    const gateway = await startGateway(environment);
    gateway.brain.available = ["dove", "turbo", "utopia"];
    const session = await newAccount(gateway);

    const list = EngineList.parse(await (await call(gateway.base, "GET", "/v1/engines", { token: session.device_token })).json());
    expect(list.current).toBe("dove");
    expect(list.engines.map((engine) => engine.name)).toEqual(["Dove", "Turbo", "Utopia"]);
    expect(list.engines[2]?.proficiency.thinking).toBe(5);

    const refused = await choose(gateway, session.device_token, "nova");
    expect(refused.status).toBe(409);
    expect(ApiError.parse(await refused.json()).message).toContain("Nova is not available");
    await gateway.stop();
  });

  it("refuses a paid engine with no power before anything is saved or asked", async () => {
    const gateway = await startGateway(environment);
    const session = await newAccount(gateway);
    expect((await choose(gateway, session.device_token, "utopia")).status).toBe(200);

    const refused = await send(gateway, session.device_token, "Think deeply about this");
    expect(refused.status).toBe(402);
    const error = ApiError.parse(await refused.json());
    expect(error.error).toBe("out_of_power");
    expect(error.message).toContain("out of power for Utopia");
    expect(gateway.brain.requests).toHaveLength(0);
    await gateway.stop();
  });

  it("answers with the chosen engine, spends the real cost and tells every device", async () => {
    const gateway = await startGateway(environment);
    gateway.brain.script = answerWith((text) => `Deep: ${text}`, 6, { input_tokens: 2100, output_tokens: 640, cost_micro_usd: 21_950 });
    const session = await newAccount(gateway);
    await gateway.power.grant({ email: session.email, units: 1000, note: "Test grant" });
    await choose(gateway, session.device_token, "utopia");

    const live = openLive(gateway.base, session.device_token);
    await live.opened;
    const accepted = await send(gateway, session.device_token, "Why is the sky blue?");
    expect(accepted.status).toBe(202);
    const { request_id } = SendMessageAccepted.parse(await accepted.json());
    await live.settled(request_id);
    const spent = await live.until((event): event is PowerEvent => event.type === "power" && event.power.balance < 1000);

    expect(gateway.brain.requests[0]?.engine).toBe("utopia");
    expect(spent.power).toMatchObject({ engine: "utopia", balance: 780, answers_left: 3, answers_left_exact: false });
    const status = PowerStatus.parse(await (await call(gateway.base, "GET", "/v1/power", { token: session.device_token })).json());
    expect(status.balance).toBe(780);
    live.socket.close();
    await gateway.stop();
  });

  it("gives a free engine its daily allowance and then explains when it comes back", async () => {
    const gateway = await startGateway(environment, { freeDailyAnswers: 1 });
    const session = await newAccount(gateway);
    const live = openLive(gateway.base, session.device_token);
    await live.opened;

    const first = await send(gateway, session.device_token, "Hello");
    await live.settled(SendMessageAccepted.parse(await first.json()).request_id);
    const counted = await live.until((event): event is PowerEvent => event.type === "power");
    expect(counted.power).toMatchObject({ engine: "dove", balance: 0, free_used_today: 1, answers_left: 0, answers_left_exact: true });

    const second = await send(gateway, session.device_token, "Hello again");
    expect(second.status).toBe(402);
    expect(ApiError.parse(await second.json()).message).toContain("come back at midnight UTC");
    live.socket.close();
    await gateway.stop();
  });

  it("shows the power meter only to a signed-in device", async () => {
    const gateway = await startGateway(environment);
    expect((await call(gateway.base, "GET", "/v1/power")).status).toBe(401);
    expect((await call(gateway.base, "GET", "/v1/engines")).status).toBe(401);
    await gateway.stop();
  });
});
