import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { GatewayEvent } from "@venom/contracts";
import { channels, type AuthView, type ConnectionState, type HaltView, type VenomBridge } from "../shared/bridge.ts";

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
  memory: () => ipcRenderer.invoke(channels.memory),
  saveMemory: (draft) => ipcRenderer.invoke(channels.saveMemory, draft),
  editMemory: (memoryId, draft) => ipcRenderer.invoke(channels.editMemory, memoryId, draft),
  forgetMemory: (memoryId) => ipcRenderer.invoke(channels.forgetMemory, memoryId),
  history: () => ipcRenderer.invoke(channels.history),
  send: (text) => ipcRenderer.invoke(channels.send, text),
  retry: (requestId) => ipcRenderer.invoke(channels.retry, requestId),
  stop: () => ipcRenderer.invoke(channels.stop),
  halt: () => ipcRenderer.invoke(channels.halt),
  onHalt: (listener) => subscribe<HaltView>(channels.haltChanged, listener),
  tasks: () => ipcRenderer.invoke(channels.tasks),
  drill: (kind) => ipcRenderer.invoke(channels.drill, kind),
  taskControl: (taskId, control) => ipcRenderer.invoke(channels.taskControl, taskId, control),
  stopTask: (taskId) => ipcRenderer.invoke(channels.stopTask, taskId),
  confirm: (taskId, stepId, decision) => ipcRenderer.invoke(channels.confirm, taskId, stepId, decision),
  safety: () => ipcRenderer.invoke(channels.safety),
  setSafety: (strictness) => ipcRenderer.invoke(channels.setSafety, strictness),
  openLink: (url) => ipcRenderer.invoke(channels.openLink, url),
  connection: () => ipcRenderer.invoke(channels.connection),
  onEvent: (listener) => subscribe<GatewayEvent>(channels.event, listener),
  onConnection: (listener) => subscribe<ConnectionState>(channels.connectionChanged, listener),
};

contextBridge.exposeInMainWorld("venom", bridge);
