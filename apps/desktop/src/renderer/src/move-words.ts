import type { MoveStatus, Task, TaskMove } from "@venom/contracts";
import type { IconName } from "./components/Icon.tsx";

export { moveLabel } from "@venom/contracts";

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
