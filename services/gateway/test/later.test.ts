import { LaterItem, LaterList, SendMessageAccepted, type DeviceSession, type GatewayEvent } from "@venom/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { answerWith, scriptedBrain } from "../src/testing.ts";
import { call, createEnvironment, destroyEnvironment, openLive, signUpOverHttp, startGateway, type Environment, type RunningGateway } from "./harness.ts";

let environment: Environment;
let gateway: RunningGateway;
let session: DeviceSession;
let stranger: DeviceSession;

beforeAll(async () => {
  environment = await createEnvironment();
  gateway = await startGateway(environment, { brain: scriptedBrain(answerWith(() => "Kigali is the capital of Rwanda.")) });
  session = await signUpOverHttp(gateway.base, environment.mailer, "later@venom.test", "later secret word");
  stranger = await signUpOverHttp(gateway.base, environment.mailer, "stranger@venom.test", "stranger secret word");
});

afterAll(async () => {
  await gateway?.stop();
  await destroyEnvironment(environment);
});

async function ask(text: string): Promise<readonly GatewayEvent[]> {
  const live = openLive(gateway.base, session.device_token);
  await live.opened;
  const response = await call(gateway.base, "POST", "/v1/messages", { token: session.device_token, body: { text } });
  const events = await live.settled(SendMessageAccepted.parse(await response.json()).request_id);
  live.socket.close();
  return events;
}

async function listed(token: string): Promise<LaterList> {
  return LaterList.parse(await (await call(gateway.base, "GET", "/v1/later", { token })).json());
}

describe("for later: an answer is kept only when she asks", () => {
  it("keeps the answer, says where it is, and keeps nothing for an ordinary question", async () => {
    const events = await ask("What is the capital of Rwanda? Keep it for later");
    const said = events.flatMap((event) => (event.type === "message" && event.message.speaker === "venom" ? [event.message.text] : []));
    expect(said).toEqual(["Kigali is the capital of Rwanda.", "I kept this for later. You will find it in Screen, under For later."]);
    expect(events.at(-1)).toMatchObject({ type: "request", state: "completed" });

    await ask("What is the capital of Kenya?");
    const { items } = await listed(session.device_token);
    expect(items.map((item) => [item.title, item.body, item.seen_at])).toEqual([["What is the capital of Rwanda?", "Kigali is the capital of Rwanda.", null]]);
  });

  it("marks an item seen and removes it, telling every window, and only for its own account", async () => {
    const [item] = (await listed(session.device_token)).items;
    expect(item).toBeDefined();
    const id = item?.id ?? "";
    const live = openLive(gateway.base, session.device_token);
    await live.opened;

    expect((await call(gateway.base, "POST", `/v1/later/${id}/seen`, { token: stranger.device_token })).status).toBe(404);
    expect((await call(gateway.base, "DELETE", `/v1/later/${id}`, { token: stranger.device_token })).status).toBe(404);

    const seen = await call(gateway.base, "POST", `/v1/later/${id}/seen`, { token: session.device_token });
    expect(seen.status).toBe(200);
    expect(LaterItem.parse(await seen.json()).seen_at).not.toBeNull();
    const removed = await call(gateway.base, "DELETE", `/v1/later/${id}`, { token: session.device_token });
    expect(removed.status).toBe(204);
    await live.until((event) => event.type === "later_removed" && event.item_id === id);
    expect(live.events.some((event) => event.type === "later" && event.item.id === id && event.item.seen_at !== null)).toBe(true);
    expect((await listed(session.device_token)).items).toEqual([]);
    expect((await call(gateway.base, "DELETE", `/v1/later/${id}`, { token: session.device_token })).status).toBe(404);
    live.socket.close();
  });
});
