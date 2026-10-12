import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { GatewayEvent } from "@venom/contracts";
import { channels, type ConnectionState, type VenomBridge } from "../shared/bridge.ts";

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, payload: T) => listener(payload);
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
}

const bridge: VenomBridge = {
  history: () => ipcRenderer.invoke(channels.history),
  send: (text) => ipcRenderer.invoke(channels.send, text),
  connection: () => ipcRenderer.invoke(channels.connection),
  onEvent: (listener) => subscribe<GatewayEvent>(channels.event, listener),
  onConnection: (listener) => subscribe<ConnectionState>(channels.connectionChanged, listener),
};

contextBridge.exposeInMainWorld("venom", bridge);
