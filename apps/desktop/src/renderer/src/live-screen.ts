import type { Device } from "@venom/contracts";
import type { AwakeLevel } from "../../shared/bridge.ts";

export type LivePhase = "idle" | "connecting" | "live" | "offline" | "locked" | "lost";

export interface LiveQuality {
  readonly width: number;
  readonly height: number;
  readonly fps: number;
}

export interface LiveScreen<S> {
  readonly watching: Device | null;
  readonly phase: LivePhase;
  readonly stream: S | null;
  readonly quality: LiveQuality | null;
  retry(): void;
}

export interface ScreenShare {
  readonly watchers: readonly Device[];
  readonly controllers: readonly Device[];
}

export function canWork(device: Device): boolean {
  return device.type === "computer" && device.status !== "revoked";
}

export function canShare(device: Device): boolean {
  return canWork(device) && device.capabilities.screen_control;
}

export function deviceInUse(devices: readonly Device[]): Device | null {
  return devices.find((device) => device.in_use && canWork(device)) ?? null;
}

export function workers(devices: readonly Device[]): readonly Device[] {
  return devices
    .filter(canWork)
    .toSorted((left, right) => Number(right.status === "active") - Number(left.status === "active") || left.name.localeCompare(right.name));
}

export function watchedDevice(devices: readonly Device[], selfId: string): Device | null {
  const chosen = deviceInUse(devices);
  return chosen === null || chosen.id === selfId ? null : chosen;
}

export function awakeFor(self: Device | null, watched: boolean, working: boolean): AwakeLevel {
  if (watched || working) {
    return "display";
  }
  return self?.in_use === true ? "system" : "none";
}

export function controllerWords(controllers: readonly Device[]): string | null {
  const [first] = controllers;
  return first === undefined ? null : `Controlled from ${first.name}`;
}

export function watcherWords(watchers: readonly Device[]): string | null {
  const [first, second] = watchers;
  if (first === undefined) {
    return null;
  }
  if (second === undefined) {
    return `Watched from ${first.name}`;
  }
  return `Watched from ${watchers.length} devices`;
}
