import { setTimeout as sleep } from "node:timers/promises";
import { EngineId, type EmbeddingRequest, type TokenUsage, type TurnEvent, type TurnRequest } from "@venom/contracts";
import { wordVector } from "@venom/memory/testing";
import { BrainError, type Brain, type BrainProblem } from "./brain.ts";

export type BrainStep = TurnEvent | { readonly pause: number } | { readonly hold: Promise<void> } | { readonly crash: BrainProblem };

export type BrainScript = (request: TurnRequest) => readonly BrainStep[];

export interface ScriptedBrain extends Brain {
  readonly requests: TurnRequest[];
  readonly embedded: EmbeddingRequest[];
  script: BrainScript;
  available: readonly EngineId[];
  embedding: { model: string; working: boolean; usage: TokenUsage };
}

export const scriptedUsage: TokenUsage = { input_tokens: 1200, output_tokens: 60, cost_micro_usd: 2500 };

export function answerWith(reply: (text: string) => string, chunk = 6, usage: TokenUsage = scriptedUsage): BrainScript {
  return (request) => {
    const text = reply(request.text);
    const deltas: BrainStep[] = [];
    for (let start = 0; start < text.length; start += chunk) {
      deltas.push({ type: "delta", text: text.slice(start, start + chunk) });
    }
    return [...deltas, { type: "done", intent: "question", text, model: "scripted-model", usage }];
  };
}

export const echoAnswers = answerWith((text) => `You asked: ${text}`);

export function scriptedBrain(script: BrainScript = echoAnswers): ScriptedBrain {
  const brain: ScriptedBrain = {
    requests: [],
    embedded: [],
    script,
    available: EngineId.options,
    embedding: { model: "scripted-embedding", working: true, usage: { input_tokens: 8, output_tokens: 0, cost_micro_usd: 0 } },
    async engines() {
      return brain.available;
    },
    async embed(request) {
      brain.embedded.push(request);
      if (!brain.embedding.working) {
        throw new BrainError("refused", { cause: new Error("no embedding model is offered") });
      }
      return { model: brain.embedding.model, vectors: request.texts.map(wordVector), usage: brain.embedding.usage };
    },
    async *turn(request, signal) {
      brain.requests.push(request);
      for (const step of brain.script(request)) {
        if ("pause" in step) {
          try {
            await sleep(step.pause, undefined, { signal });
          } catch (error) {
            throw new BrainError("stopped", { cause: error });
          }
        } else if ("hold" in step) {
          await step.hold;
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
