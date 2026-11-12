import type { MoveStatus, Task, TaskMove } from "@venom/contracts";
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
