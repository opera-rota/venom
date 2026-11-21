import type { Device } from "@venom/contracts";

export type LivePhase = "idle" | "connecting" | "live" | "offline" | "lost";

export interface LiveQuality {
  readonly width: number;
  readonly height: number;
  readonly fps: number;
}

export interface LiveScreen<S> {
  readonly sources: readonly Device[];
  readonly watching: Device | null;
  readonly phase: LivePhase;
  readonly stream: S | null;
  readonly quality: LiveQuality | null;
  watch(deviceId: string): void;
  retry(): void;
}

export interface ScreenShare {
  readonly watchers: readonly Device[];
}

export function canShare(device: Device): boolean {
  return device.type === "computer" && device.capabilities.screen_control && device.status !== "revoked";
}

export function screenSources(devices: readonly Device[], selfId: string): readonly Device[] {
  return devices
    .filter((device) => device.id !== selfId && canShare(device))
    .toSorted((left, right) => Number(right.status === "active") - Number(left.status === "active") || left.name.localeCompare(right.name));
}

export function firstSource(sources: readonly Device[], preferred: string | null): Device | null {
  return sources.find((device) => device.id === preferred && device.status === "active") ?? sources.find((device) => device.status === "active") ?? sources[0] ?? null;
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
