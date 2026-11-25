import type { MoveStatus, ScreenKey, Task, TaskMove } from "@venom/contracts";
import type { IconName } from "./components/Icon.tsx";

export interface MoveLook {
  readonly word: string;
  readonly icon: IconName;
  readonly tone: string;
}

export const moveLook: Record<MoveStatus, MoveLook> = {
  asking: { word: "Waiting for you", icon: "hourglass", tone: "text-status-wait" },
  running: { word: "Doing it", icon: "hourglass", tone: "text-status-ok" },
  done: { word: "Done", icon: "check", tone: "text-status-ok" },
  failed: { word: "Did not work", icon: "cross", tone: "text-status-fail" },
  refused: { word: "Refused", icon: "shield", tone: "text-status-fail" },
  declined: { word: "You said no", icon: "dash", tone: "text-ink-muted" },
  stopped: { word: "Stopped", icon: "stop", tone: "text-status-fail" },
};

export function movesSoFar(task: Task, open: boolean): string {
  const counted = `${task.moves} ${task.moves === 1 ? "move" : "moves"}`;
  return open ? `${counted} so far` : `${counted} done`;
}

export function moveAnswerWords(move: TaskMove | null): string {
  switch (move?.status) {
    case "running":
    case "done":
    case "refused":
      return "You said yes.";
    case "declined":
      return "You said no.";
    default:
      return "This question is closed.";
  }
}

const keyNames: Partial<Record<ScreenKey, string>> = {
  enter: "Enter",
  tab: "Tab",
  escape: "Esc",
  backspace: "Backspace",
  delete: "Delete",
  page_up: "Page up",
  page_down: "Page down",
  win: "Start",
  "win+d": "Desktop",
  "alt+tab": "Switch app",
  f5: "Refresh",
};

function keyName(key: ScreenKey): string {
  return keyNames[key] ?? key.split("+").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join("+");
}

function shortened(words: string, size: number): string {
  const clean = words.replace(/\s+/gu, " ").trim();
  return clean.length > size ? `${clean.slice(0, size - 1)}…` : clean;
}

function markName(move: TaskMove): string | null {
  const named = /'([^']{1,40})'/u.exec(move.detail ?? "");
  return named?.[1] ?? null;
}

export function moveIcon(move: TaskMove): IconName {
  switch (move.move.name) {
    case "click":
      return "tap";
    case "type":
      return "keyboard";
    case "key":
      return "keyboard";
    case "scroll":
      return "scroll";
    case "open":
      return "app";
    case "pause":
      return "pause";
  }
}

export function moveLabel(move: TaskMove): string {
  const step = move.move;
  switch (step.name) {
    case "click":
      return markName(move) ?? (step.double ? "Double click" : "Click");
    case "type":
      return `“${shortened(step.text, 18)}”`;
    case "key":
      return keyName(step.key);
    case "scroll":
      return step.direction === "down" ? "Scroll down" : "Scroll up";
    case "open":
      return shortened(step.app, 18);
    case "pause":
      return `${step.seconds} s`;
  }
}

export function sinceWords(at: string, now: number): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(at)) / 1000));
  if (seconds < 45) {
    return "just now";
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes} min ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours} h ago`;
  }
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

export function lastedWords(task: Task): string {
  const seconds = Math.max(0, Math.round((Date.parse(task.updated_at) - Date.parse(task.created_at)) / 1000));
  if (seconds < 60) {
    return `${seconds} s`;
  }
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes} min` : `${Math.round(minutes / 60)} h`;
}
