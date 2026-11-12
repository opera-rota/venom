import { setTimeout as sleep } from "node:timers/promises";
import { EngineId, type EmbeddingRequest, type MoveReply, type MoveRequest, type NextMove, type PlanDraft, type TokenUsage, type TurnEvent, type TurnRequest } from "@venom/contracts";
import { wordVector } from "@venom/memory/testing";
import { BrainError, type Brain, type BrainProblem } from "./brain.ts";

export type BrainStep = TurnEvent | { readonly pause: number } | { readonly hold: Promise<void> } | { readonly crash: BrainProblem };

export type BrainScript = (request: TurnRequest) => readonly BrainStep[];

export type MoveScript = (request: MoveRequest) => MoveReply | Promise<MoveReply>;

export interface ScriptedBrain extends Brain {
  readonly requests: TurnRequest[];
  readonly embedded: EmbeddingRequest[];
  readonly moves: MoveRequest[];
  script: BrainScript;
  mover: MoveScript;
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
    return [...deltas, { type: "done", intent: "question", text, plan: null, model: "scripted-model", usage }];
  };
}

export function planWith(plan: PlanDraft | null, usage: TokenUsage = scriptedUsage): BrainScript {
  return () => [{ type: "done", intent: "task", text: plan === null ? "My plan came back broken. Nothing was done." : plan.title, plan, model: plan === null ? null : "scripted-model", usage }];
}

export const echoAnswers = answerWith((text) => `You asked: ${text}`);

export const understood: TokenUsage = { input_tokens: 300, output_tokens: 8, cost_micro_usd: 400 };

export const handToLoop: BrainScript = (request) => [{ type: "done", intent: "task", text: request.text, plan: null, model: null, usage: understood }];

export function choose(next: NextMove, usage: TokenUsage = scriptedUsage): MoveReply {
  return { type: "chosen", next, model: "scripted-eyes", usage };
}

export function movesWith(choices: readonly NextMove[]): MoveScript {
  let turn = 0;
  return () => {
    const next = choices[Math.min(turn, choices.length - 1)];
    turn += 1;
    if (next === undefined) {
      return { type: "failed", reason: "invalid_output", detail: "No move was scripted.", usage: { input_tokens: 0, output_tokens: 0, cost_micro_usd: 0 } };
    }
    return choose(next);
  };
}

const giveUp = movesWith([{ seen: "Nothing was scripted.", next: { kind: "cannot", reason: "No moves were scripted for this test." } }]);

export function scriptedBrain(script: BrainScript = echoAnswers): ScriptedBrain {
  const brain: ScriptedBrain = {
    requests: [],
    embedded: [],
    moves: [],
    script,
    mover: giveUp,
    available: EngineId.options,
    embedding: { model: "scripted-embedding", working: true, usage: { input_tokens: 8, output_tokens: 0, cost_micro_usd: 0 } },
    async engines() {
      return brain.available;
    },
    async move(request) {
      brain.moves.push(request);
      return brain.mover(request);
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
