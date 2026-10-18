import { app, BrowserWindow, ipcMain, safeStorage, type IpcMainInvokeEvent } from "electron";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { channels, type AuthView } from "../shared/bridge.ts";
import { Api } from "./api.ts";
import { loadConfig } from "./config.ts";
import { describeThisComputer } from "./device-info.ts";
import { GatewayClient } from "./gateway-client.ts";
import { Onboarding } from "./onboarding.ts";
import { expiredNotice, removedNotice, SessionManager } from "./session-manager.ts";
import { CredentialVault } from "./vault.ts";

const config = loadConfig();

if (config.profile !== null) {
  app.setPath("userData", `${app.getPath("userData")}-${config.profile}`);
}

const rendererDevUrl = process.env["ELECTRON_RENDERER_URL"];
const rendererFile = join(import.meta.dirname, "../renderer/index.html");
const trustedOrigin = rendererDevUrl === undefined ? "file://" : new URL(rendererDevUrl).origin;

function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(channel, payload);
  }
}

function fromRenderer(event: IpcMainInvokeEvent): boolean {
  return (event.senderFrame?.url ?? "").startsWith(trustedOrigin);
}

function handle(channel: string, handler: (...args: unknown[]) => unknown): void {
  ipcMain.handle(channel, (event, ...args: unknown[]) => {
    if (!fromRenderer(event)) {
      throw new Error("Refused a request from an untrusted page.");
    }
    return handler(...args);
  });
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    title: config.profile === null ? "VENOM" : `VENOM (${config.profile})`,
    width: 1040,
    height: 760,
    minWidth: 420,
    minHeight: 560,
    show: false,
    backgroundColor: "#050806",
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });

  window.once("ready-to-show", () => window.show());
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(trustedOrigin)) {
      event.preventDefault();
    }
  });

  void (rendererDevUrl === undefined ? window.loadURL(pathToFileURL(rendererFile).href) : window.loadURL(rendererDevUrl));
  return window;
}

function wire(): void {
  const api = new Api(config.gatewayUrl);
  const vault = new CredentialVault(join(app.getPath("userData"), "device-credential.bin"), {
    available: () => safeStorage.isEncryptionAvailable(),
    encrypt: (plain) => safeStorage.encryptString(plain),
    decrypt: (sealed) => safeStorage.decryptString(sealed),
  });
  const sessions = new SessionManager({ api, vault });
  const gateway = new GatewayClient({ api });
  const device = () => describeThisComputer(config.profile);
  const onboarding = new Onboarding({ api, device, complete: (session) => sessions.signIn(session) });
  let reported: string | null = null;

  const follow = (view: AuthView) => {
    broadcast(channels.authChanged, view);
    const token = sessions.token;
    if (view.kind === "signed_in" && token !== null) {
      gateway.start(token);
    } else {
      gateway.stop();
      reported = null;
    }
  };

  sessions.onChange(follow);
  gateway.onEvent((event) => broadcast(channels.event, event));
  gateway.onState((state) => {
    broadcast(channels.connectionChanged, state);
    const view = sessions.view;
    if (state === "online" && view.kind === "signed_in" && reported !== view.device.id) {
      reported = view.device.id;
      void gateway.reportCapabilities(view.device.id, device().capabilities);
      void sessions.refresh();
    }
  });
  gateway.onRevoked((reason) => sessions.forget(reason === "removed" ? removedNotice : expiredNotice));

  handle(channels.auth, () => sessions.view);
  handle(channels.signupStart, (name, email) => onboarding.startSignup(name, email));
  handle(channels.signupVerify, (code) => onboarding.verifySignup(code));
  handle(channels.signupSecretWord, (secretWord, repeated) => onboarding.chooseSecretWord(secretWord, repeated));
  handle(channels.attachStart, (email, secretWord) => onboarding.startAttach(email, secretWord));
  handle(channels.attachConfirm, (code) => onboarding.confirmAttach(code));
  handle(channels.cancelOnboarding, () => onboarding.reset());
  handle(channels.signOut, () => sessions.signOut());
  handle(channels.devices, () => gateway.devices());
  handle(channels.removeDevice, (deviceId) => (typeof deviceId === "string" ? gateway.removeDevice(deviceId) : { ok: false, code: "invalid_request", reason: "Unknown device." }));
  handle(channels.history, () => gateway.history());
  handle(channels.send, (text) => gateway.send(text));
  handle(channels.connection, () => gateway.state);

  app.on("before-quit", () => gateway.stop());
  void sessions.start();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const [window] = BrowserWindow.getAllWindows();
    if (window !== undefined) {
      if (window.isMinimized()) {
        window.restore();
      }
      window.focus();
    }
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  void app.whenReady().then(() => {
    wire();
    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });
}
