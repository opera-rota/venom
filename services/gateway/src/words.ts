import type { ConfirmRequest, DeviceAction, Effect, SkippableEffect, Task, TaskMove } from "@venom/contracts";

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

function moves(total: number): string {
  return `${total} ${total === 1 ? "move" : "moves"}`;
}

function sentence(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return /[.!?]$/.test(clean) ? clean : `${clean}.`;
}

function clause(text: string): string {
  return text.replace(/\s+/g, " ").trim().replace(/[.!?]+$/, "");
}

function lowered(text: string): string {
  return text.length === 0 ? text : `${text[0]?.toLowerCase() ?? ""}${text.slice(1)}`;
}

export function goalStartWords(task: Task, target: string, elsewhere: boolean): string {
  const where = elsewhere ? `This device cannot do it, so I am doing it on ${target}.` : `I am doing it on ${target}.`;
  return `On it, buddy. ${where} I look at the screen, make one move, look again, and tell you each move here. Type to guide me while I work, or say stop at any moment.`;
}

export function moveQuestionWords(move: TaskMove, because: readonly string[], target: string): string {
  return `Quick check, buddy. Next I would ${lowered(clause(move.intent))} on ${target}. ${because.join(" ")} Shall I do it? Just say yes or no.`;
}

export function refusedMoveWords(detail: string): string {
  return `${sentence(detail)} Say no if you want me to stop here.`;
}

export function goalDoneWords(task: Task, answer: string): string {
  return `Done. ${sentence(answer)} (${moves(task.moves)} on ${quoted(task.request_text)}.)`;
}

export function goalCannotWords(task: Task, reason: string): string {
  return `I could not finish ${quoted(task.request_text)}: ${lowered(sentence(reason))} I stopped after ${moves(task.moves)}.`;
}

export function goalFailedWords(task: Task, detail: string): string {
  return `That did not work. ${sentence(detail)} I stopped working on ${quoted(task.request_text)} after ${moves(task.moves)}.`;
}

export function keepGoingWords(task: Task, made: number, more: number): string {
  return `I have made ${moves(made)} on ${quoted(task.request_text)} and I am not done yet, so I paused. Shall I keep going? Say yes for ${more} more, or no to stop here.`;
}

export function timeUpWords(task: Task, minutes: number): string {
  return `I have worked on ${quoted(task.request_text)} for ${minutes} minutes, so I stopped there after ${moves(task.moves)}. Ask me again if you want me to carry on.`;
}

export function goalDeclinedWords(task: Task): string {
  return `Okay, I did not do it, and I stopped working on ${quoted(task.request_text)}.`;
}

export function stopHereWords(goal: string): string {
  return `Okay, I stopped working on ${quoted(goal)} there.`;
}

export const guidedWords = "Got it. I will use that in my next move.";

export const carryOnWords = "Okay, carrying on.";
