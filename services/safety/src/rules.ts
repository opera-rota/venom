import type { ActionSpec, ConfirmationStrictness, RunStepCommand, DrillKind, Effect, FailurePolicy, Risk, SkippableEffect, StepAction } from "@venom/contracts";

export interface Proposed {
  readonly action: StepAction;
  readonly effects: readonly Effect[];
  readonly reversible: boolean;
}

export interface Assessment {
  readonly requiresConfirmation: boolean;
  readonly risk: Risk;
  readonly reasons: readonly Effect[];
}

export interface PlannedWait {
  readonly summary: string;
  readonly action: "wait";
  readonly seconds: number;
  readonly effects: readonly Effect[];
  readonly reversible: boolean;
  readonly onFailure: FailurePolicy;
}

export interface Drill {
  readonly requestText: string;
  readonly steps: readonly PlannedWait[];
}

export const effectOrder: readonly Effect[] = ["deletes", "pays", "uses_credential", "posts", "reaches_outside"];

export const highRisk: ReadonlySet<Effect> = new Set(["deletes", "pays", "uses_credential"]);

export const alwaysAsks: ReadonlySet<Effect> = new Set(["pays", "uses_credential"]);

const inherentEffects: Partial<Record<StepAction, readonly Effect[]>> = {
  call_connector: ["reaches_outside"],
};

const neverUndoable: ReadonlySet<StepAction> = new Set(["run_script", "call_connector"]);

const alwaysAsksAction: ReadonlySet<StepAction> = new Set(["run_script"]);

const localPlace = /^(?:[a-z]:[\\/]|\\\\|%[a-z_]+%|(?:(?:my|the)\s+)?(?:desktop|documents|downloads|pictures|music|videos)(?:\s+folder)?$)/i;

export const effectWords: Record<Effect, string> = {
  deletes: "It deletes something.",
  pays: "It spends money.",
  uses_credential: "It uses a password or key.",
  posts: "It posts or sends something.",
  reaches_outside: "It reaches a service outside this device.",
};

export const skippableWords: Record<SkippableEffect, string> = {
  deletes: "Deleting things",
  posts: "Posting or sending things",
  reaches_outside: "Reaching services outside this device",
};

export const strictnessWords: Record<ConfirmationStrictness, string> = {
  standard: "Pauses on anything that deletes, pays, posts, uses a password or reaches outside.",
  strict: "Also pauses on anything that cannot be undone.",
};

export function effectsOf(action: StepAction, claimed: readonly Effect[]): Effect[] {
  const inherent = inherentEffects[action] ?? [];
  return effectOrder.filter((effect) => claimed.includes(effect) || inherent.includes(effect));
}

export function opensOutside(spec: ActionSpec): boolean {
  return spec.name === "open_app" && spec.open !== null && !localPlace.test(spec.open.trim());
}

export const unconfirmedScriptWords = "This computer refused to run a script you had not said yes to.";

export function refusesUnconfirmed(command: Pick<RunStepCommand, "action" | "confirmed">): boolean {
  return command.action.name === "run_script" && !command.confirmed;
}

export function effectsOfSpec(spec: ActionSpec, claimed: readonly Effect[]): Effect[] {
  return effectsOf(spec.name, opensOutside(spec) ? [...claimed, "reaches_outside"] : claimed);
}

export function undoable(action: StepAction, claimed: boolean): boolean {
  return claimed && !neverUndoable.has(action);
}

export function assess(step: Proposed, strictness: ConfirmationStrictness, skipAsking: readonly Effect[] = []): Assessment {
  const reasons = effectsOf(step.action, step.effects);
  const asking = reasons.filter((effect) => alwaysAsks.has(effect) || !skipAsking.includes(effect));
  const requiresConfirmation = asking.length > 0 || alwaysAsksAction.has(step.action) || (strictness === "strict" && !step.reversible);
  const risk: Risk = reasons.some((effect) => highRisk.has(effect)) ? "high" : reasons.length > 0 || alwaysAsksAction.has(step.action) ? "medium" : "low";
  return { requiresConfirmation, risk, reasons };
}

export function plainLanguage(summary: string, targetName: string, reversible: boolean): string {
  return `${summary} on ${targetName}. ${reversible ? "This can be undone." : "This cannot be undone."}`;
}

function wait(summary: string, seconds: number, effects: readonly Effect[] = [], reversible = true): PlannedWait {
  return { summary, action: "wait", seconds, effects, reversible, onFailure: "abort" };
}

export const drills: Record<DrillKind, Drill> = {
  wait: {
    requestText: "Safety drill: wait thirty seconds",
    steps: [wait("Wait 3 seconds to get ready", 3), wait("Wait 30 seconds", 30), wait("Wait 3 seconds to finish", 3)],
  },
  progress: {
    requestText: "Progress drill: five practice steps",
    steps: [1, 2, 3, 4, 5].map((part) => wait(`Practice step ${part} of 5: wait 8 seconds`, 8)),
  },
  sensitive: {
    requestText: "Safety drill: a step that needs your confirmation",
    steps: [
      wait("Wait 3 seconds to get ready", 3),
      wait("Pretend to delete a file (nothing is really deleted)", 5, ["deletes"], false),
      wait("Wait 3 seconds to finish", 3),
    ],
  },
};
