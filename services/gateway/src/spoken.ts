import type { Effect } from "@venom/contracts";

export type Spoken =
  | { readonly kind: "stop" }
  | { readonly kind: "yes"; readonly runs: boolean }
  | { readonly kind: "no" }
  | { readonly kind: "asking"; readonly ask: boolean; readonly effect: Effect | null };

const phrase = (words: readonly string[]) => new Set(words);

const stopping = phrase(["stop", "stop it", "stop now", "stop everything", "stop all", "stop all tasks", "halt", "cancel everything"]);

const running = phrase(["run it", "run the plan", "run this plan", "run that plan", "start it", "start the plan", "do it", "yes do it", "go ahead", "yes go ahead", "ok do it", "okay do it", "do it now", "run it now"]);

const agreeing = phrase(["yes", "yeah", "yep", "yup", "sure", "ok", "okay", "yes please", "please do", "approve", "go for it", "sounds good"]);

const refusing = phrase(["no", "nope", "nah", "no thanks", "no thank you", "don't", "do not", "don't do it", "do not do it", "cancel", "cancel it", "decline", "not now"]);

const skipping = /^(?:please )?(?:don't|do not|stop|no need to|you don't need to|you do not need to) ask(?:ing)?(?: me)?(?: again| any more| anymore)? before (.+)$/;

const reasking = /^(?:please )?(?:ask me again before|ask me before|always ask(?: me)? before|start asking(?: me)? before|go back to asking(?: me)? before) (.+)$/;

const effects: readonly (readonly [Effect, RegExp])[] = [
  ["pays", /\b(pay|paying|payment|money|spend|spending|buy|buying|purchas\w*)\b/],
  ["uses_credential", /\b(password\w*|credential\w*|sign(?:ing)? ?in|log(?:ging)? ?in)\b/],
  ["deletes", /\b(delet\w*|remov\w*|eras\w*)\b/],
  ["posts", /\b(post\w*|send\w*|sent|publish\w*|shar\w*|email\w*)\b/],
  ["reaches_outside", /\b(outside|online|internet|web|website\w*|site\w*|network|link\w*)\b/],
];

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[.!?,;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:hey )?venom /, "")
    .replace(/ please$/, "")
    .replace(/ venom$/, "");
}

function effectIn(words: string): Effect | null {
  return effects.find(([, pattern]) => pattern.test(words))?.[0] ?? null;
}

export function understand(text: string): Spoken | null {
  const said = normalize(text);
  if (stopping.has(said)) {
    return { kind: "stop" };
  }
  if (running.has(said)) {
    return { kind: "yes", runs: true };
  }
  if (agreeing.has(said)) {
    return { kind: "yes", runs: false };
  }
  if (refusing.has(said)) {
    return { kind: "no" };
  }
  const skip = skipping.exec(said);
  if (skip !== null) {
    return { kind: "asking", ask: false, effect: effectIn(skip[1] ?? "") };
  }
  const again = reasking.exec(said);
  if (again !== null) {
    return { kind: "asking", ask: true, effect: effectIn(again[1] ?? "") };
  }
  return null;
}
