import { app, BrowserWindow, ipcMain, type IpcMainInvokeEvent } from "electron";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { channels } from "../shared/bridge.ts";
import { loadConfig } from "./config.ts";
import { GatewayClient } from "./gateway-client.ts";

const rendererDevUrl = process.env["ELECTRON_RENDERER_URL"];
const rendererFile = join(import.meta.dirname, "../renderer/index.html");
const trustedOrigin = rendererDevUrl === undefined ? "file://" : new URL(rendererDevUrl).origin;

const gateway = new GatewayClient(loadConfig());

function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(channel, payload);
  }
}

function fromRenderer(event: IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url ?? "";
  return url.startsWith(trustedOrigin);
}

function guarded<T>(handler: (...args: unknown[]) => T) {
  return (event: IpcMainInvokeEvent, ...args: unknown[]): T => {
    if (!fromRenderer(event)) {
      throw new Error("Refused a request from an untrusted page.");
    }
    return handler(...args);
  };
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    title: "VENOM",
    width: 980,
    height: 760,
    minWidth: 420,
    minHeight: 520,
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

  ipcMain.handle(channels.history, guarded(() => gateway.history()));
  ipcMain.handle(channels.send, guarded((text) => gateway.send(text)));
  ipcMain.handle(channels.connection, guarded(() => gateway.state));

  gateway.onEvent((event) => broadcast(channels.event, event));
  gateway.onState((state) => broadcast(channels.connectionChanged, state));

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  app.on("before-quit", () => gateway.stop());

  void app.whenReady().then(() => {
    gateway.start();
    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });
}
