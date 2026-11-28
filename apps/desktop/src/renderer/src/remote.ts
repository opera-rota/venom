import type { ScreenKey, Task, TaskMove } from "@venom/contracts";

export type RemoteTouchKind = "click" | "double" | "right";

export interface RemoteSpot {
  readonly x: number;
  readonly y: number;
}

export type RemoteAction =
  | { readonly kind: RemoteTouchKind; readonly spot: RemoteSpot }
  | { readonly kind: "scroll"; readonly spot: RemoteSpot; readonly direction: "up" | "down"; readonly steps: number }
  | { readonly kind: "key"; readonly key: ScreenKey }
  | { readonly kind: "type"; readonly text: string };

export interface RemoteControl {
  readonly ready: boolean;
  readonly on: boolean;
  readonly paused: boolean;
  toggle(): void;
  send(action: RemoteAction): void;
  resume(): void;
}

export interface Box {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export const remoteKeys: readonly { readonly key: ScreenKey; readonly label: string }[] = [
  { key: "escape", label: "Esc" },
  { key: "tab", label: "Tab" },
  { key: "backspace", label: "⌫" },
  { key: "enter", label: "Enter" },
];

export function pictureBox(element: Box, videoWidth: number, videoHeight: number): Box {
  if (videoWidth <= 0 || videoHeight <= 0 || element.width <= 0 || element.height <= 0) {
    return element;
  }
  const scale = Math.min(element.width / videoWidth, element.height / videoHeight);
  const width = videoWidth * scale;
  const height = videoHeight * scale;
  return { left: element.left + (element.width - width) / 2, top: element.top + (element.height - height) / 2, width, height };
}

export function spotIn(box: Box, clientX: number, clientY: number): RemoteSpot | null {
  const x = (clientX - box.left) / box.width;
  const y = (clientY - box.top) / box.height;
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) {
    return null;
  }
  return { x: Math.round(x * 10_000) / 10_000, y: Math.round(y * 10_000) / 10_000 };
}

export function heldFor(job: Task | null, moves: readonly TaskMove[], deviceId: string | null): boolean {
  return job !== null && deviceId !== null && job.kind === "goal" && job.status === "awaiting_confirmation" && job.target_device_id === deviceId && moves.at(-1)?.status !== "asking";
}

export const gesture = { doubleMs: 300, slop: 10, loupe: 2.5 } as const;

export interface View {
  readonly scale: number;
  readonly x: number;
  readonly y: number;
}

export const restingView: View = { scale: 1, x: 0, y: 0 };

export const viewLimits = { min: 1, max: 5, step: 1.6 } as const;

export function clampView(view: View, width: number, height: number): View {
  const scale = Math.min(viewLimits.max, Math.max(viewLimits.min, view.scale));
  const x = Math.min(0, Math.max(width * (1 - scale), view.x));
  const y = Math.min(0, Math.max(height * (1 - scale), view.y));
  return { scale, x: Object.is(x, -0) ? 0 : x, y: Object.is(y, -0) ? 0 : y };
}

export function zoomAt(view: View, factor: number, centerX: number, centerY: number, width: number, height: number): View {
  const scale = Math.min(viewLimits.max, Math.max(viewLimits.min, view.scale * factor));
  const ratio = scale / view.scale;
  return clampView({ scale, x: centerX - (centerX - view.x) * ratio, y: centerY - (centerY - view.y) * ratio }, width, height);
}

export function panBy(view: View, dx: number, dy: number, width: number, height: number): View {
  return clampView({ scale: view.scale, x: view.x + dx, y: view.y + dy }, width, height);
}
