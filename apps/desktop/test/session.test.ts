import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Api } from "../src/main/api.ts";
import { expiredNotice, SessionManager } from "../src/main/session-manager.ts";
import { CredentialVault, type Encryptor } from "../src/main/vault.ts";
import type { AuthView } from "../src/shared/bridge.ts";
import { createAccount, createBackend, testEncryptor, type Backend } from "./support.ts";

let backend: Backend;

function vaultIn(folder: string, encryptor: Encryptor = testEncryptor): CredentialVault {
  return new CredentialVault(join(folder, "device-credential.bin"), encryptor);
}

beforeAll(async () => {
  backend = await createBackend();
  await backend.start();
});

afterAll(async () => {
  await backend?.destroy();
});

describe("credential vault", () => {
  it("stores the device credential encrypted and reads it back", async () => {
    const folder = mkdtempSync(join(tmpdir(), "venom-vault-"));
    const session = await createAccount(backend, "vault@venom.test", "vault secret word");
    const vault = vaultIn(folder);
    vault.write({ device_token: session.device_token, session: { account: session.account, device: session.device } });

    expect(readFileSync(join(folder, "device-credential.bin")).toString("utf8")).not.toContain(session.device_token);
    expect(vault.read()?.device_token).toBe(session.device_token);
    vault.clear();
    expect(vault.read()).toBeNull();
  });

  it("treats a damaged file as signed out", () => {
    const folder = mkdtempSync(join(tmpdir(), "venom-vault-"));
    writeFileSync(join(folder, "device-credential.bin"), "garbage");
    expect(vaultIn(folder).read()).toBeNull();
  });

  it("refuses to save when the computer cannot encrypt", () => {
    const folder = mkdtempSync(join(tmpdir(), "venom-vault-"));
    const vault = vaultIn(folder, { ...testEncryptor, available: () => false });
    expect(() => vault.write({} as never)).toThrow(/cannot encrypt/);
  });
});

describe("session manager", () => {
  it("remembers the device across restarts and signs out cleanly", async () => {
    const folder = mkdtempSync(join(tmpdir(), "venom-session-"));
    const api = new Api(backend.url());
    const session = await createAccount(backend, "restart@venom.test", "restart secret word");

    const first = new SessionManager({ api, vault: vaultIn(folder) });
    await first.start();
    expect(first.view.kind).toBe("signed_out");
    await first.signIn(session);
    expect(first.view).toMatchObject({ kind: "signed_in", account: { email: "restart@venom.test" } });

    const reopened = new SessionManager({ api, vault: vaultIn(folder) });
    const views: AuthView[] = [];
    reopened.onChange((view) => views.push(view));
    await reopened.start();
    expect(reopened.token).toBe(session.device_token);
    expect(views.every((view) => view.kind === "signed_in")).toBe(true);

    expect(await reopened.signOut()).toEqual({ ok: true });
    expect(reopened.view).toEqual({ kind: "signed_out", notice: null });
    expect(vaultIn(folder).read()).toBeNull();

    const afterSignOut = new SessionManager({ api, vault: vaultIn(folder) });
    await afterSignOut.start();
    expect(afterSignOut.view.kind).toBe("signed_out");
  });

  it("notices on start that the device was removed while the app was closed", async () => {
    const folder = mkdtempSync(join(tmpdir(), "venom-session-"));
    const api = new Api(backend.url());
    const session = await createAccount(backend, "removed@venom.test", "removed secret word");
    vaultIn(folder).write({ device_token: session.device_token, session: { account: session.account, device: session.device } });

    await api.request("DELETE", `/v1/devices/${session.device.id}`, { token: session.device_token });

    const manager = new SessionManager({ api, vault: vaultIn(folder) });
    await manager.start();
    expect(manager.view).toEqual({ kind: "signed_out", notice: expiredNotice });
  });

  it("stays signed in while the gateway is unreachable", async () => {
    const folder = mkdtempSync(join(tmpdir(), "venom-session-"));
    const session = await createAccount(backend, "offline@venom.test", "offline secret word");
    vaultIn(folder).write({ device_token: session.device_token, session: { account: session.account, device: session.device } });

    const manager = new SessionManager({ api: new Api("http://127.0.0.1:9"), vault: vaultIn(folder) });
    await manager.start();
    expect(manager.view.kind).toBe("signed_in");
  });
});
