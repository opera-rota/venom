import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { GatewayEvent } from "@venom/contracts";
import { channels, type AuthView, type ConnectionState, type VenomBridge } from "../shared/bridge.ts";

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, payload: T) => listener(payload);
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
}

const bridge: VenomBridge = {
  auth: () => ipcRenderer.invoke(channels.auth),
  onAuth: (listener) => subscribe<AuthView>(channels.authChanged, listener),
  signup: {
    start: (name, email) => ipcRenderer.invoke(channels.signupStart, name, email),
    verify: (code) => ipcRenderer.invoke(channels.signupVerify, code),
    secretWord: (secretWord, repeated) => ipcRenderer.invoke(channels.signupSecretWord, secretWord, repeated),
  },
  attach: {
    start: (email, secretWord) => ipcRenderer.invoke(channels.attachStart, email, secretWord),
    confirm: (code) => ipcRenderer.invoke(channels.attachConfirm, code),
  },
  cancelOnboarding: () => ipcRenderer.invoke(channels.cancelOnboarding),
  signOut: () => ipcRenderer.invoke(channels.signOut),
  devices: () => ipcRenderer.invoke(channels.devices),
  removeDevice: (deviceId) => ipcRenderer.invoke(channels.removeDevice, deviceId),
  engines: () => ipcRenderer.invoke(channels.engines),
  power: () => ipcRenderer.invoke(channels.power),
  chooseEngine: (engine) => ipcRenderer.invoke(channels.chooseEngine, engine),
  history: () => ipcRenderer.invoke(channels.history),
  send: (text) => ipcRenderer.invoke(channels.send, text),
  retry: (requestId) => ipcRenderer.invoke(channels.retry, requestId),
  openLink: (url) => ipcRenderer.invoke(channels.openLink, url),
  connection: () => ipcRenderer.invoke(channels.connection),
  onEvent: (listener) => subscribe<GatewayEvent>(channels.event, listener),
  onConnection: (listener) => subscribe<ConnectionState>(channels.connectionChanged, listener),
};

contextBridge.exposeInMainWorld("venom", bridge);
