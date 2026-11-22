import { DeviceInfo, liveProtocols } from "@venom/contracts";
import { verifyText } from "@venom/safety";
import { describe, expect, it } from "vitest";
import { StoredCredential } from "@desktop/main/credential.ts";
import { describeThisPhone, phonePlatform } from "../src/phone-device.ts";
import { newPhoneKeys, signWithPhoneKey } from "../src/phone-keys.ts";
import { protocolsFor } from "../src/phone-link.ts";
import { PhoneCredentialStore, type PhoneStorage } from "../src/phone-store.ts";

const androidChrome = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36";
const iphoneSafari = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";

function memoryStorage(): PhoneStorage & { readonly saved: Map<string, string> } {
  const saved = new Map<string, string>();
  return {
    saved,
    getItem: (key) => saved.get(key) ?? null,
    setItem: (key, value) => void saved.set(key, value),
    removeItem: (key) => void saved.delete(key),
  };
}

function savedSignIn(): StoredCredential {
  const keys = newPhoneKeys();
  return StoredCredential.parse({
    device_token: `vnm_${"a".repeat(43)}`,
    session: {
      account: {
        id: "0193a3b2-7c4d-7e8f-9a0b-1c2d3e4f5a6b",
        name: "Phone test",
        email: "phone@venom.test",
        settings: { listening_mode: "press_to_talk", confirmation_strictness: "standard" },
        created_at: "2026-11-21T06:00:00.000Z",
      },
      device: {
        id: "0193a3b2-7c4d-7e8f-9a0b-1c2d3e4f5a6c",
        account_id: "0193a3b2-7c4d-7e8f-9a0b-1c2d3e4f5a6b",
        ...describeThisPhone(androidChrome, ""),
        status: "active",
        last_seen_at: null,
        in_use: false,
        locked: false,
      },
    },
    keys: { private_key: keys.privateKey, public_key: keys.publicKey, server_key: null },
  });
}

describe("the phone's own key", () => {
  it("makes keys the gateway can check, in the same shape as the computer's", () => {
    const pair = newPhoneKeys();
    expect(pair.publicKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(pair.privateKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const signature = signWithPhoneKey(pair, "venom-live-v1\nphone\nchallenge\nnonce");
    expect(signature).toMatch(/^[A-Za-z0-9_-]{86}$/);
    expect(verifyText(pair.publicKey, "venom-live-v1\nphone\nchallenge\nnonce", signature)).toBe(true);
    expect(verifyText(pair.publicKey, "venom-live-v1\nphone\nchallenge\nother", signature)).toBe(false);
    expect(verifyText(newPhoneKeys().publicKey, "venom-live-v1\nphone\nchallenge\nnonce", signature)).toBe(false);
  });
});

describe("what the phone says about itself", () => {
  it("names the phone by its kind and model, and never claims it can act", () => {
    const android = describeThisPhone(androidChrome, " SM-G950F ");
    expect(DeviceInfo.safeParse(android).success).toBe(true);
    expect(android).toMatchObject({ type: "phone", name: "Android phone (SM-G950F)", platform: "android" });
    expect(android.capabilities.screen_control).toBe(false);
    expect(describeThisPhone(iphoneSafari, "")).toMatchObject({ name: "iPhone", platform: "ios" });
    expect(phonePlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("windows");
    expect(phonePlatform("Mozilla/5.0 (X11; Linux x86_64)")).toBe("linux");
  });
});

describe("the live link from a browser", () => {
  it("carries the token and the signed challenge as protocols, because a browser cannot send headers", () => {
    expect(protocolsFor("vnm_token", null)).toEqual([liveProtocols.link, `${liveProtocols.bearer}.vnm_token`]);
    expect(protocolsFor("vnm_token", { challengeId: "id", signature: "sig" })).toEqual([
      liveProtocols.link,
      `${liveProtocols.bearer}.vnm_token`,
      `${liveProtocols.challenge}.id`,
      `${liveProtocols.signature}.sig`,
    ]);
  });
});

describe("the phone's saved sign-in", () => {
  it("keeps only a valid sign-in and forgets it on request", () => {
    const storage = memoryStorage();
    const store = new PhoneCredentialStore(storage);
    expect(store.read()).toBeNull();

    storage.setItem("venom.credential", "{not json");
    expect(store.read()).toBeNull();
    storage.setItem("venom.credential", JSON.stringify({ device_token: "nope" }));
    expect(store.read()).toBeNull();

    const credential = savedSignIn();
    store.write(credential);
    expect(store.read()).toEqual(credential);

    store.clear();
    expect(store.read()).toBeNull();
    expect(storage.saved.size).toBe(0);
  });
});
