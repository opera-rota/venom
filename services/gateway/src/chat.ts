import { SafetySettings, type ConfirmDecision, type Effect, type SkippableEffect } from "@venom/contracts";
import type { DeviceRef } from "@venom/db";
import type { Tasks } from "@venom/tasks";
import { v7 as uuidv7 } from "uuid";
import type { GatewayContext } from "./context.ts";
import type { Spoken } from "./spoken.ts";
import { declinedWords, effectWords, quoted } from "./words.ts";

export type Command =
  | { readonly kind: "stop" }
  | { readonly kind: "answer"; readonly taskId: string; readonly stepId: string; readonly decision: ConfirmDecision }
  | { readonly kind: "run"; readonly taskId: string }
  | { readonly kind: "asking"; readonly ask: boolean; readonly effect: Effect | null }
  | { readonly kind: "say"; readonly text: string };

const noPlan = "There is no plan waiting to run. Tell me what you would like done, and I will plan it first.";

const alwaysAsks = "I always ask before anything that spends money or uses a password, and that cannot be turned off.";

const unknownEffect = "I can stop asking before deleting things, sending or posting things, or reaching outside the computer. Money, passwords and scripts always ask.";

function skippable(effect: Effect): effect is SkippableEffect {
  return effect === "deletes" || effect === "posts" || effect === "reaches_outside";
}

export async function decide(tasks: Tasks, accountId: string, spoken: Spoken): Promise<Command | null> {
  if (spoken.kind === "stop" || spoken.kind === "asking") {
    return spoken;
  }
  const { tasks: recent, confirmations } = await tasks.list(accountId);
  const open = [...confirmations].sort((a, b) => b.asked_at.localeCompare(a.asked_at))[0];
  if (open !== undefined) {
    return { kind: "answer", taskId: open.task_id, stepId: open.step_id, decision: spoken.kind === "yes" ? "approve" : "decline" };
  }
  if (spoken.kind === "no" || !spoken.runs) {
    return null;
  }
  const waiting = recent.filter((task) => task.status === "planned").sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  return waiting === undefined ? { kind: "say", text: noPlan } : { kind: "run", taskId: waiting.id };
}

async function asking(context: GatewayContext, device: DeviceRef, requestId: string, ask: boolean, effect: Effect | null): Promise<string> {
  if (effect === null) {
    return unknownEffect;
  }
  if (!skippable(effect)) {
    return ask ? "I already always ask before anything that spends money or uses a password." : alwaysAsks;
  }
  const current = await context.tasks.settings(device.account_id);
  const others = current.skip_asking.filter((skipped) => skipped !== effect);
  await context.tasks.saveSettings(device, SafetySettings.parse({ ...current, skip_asking: ask ? others : [...others, effect] }), requestId);
  const words = effectWords[effect];
  return ask
    ? `Okay. I will ask you again before ${words}.`
    : `Okay. I will not ask before ${words} any more. I still always ask before money, passwords and scripts. Say "ask me again before ${words}" to undo this.`;
}

export async function obey(context: GatewayContext, device: DeviceRef, requestId: string, command: Command): Promise<string> {
  const { acting } = context;
  switch (command.kind) {
    case "say":
      return command.text;
    case "stop": {
      const receipt = await acting.halt(device, { stop_id: uuidv7(), scope: { kind: "all" } }, requestId);
      return receipt.tasks.length === 0 ? "Nothing was running, so there was nothing to stop." : "Okay, stopping everything now.";
    }
    case "answer": {
      const { task, answered } = await acting.answer(device, command.taskId, command.stepId, command.decision, requestId, false);
      return answered.outcome === "approved" ? "Okay, doing it now." : declinedWords(task);
    }
    case "run": {
      const task = await acting.run(device, command.taskId, requestId);
      return `On it. I am starting ${quoted(task.request_text)} now.`;
    }
    case "asking":
      return asking(context, device, requestId, command.ask, command.effect);
  }
}
