import { Session, type DeviceSession } from "@venom/contracts";
import type { AuthView, StepResult } from "../shared/bridge.ts";
import type { Api } from "./api.ts";
import type { CredentialVault, StoredCredential } from "./vault.ts";

export interface SessionManagerOptions {
  readonly api: Api;
  readonly vault: CredentialVault;
}

export const removedNotice = "This device was removed from your VENOM. Attach it again with your email and secret word.";

export const expiredNotice = "This device is no longer signed in to VENOM. Attach it again with your email and secret word.";

export class SessionManager {
  readonly #api: Api;
  readonly #vault: CredentialVault;
  readonly #listeners = new Set<(view: AuthView) => void>();
  #view: AuthView = { kind: "loading" };
  #credential: StoredCredential | null = null;

  constructor({ api, vault }: SessionManagerOptions) {
    this.#api = api;
    this.#vault = vault;
  }

  get view(): AuthView {
    return this.#view;
  }

  get token(): string | null {
    return this.#credential?.device_token ?? null;
  }

  onChange(listener: (view: AuthView) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async start(): Promise<void> {
    const stored = this.#vault.read();
    if (stored === null) {
      this.#set({ kind: "signed_out", notice: null });
      return;
    }
    this.#credential = stored;
    this.#set({ kind: "signed_in", account: stored.session.account, device: stored.session.device });
    await this.refresh();
  }

  async refresh(): Promise<void> {
    const credential = this.#credential;
    if (credential === null) {
      return;
    }
    const current = await this.#api.request("GET", "/v1/session", { schema: Session, token: credential.device_token });
    if (this.#credential !== credential) {
      return;
    }
    if (current.ok) {
      this.#adopt({ device_token: credential.device_token, session: current.value });
    } else if (current.code === "unauthorized") {
      this.forget(expiredNotice);
    }
  }

  async signIn(session: DeviceSession): Promise<void> {
    const credential: StoredCredential = {
      device_token: session.device_token,
      session: { account: session.account, device: session.device },
    };
    this.#adopt(credential);
  }

  async signOut(): Promise<StepResult> {
    const credential = this.#credential;
    if (credential === null) {
      return { ok: true };
    }
    const removed = await this.#api.request("DELETE", `/v1/devices/${credential.session.device.id}`, { token: credential.device_token });
    if (!removed.ok && removed.code !== "unauthorized" && removed.code !== "not_found") {
      return removed;
    }
    this.forget(null);
    return { ok: true };
  }

  forget(notice: string | null): void {
    this.#vault.clear();
    this.#credential = null;
    this.#set({ kind: "signed_out", notice });
  }

  #adopt(credential: StoredCredential): void {
    this.#credential = credential;
    this.#vault.write(credential);
    this.#set({ kind: "signed_in", account: credential.session.account, device: credential.session.device });
  }

  #set(view: AuthView): void {
    this.#view = view;
    for (const listener of this.#listeners) {
      listener(view);
    }
  }
}
