import { ChatDocument, DrillKind, type DeviceInfo } from "@venom/contracts";
import { Api } from "@desktop/main/api.ts";
import { documentFileName, documentText } from "@desktop/main/documents.ts";
import { GatewayClient } from "@desktop/main/gateway-client.ts";
import { HaltController } from "@desktop/main/halt.ts";
import { Onboarding } from "@desktop/main/onboarding.ts";
import { expiredNotice, removedNotice, SessionManager } from "@desktop/main/session-manager.ts";
import type { AuthView, Failure, SaveResult, VenomBridge } from "@desktop/shared/bridge.ts";
import { newPhoneKeys } from "./phone-keys.ts";
import { phoneLink } from "./phone-link.ts";
import { PhoneCredentialStore, type PhoneStorage } from "./phone-store.ts";

export interface PhoneBridgeOptions {
  readonly origin: string;
  readonly storage: PhoneStorage;
  readonly device: DeviceInfo;
}

const unreadable: Failure = { ok: false, code: "invalid_request", reason: "VENOM could not read that request." };

function openLink(url: string): void {
  if (!URL.canParse(url)) {
    return;
  }
  const target = new URL(url);
  if (target.protocol === "https:" || target.protocol === "http:") {
    window.open(target.href, "_blank", "noopener,noreferrer");
  }
}

function saveDocument(document: ChatDocument): SaveResult {
  const parsed = ChatDocument.safeParse(document);
  if (!parsed.success) {
    return unreadable;
  }
  const name = documentFileName(parsed.data.title);
  const link = window.document.createElement("a");
  link.href = URL.createObjectURL(new Blob([documentText(parsed.data)], { type: "text/markdown;charset=utf-8" }));
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
  return { ok: true, saved: name };
}

export function createPhoneBridge({ origin, storage, device }: PhoneBridgeOptions): VenomBridge {
  const api = new Api(origin);
  const sessions = new SessionManager({ api, vault: new PhoneCredentialStore(storage), newKeys: newPhoneKeys });
  const gateway = new GatewayClient({
    api,
    link: phoneLink,
    trust: async () => {
      await sessions.ensureKeys();
      return sessions.trust;
    },
  });
  const halt = new HaltController({ send: (stopId) => gateway.halt(stopId), haltLocally: () => 0 });
  const onboarding = new Onboarding({ api, device: () => device, complete: (session) => sessions.signIn(session) });
  let refreshed: string | null = null;

  const follow = (view: AuthView) => {
    const token = sessions.token;
    if (view.kind === "signed_in" && token !== null) {
      gateway.start(token);
    } else {
      gateway.stop();
      refreshed = null;
    }
  };

  sessions.onChange(follow);
  gateway.onState((state) => {
    const view = sessions.view;
    if (state === "online" && view.kind === "signed_in" && refreshed !== view.device.id) {
      refreshed = view.device.id;
      void sessions.refresh();
    }
  });
  gateway.onRevoked((reason) => sessions.forget(reason === "removed" ? removedNotice : expiredNotice));
  void sessions.start();

  return {
    auth: async () => sessions.view,
    onAuth: (listener) => sessions.onChange(listener),
    signup: {
      start: (name, email) => onboarding.startSignup(name, email),
      verify: (code) => onboarding.verifySignup(code),
      secretWord: (secretWord, repeated) => onboarding.chooseSecretWord(secretWord, repeated),
    },
    attach: {
      start: (email, secretWord) => onboarding.startAttach(email, secretWord),
      confirm: (code) => onboarding.confirmAttach(code),
    },
    cancelOnboarding: async () => onboarding.reset(),
    signOut: () => sessions.signOut(),
    devices: () => gateway.devices(),
    removeDevice: (deviceId) => gateway.removeDevice(deviceId),
    engines: () => gateway.engines(),
    power: () => gateway.power(),
    chooseEngine: (engine) => gateway.chooseEngine(engine),
    memory: () => gateway.memory(),
    saveMemory: (draft) => gateway.saveMemory(draft),
    editMemory: (memoryId, draft) => gateway.editMemory(memoryId, draft),
    forgetMemory: (memoryId) => gateway.forgetMemory(memoryId),
    later: () => gateway.later(),
    laterSeen: (itemId) => gateway.laterSeen(itemId),
    laterRemove: (itemId) => gateway.laterRemove(itemId),
    history: () => gateway.history(),
    send: (text) => gateway.send(text),
    retry: (requestId) => gateway.retry(requestId),
    stop: async () => {
      if (sessions.view.kind === "signed_in") {
        halt.press();
      }
    },
    halt: async () => halt.view,
    onHalt: (listener) => halt.onChange(listener),
    tasks: () => gateway.tasks(),
    drill: async (kind) => {
      const parsed = DrillKind.safeParse(kind);
      return parsed.success ? gateway.drill(parsed.data) : unreadable;
    },
    taskControl: (taskId, control) => gateway.control(taskId, control),
    stopTask: (taskId) => gateway.stopTask(taskId, crypto.randomUUID()),
    confirm: (taskId, stepId, decision) => gateway.confirm(taskId, stepId, decision),
    moves: (taskId) => gateway.moves(taskId),
    confirmMove: (taskId, moveId, decision) => gateway.confirmMove(taskId, moveId, decision),
    safety: () => gateway.safety(),
    setSafety: (settings) => gateway.setSafety(settings),
    developer: async () => false,
    openLink: async (url) => openLink(url),
    saveDocument: async (document) => saveDocument(document),
    connection: async () => gateway.state,
    onEvent: (listener) => gateway.onEvent(listener),
    onConnection: (listener) => gateway.onState(listener),
  };
}
