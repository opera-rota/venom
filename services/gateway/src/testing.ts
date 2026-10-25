import { setTimeout as sleep } from "node:timers/promises";
import type { TurnEvent, TurnRequest } from "@venom/contracts";
import { BrainError, type Brain, type BrainProblem } from "./brain.ts";

export type BrainStep = TurnEvent | { readonly pause: number } | { readonly crash: BrainProblem };

export type BrainScript = (request: TurnRequest) => readonly BrainStep[];

export interface ScriptedBrain extends Brain {
  readonly requests: TurnRequest[];
  script: BrainScript;
}

export function answerWith(reply: (text: string) => string, chunk = 6): BrainScript {
  return (request) => {
    const text = reply(request.text);
    const deltas: BrainStep[] = [];
    for (let start = 0; start < text.length; start += chunk) {
      deltas.push({ type: "delta", text: text.slice(start, start + chunk) });
    }
    return [...deltas, { type: "done", intent: "question", text, model: "scripted-model" }];
  };
}

export const echoAnswers = answerWith((text) => `You asked: ${text}`);

export function scriptedBrain(script: BrainScript = echoAnswers): ScriptedBrain {
  const brain: ScriptedBrain = {
    requests: [],
    script,
    async *turn(request, signal) {
      brain.requests.push(request);
      for (const step of brain.script(request)) {
        if ("pause" in step) {
          try {
            await sleep(step.pause, undefined, { signal });
          } catch (error) {
            throw new BrainError("stopped", { cause: error });
          }
        } else if ("crash" in step) {
          throw new BrainError(step.crash);
        } else {
          yield step;
        }
      }
    },
  };
  return brain;
}
