import { z } from "zod";
import { Id, Timestamp } from "./primitives.ts";
import { Task } from "./records.ts";
import { contracts } from "./registry.ts";
import { screenLimits, type ScreenKey, type TaskMove } from "./screen.ts";

export const howToLimits = {
  name: 60,
  app: 80,
  label: 40,
  note: 300,
  steps: screenLimits.moves,
  items: 200,
} as const;

const said = (limit: number) => z.string().min(1).max(limit).regex(/\S/);

export const HowToLearned = z
  .enum(["show", "tell", "job"])
  .register(contracts, { id: "HowToLearned" });

export const HowToStepKind = z
  .enum(["click", "type", "key", "scroll", "open", "pause"])
  .register(contracts, { id: "HowToStepKind" });

export const HowToStep = z
  .strictObject({
    number: z.int().min(1).max(howToLimits.steps),
    kind: HowToStepKind,
    label: said(howToLimits.label),
    said: said(screenLimits.intent),
    note: said(howToLimits.note).nullable(),
  })
  .register(contracts, { id: "HowToStep" });

export const HowTo = z
  .strictObject({
    id: Id,
    account_id: Id,
    task_id: Id.nullable(),
    name: said(howToLimits.name),
    app: said(howToLimits.app).nullable(),
    learned: HowToLearned,
    pinned: z.boolean(),
    applied: z.int().nonnegative(),
    worked: z.int().nonnegative(),
    seconds: z.int().nonnegative().nullable(),
    steps: z.array(HowToStep).min(1).max(howToLimits.steps),
    created_at: Timestamp,
    updated_at: Timestamp,
  })
  .superRefine((howTo, context) => {
    if (howTo.steps.some((step, index) => step.number !== index + 1)) {
      context.addIssue({ code: "custom", path: ["steps"], message: "Steps are numbered 1, 2, 3 and so on, in order." });
    }
    if (howTo.worked > howTo.applied) {
      context.addIssue({ code: "custom", path: ["worked"], message: "A how-to cannot have worked more often than it was applied." });
    }
  })
  .register(contracts, { id: "HowTo" });

export const HowToList = z
  .strictObject({
    howtos: z.array(HowTo).max(howToLimits.items),
    limit: z.int().positive(),
  })
  .register(contracts, { id: "HowToList" });

export const SaveHowTo = z
  .strictObject({
    task_id: Id,
    name: said(howToLimits.name).optional(),
  })
  .register(contracts, { id: "SaveHowTo" });

export const ChangeHowTo = z
  .strictObject({
    name: said(howToLimits.name).optional(),
    pinned: z.boolean().optional(),
  })
  .refine((change) => change.name !== undefined || change.pinned !== undefined, "Say what to change: a new name, or pinned.")
  .register(contracts, { id: "ChangeHowTo" });

export const HowToNote = z
  .strictObject({
    note: said(howToLimits.note).nullable(),
  })
  .register(contracts, { id: "HowToNote" });

export const ApplyHowTo = z
  .strictObject({
    step_by_step: z.boolean().default(false),
  })
  .register(contracts, { id: "ApplyHowTo" });

export const HowToApplied = z
  .strictObject({
    task: Task,
    howto: HowTo,
  })
  .register(contracts, { id: "HowToApplied" });

export const FollowHowTo = z
  .strictObject({
    name: said(howToLimits.name),
    step_by_step: z.boolean(),
    steps: z.array(HowToStep).min(1).max(howToLimits.steps),
  })
  .register(contracts, { id: "FollowHowTo" });

export type HowToLearned = z.infer<typeof HowToLearned>;
export type HowToStepKind = z.infer<typeof HowToStepKind>;
export type HowToStep = z.infer<typeof HowToStep>;
export type HowTo = z.infer<typeof HowTo>;
export type HowToList = z.infer<typeof HowToList>;
export type SaveHowTo = z.infer<typeof SaveHowTo>;
export type ChangeHowTo = z.infer<typeof ChangeHowTo>;
export type HowToNote = z.infer<typeof HowToNote>;
export type ApplyHowTo = z.infer<typeof ApplyHowTo>;
export type HowToApplied = z.infer<typeof HowToApplied>;
export type FollowHowTo = z.infer<typeof FollowHowTo>;

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

function shortened(words: string, size: number): string {
  const clean = words.replace(/\s+/gu, " ").trim();
  return clean.length > size ? `${clean.slice(0, size - 1).trimEnd()}…` : clean;
}

function keyName(key: ScreenKey): string {
  return keyNames[key] ?? key.split("+").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join("+");
}

function markName(detail: string | null): string | null {
  return /'([^']{1,40})'/u.exec(detail ?? "")?.[1] ?? null;
}

export function moveLabel(move: Pick<TaskMove, "move" | "detail">): string {
  const step = move.move;
  switch (step.name) {
    case "click":
      return shortened(markName(move.detail) ?? (step.double ? "Double click" : "Click"), howToLimits.label);
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

export function howToSteps(moves: readonly TaskMove[]): HowToStep[] {
  return moves
    .filter((move) => move.status === "done")
    .slice(0, howToLimits.steps)
    .map((move, index) => ({ number: index + 1, kind: move.move.name, label: moveLabel(move), said: move.intent, note: null }));
}

export function howToApp(moves: readonly TaskMove[]): string | null {
  for (const move of moves) {
    if (move.move.name === "open") {
      return shortened(move.move.app, howToLimits.app);
    }
  }
  return null;
}

export function howToName(text: string): string {
  const clean = text.replace(/\s+/gu, " ").replace(/[\s.!?]+$/u, "").trim();
  const named = clean.charAt(0).toUpperCase() + clean.slice(1);
  return named === "" ? "My how-to" : shortened(named, howToLimits.name);
}
