import type { MakeMove, MoveTarget, Observation, ScreenMark, ScreenMove } from "@venom/contracts";
import type { ReplayStep } from "@venom/db";

function same(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function sameWindow(target: MoveTarget | null, seen: Observation): boolean {
  const window = target?.window ?? "";
  return window.trim() !== "" && same(window, seen.window);
}

function markFor(target: MoveTarget | null, seen: Observation): ScreenMark | null {
  const name = target?.name?.trim() ?? "";
  if (target === null || name === "") {
    return null;
  }
  if (target.window !== null && !same(target.window, seen.window)) {
    return null;
  }
  const matching = seen.marks.filter((mark) => mark.name.trim() === name && (target.kind === null || mark.kind === target.kind));
  return matching.length === 1 ? (matching[0] ?? null) : null;
}

export function targetOf(move: ScreenMove, seen: Observation): MoveTarget | null {
  if (move.name === "open" || move.name === "pause") {
    return null;
  }
  const number = move.name === "key" ? null : move.mark;
  const mark = number === null ? undefined : seen.marks[number - 1];
  return { kind: mark?.kind ?? null, name: mark?.name ?? null, window: seen.window.trim() === "" ? null : seen.window };
}

export function replayed({ move, target }: ReplayStep, seen: Observation): ScreenMove | null {
  switch (move.name) {
    case "open":
    case "pause":
      return move;
    case "key":
      return sameWindow(target, seen) ? move : null;
    case "click": {
      if (move.mark === null) {
        return null;
      }
      const mark = markFor(target, seen);
      return mark === null ? null : { ...move, mark: mark.id };
    }
    case "type":
    case "scroll": {
      if (move.mark === null) {
        return sameWindow(target, seen) ? move : null;
      }
      const mark = markFor(target, seen);
      if (mark === null || (move.name === "type" && mark.password)) {
        return null;
      }
      return { ...move, mark: mark.id };
    }
  }
}

export function focusOnly(step: ReplayStep, next: ReplayStep | undefined, seen: Observation): boolean {
  if (next === undefined || step.note !== null || next.note !== null || step.move.name !== "click" || step.move.point === null || step.move.double) {
    return false;
  }
  const typed = next.move.name === "key" || (next.move.name === "type" && next.move.mark === null);
  return typed && sameWindow(step.target, seen) && sameWindow(next.target, seen);
}

export function knownMove(step: ReplayStep, seen: Observation): MakeMove | null {
  if (step.note !== null) {
    return null;
  }
  const move = replayed(step, seen);
  return move === null ? null : { kind: "move", intent: step.said, effects: [...step.effects], move };
}
