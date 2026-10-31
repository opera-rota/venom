import {
  ApiError,
  MemoryForgotten,
  MemoryItem,
  MemoryList,
  MessageHistory,
  SendMessageAccepted,
  type DeviceSession,
  type ForgottenEvent,
  type MemoryEvent,
  type PowerEvent,
  type RequestEvent,
} from "@venom/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { answerWith } from "../src/testing.ts";
import { attachOverHttp, call, createEnvironment, destroyEnvironment, openLive, signUpOverHttp, startGateway, type Environment, type RunningGateway } from "./harness.ts";

let environment: Environment;
let accounts = 0;

beforeAll(async () => {
  environment = await createEnvironment();
});

afterAll(async () => {
  await destroyEnvironment(environment);
});

async function newAccount(gateway: RunningGateway): Promise<DeviceSession & { readonly email: string }> {
  accounts += 1;
  const email = `memory-${accounts}@venom.test`;
  return { ...(await signUpOverHttp(gateway.base, environment.mailer, email, "memory secret word")), email };
}

async function send(gateway: RunningGateway, token: string, text: string): Promise<string> {
  const response = await call(gateway.base, "POST", "/v1/messages", { token, body: { text } });
  expect(response.status).toBe(202);
  return SendMessageAccepted.parse(await response.json()).request_id;
}

async function listed(gateway: RunningGateway, token: string): Promise<MemoryList> {
  return MemoryList.parse(await (await call(gateway.base, "GET", "/v1/memory", { token })).json());
}

async function add(gateway: RunningGateway, token: string, type: string, content: string): Promise<MemoryItem> {
  const response = await call(gateway.base, "POST", "/v1/memory", { token, body: { type, content } });
  expect(response.status).toBe(201);
  return MemoryItem.parse(await response.json());
}

describe("memory through the gateway", () => {
  it("keeps what it is told, uses it later without a reminder, and stops after forgetting", async () => {
    const gateway = await startGateway(environment);
    gateway.brain.script = answerWith(() => "Got it.");
    const session = await newAccount(gateway);
    const second = await attachOverHttp(gateway.base, environment.mailer, session.email, "memory secret word");
    const here = openLive(gateway.base, session.device_token);
    const there = openLive(gateway.base, second.device_token);
    await Promise.all([here.opened, there.opened]);

    const told = await send(gateway, session.device_token, "Remember that I prefer metric units");
    await here.settled(told);
    const saved = await there.until((event): event is MemoryEvent => event.type === "memory");
    expect(saved.item).toMatchObject({ type: "preference", content: "I prefer metric units", source: "chat" });
    expect(gateway.brain.requests[0]?.remembered).toMatchObject({ type: "preference", content: "I prefer metric units" });
    expect(gateway.brain.requests[0]?.memories).toEqual([]);

    await here.settled(await send(gateway, session.device_token, "How far is Paris from Berlin?"));
    expect(gateway.brain.requests[1]?.remembered).toBeNull();
    expect(gateway.brain.requests[1]?.memories.map((memory) => memory.content)).toEqual(["I prefer metric units"]);

    const forget = await call(gateway.base, "DELETE", `/v1/memory/${saved.item.id}`, { token: second.device_token });
    expect(forget.status).toBe(200);
    const forgotten = MemoryForgotten.parse(await forget.json());
    expect(forgotten.message_ids).toHaveLength(2);
    const toldHere = await here.until((event): event is ForgottenEvent => event.type === "forgotten");
    expect(toldHere.message_ids).toEqual(forgotten.message_ids);

    const messages = MessageHistory.parse(await (await call(gateway.base, "GET", "/v1/messages", { token: session.device_token })).json()).messages;
    expect(messages.map((message) => message.text)).toEqual(["How far is Paris from Berlin?", "Got it."]);

    await here.settled(await send(gateway, session.device_token, "And from Paris to Rome?"));
    const after = gateway.brain.requests[2];
    expect(after?.memories).toEqual([]);
    expect(after?.history.some((entry) => entry.text.includes("metric"))).toBe(false);
    expect((await listed(gateway, session.device_token)).items).toEqual([]);

    here.socket.close();
    there.socket.close();
    await gateway.stop();
  });

  it("finds a note by meaning and by words, even while embeddings are down", async () => {
    const gateway = await startGateway(environment);
    const session = await newAccount(gateway);
    await add(gateway, session.device_token, "event", "My sister Ana's birthday is on 12 March");
    await add(gateway, session.device_token, "fact", "My car is a blue Toyota");
    const live = openLive(gateway.base, session.device_token);
    await live.opened;

    await live.settled(await send(gateway, session.device_token, "What did I say about my sister's birthday?"));
    expect(gateway.brain.requests.at(-1)?.memories.map((memory) => memory.content)).toEqual(["My sister Ana's birthday is on 12 March"]);

    gateway.brain.embedding.working = false;
    await live.settled(await send(gateway, session.device_token, "Which car do I drive?"));
    expect(gateway.brain.requests.at(-1)?.memories.map((memory) => memory.content)).toEqual(["My car is a blue Toyota"]);

    live.socket.close();
    await gateway.stop();
  });

  it("charges the power the memory search really cost", async () => {
    const gateway = await startGateway(environment);
    gateway.brain.embedding.usage = { input_tokens: 9, output_tokens: 0, cost_micro_usd: 300 };
    const session = await newAccount(gateway);
    await gateway.power.grant({ email: session.email, units: 1000, note: "Test grant" });
    await call(gateway.base, "PUT", "/v1/engines/current", { token: session.device_token, body: { engine: "utopia" } });
    await add(gateway, session.device_token, "fact", "My office is at Norrsken House");
    const live = openLive(gateway.base, session.device_token);
    await live.opened;

    await live.settled(await send(gateway, session.device_token, "Where is my office?"));
    const spent = await live.until((event): event is PowerEvent => event.type === "power" && event.power.balance < 1000);
    expect(spent.power.balance).toBe(1000 - 28);

    live.socket.close();
    await gateway.stop();
  });

  it("lets the user add, edit and forget memories, and keeps accounts apart", async () => {
    const gateway = await startGateway(environment);
    const mine = await newAccount(gateway);
    const theirs = await newAccount(gateway);
    const item = await add(gateway, mine.device_token, "preference", "I prefer imperial units");
    expect(item.source).toBe("settings");

    const edited = await call(gateway.base, "PUT", `/v1/memory/${item.id}`, {
      token: mine.device_token,
      body: { type: "preference", content: "I prefer metric units" },
    });
    expect(MemoryItem.parse(await edited.json()).content).toBe("I prefer metric units");

    const blank = await call(gateway.base, "POST", "/v1/memory", { token: mine.device_token, body: { type: "fact", content: "   " } });
    expect(blank.status).toBe(400);
    const stranger = await call(gateway.base, "DELETE", `/v1/memory/${item.id}`, { token: theirs.device_token });
    expect(stranger.status).toBe(404);
    expect((await listed(gateway, theirs.device_token)).items).toEqual([]);
    expect((await call(gateway.base, "GET", "/v1/memory")).status).toBe(401);

    expect((await call(gateway.base, "DELETE", `/v1/memory/${item.id}`, { token: mine.device_token })).status).toBe(200);
    expect((await listed(gateway, mine.device_token)).items).toEqual([]);
    await gateway.stop();
  });

  it("says plainly when memory is full instead of pretending to remember", async () => {
    const gateway = await startGateway(environment);
    const session = await newAccount(gateway);
    await environment.owner`
      insert into memories (account_id, type, content, source)
      select ${session.account.id}, 'fact', 'Fact number ' || n, 'settings' from generate_series(1, 500) n
    `;
    const full = await call(gateway.base, "POST", "/v1/memory", { token: session.device_token, body: { type: "fact", content: "One more" } });
    expect(full.status).toBe(409);
    expect(ApiError.parse(await full.json()).error).toBe("memory_full");

    const live = openLive(gateway.base, session.device_token);
    await live.opened;
    const requestId = await send(gateway, session.device_token, "Remember that my car is red");
    const failed = await live.until((event): event is RequestEvent => event.type === "request" && event.request_id === requestId && event.state === "failed");
    expect(failed.detail).toContain("My memory is full");
    expect(gateway.brain.requests).toHaveLength(0);

    live.socket.close();
    await gateway.stop();
  });
});
