import type { ConfirmRequest, DeviceAction, Effect, SkippableEffect, Task } from "@venom/contracts";

const because: Record<Effect, string> = {
  deletes: "it deletes something",
  pays: "it spends money",
  posts: "it sends or posts something other people will see",
  uses_credential: "it uses a password or a sign-in",
  reaches_outside: "it reaches outside this computer",
};

export const effectWords: Record<SkippableEffect, string> = {
  deletes: "deleting things",
  posts: "sending or posting things",
  reaches_outside: "reaching outside the computer",
};

function joined(parts: readonly string[]): string {
  if (parts.length <= 1) {
    return parts.join("");
  }
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1) ?? ""}`;
}

export function quoted(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return `"${clean.length > 120 ? `${clean.slice(0, 117)}...` : clean}"`;
}

export function questionWords(request: ConfirmRequest, action: DeviceAction): string {
  const reason = request.reasons.length > 0
    ? `I am checking because ${joined(request.reasons.map((effect) => because[effect]))}.`
    : action.name === "run_script"
      ? "I always check with you before I run a script."
      : "You asked me to check with you before steps like this.";
  return `Quick check before I go on. ${request.plain_language} ${reason} Shall I do it? Just say yes or no.`;
}

export function doneWords(task: Task): string {
  const total = task.plan.length;
  return `Done. ${quoted(task.request_text)} is finished, and ${total === 1 ? "the step" : `all ${total} steps`} worked.`;
}

export function failedWords(task: Task, stepId: string, detail: string): string {
  const position = task.plan.findIndex((step) => step.id === stepId);
  const step = task.plan[position];
  const which = step === undefined ? "One step" : `Step ${position + 1} of ${task.plan.length}, ${quoted(step.summary)},`;
  return `That did not work. ${which} did not finish: ${detail} Nothing after it ran. Press Retry on the task when you want to try again.`;
}

export function stoppedWords(task: Task): string {
  return `Stopped. Nothing more will run for ${quoted(task.request_text)}.`;
}

export function declinedWords(task: Task): string {
  return `Okay, I did not do it. I cancelled the rest of ${quoted(task.request_text)} too.`;
}

export const planWaiting = 'Say "run it" or press Run it when you are ready.';
