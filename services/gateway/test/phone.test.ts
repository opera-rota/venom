import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeviceInfo, LiveChallenge, liveProtocols, type DeviceSession, type DevicesEvent, type GatewayEvent } from "@venom/contracts";
import { liveChallengeText, newKeyPair, signText, type KeyPair } from "@venom/safety";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadPhoneApp } from "../src/phone.ts";
import { enrollKey } from "./acting-device.ts";
import { attachOverHttp, call, createEnvironment, destroyEnvironment, openLive, signUpOverHttp, startGateway, type Environment, type RunningGateway } from "./harness.ts";

const email = "phone@venom.test";
const secretWord = "green mango sky";

const phoneInfo = DeviceInfo.parse({
  type: "phone",
  name: "Galaxy phone",
  platform: "android",
  capabilities: { screen_control: false, microphone: false, speaker: false, shortcuts: false, notifications: false, network: true },
});

let environment: Environment;
let gateway: RunningGateway;
let folder: string;

const isDevices = (event: GatewayEvent): event is DevicesEvent => event.type === "devices";

async function browserProtocols(session: DeviceSession, pair: KeyPair, signer: KeyPair = pair): Promise<string[]> {
  const response = await call(gateway.base, "POST", "/v1/live/challenge", { token: session.device_token });
  const challenge = LiveChallenge.parse(await response.json());
  const signature = signText(signer, liveChallengeText(session.device.id, challenge.challenge_id, challenge.nonce));
  return [
    liveProtocols.link,
    `${liveProtocols.bearer}.${session.device_token}`,
    `${liveProtocols.challenge}.${challenge.challenge_id}`,
    `${liveProtocols.signature}.${signature}`,
  ];
}

function openAsBrowser(protocols: string[]): Promise<WebSocket> {
  const socket = new WebSocket(`${gateway.base.replace("http", "ws")}/v1/live`, protocols);
  return new Promise((resolve, reject) => {
    socket.addEventListener("open", () => resolve(socket), { once: true });
    socket.addEventListener("error", () => reject(new Error("refused")), { once: true });
  });
}

beforeAll(async () => {
  folder = mkdtempSync(join(tmpdir(), "venom-phone-"));
  mkdirSync(join(folder, "assets"));
  writeFileSync(join(folder, "index.html"), "<!doctype html><title>VENOM</title>");
  writeFileSync(join(folder, "assets", "app-1a2b.js"), "export {};");
  writeFileSync(join(folder, "notes.txt"), "not served");
  const phone = loadPhoneApp(folder);
  if (phone === null) {
    throw new Error("the test phone app did not load");
  }
  environment = await createEnvironment();
  gateway = await startGateway(environment, { phone });
});

afterAll(async () => {
  await gateway?.stop();
  await destroyEnvironment(environment);
  rmSync(folder, { recursive: true, force: true });
});

describe("the phone app over the gateway", () => {
  it("serves the built phone app, its pages and its lasting assets", async () => {
    const bare = await fetch(`${gateway.base}/phone`, { redirect: "manual" });
    expect(bare.status).toBe(302);
    expect(bare.headers.get("location")).toBe("/phone/");

    for (const path of ["/phone/", "/phone/screen"]) {
      const page = await fetch(`${gateway.base}${path}`);
      expect(page.status).toBe(200);
      expect(page.headers.get("content-type")).toBe("text/html; charset=utf-8");
      expect(page.headers.get("cache-control")).toBe("no-cache");
      expect(await page.text()).toContain("<title>VENOM</title>");
    }

    const asset = await fetch(`${gateway.base}/phone/assets/app-1a2b.js`);
    expect(asset.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(asset.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");

    expect((await fetch(`${gateway.base}/phone/notes.txt`)).status).toBe(404);
    expect((await fetch(`${gateway.base}/phone/assets/gone.js`)).status).toBe(404);
  });

  it("does not serve a folder without a built page", () => {
    expect(loadPhoneApp(join(folder, "assets"))).toBeNull();
    expect(loadPhoneApp(join(folder, "missing"))).toBeNull();
  });

  it("joins a phone that opens its signed live link the way a browser must, and shows it to the computer", async () => {
    const computer = await signUpOverHttp(gateway.base, environment.mailer, email, secretWord);
    const watching = openLive(gateway.base, computer.device_token);
    await watching.opened;

    const phone = await attachOverHttp(gateway.base, environment.mailer, email, secretWord, phoneInfo);
    const { pair } = await enrollKey(gateway.base, phone);
    const socket = await openAsBrowser(await browserProtocols(phone, pair));
    expect(socket.protocol).toBe(liveProtocols.link);

    const seen = await watching.until((event) => isDevices(event) && event.devices.some((device) => device.id === phone.device.id && device.status === "active"));
    expect(isDevices(seen) && seen.devices.find((device) => device.id === phone.device.id)).toMatchObject({ type: "phone", name: "Galaxy phone" });

    socket.close();
    watching.socket.close();
  });

  it("refuses a phone's live link signed with the wrong key", async () => {
    const phone = await attachOverHttp(gateway.base, environment.mailer, email, secretWord, phoneInfo);
    const { pair } = await enrollKey(gateway.base, phone);
    await expect(openAsBrowser(await browserProtocols(phone, pair, newKeyPair()))).rejects.toThrow("refused");
  });
});
