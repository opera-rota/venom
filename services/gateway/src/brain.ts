import { AvailableEngines, EmbeddingFailure, Embeddings, TurnEvent, type EmbeddingRequest, type EngineId, type TurnRequest } from "@venom/contracts";
import type { Embedder } from "@venom/memory";

export interface Brain {
  turn(request: TurnRequest, signal: AbortSignal): AsyncGenerator<TurnEvent>;
  engines(): Promise<readonly EngineId[]>;
  embed(request: EmbeddingRequest): Promise<Embeddings>;
}

export type BrainProblem = "unreachable" | "refused" | "timeout" | "stopped" | "malformed";

const explanations: Record<BrainProblem, string> = {
  unreachable: "VENOM's brain is not reachable right now. Try again in a moment.",
  refused: "VENOM's brain could not take this message. Try again in a moment.",
  timeout: "VENOM's brain took too long to answer. Try again.",
  stopped: "This answer was stopped because VENOM is restarting. Try again.",
  malformed: "VENOM's brain sent an answer that could not be read. Try again.",
};

export class BrainError extends Error {
  override readonly name = "BrainError";
  readonly problem: BrainProblem;

  constructor(problem: BrainProblem, options?: ErrorOptions) {
    super(explanations[problem], options);
    this.problem = problem;
  }
}

export interface BrainClientOptions {
  readonly url: string;
  readonly idleMs?: number;
  readonly totalMs?: number;
  readonly embedMs?: number;
}

export function createBrainClient({ url, idleMs = 45_000, totalMs = 180_000, embedMs = 20_000 }: BrainClientOptions): Brain {
  const endpoint = new URL("/v1/turns", url);
  const enginesEndpoint = new URL("/v1/engines", url);
  const embeddingsEndpoint = new URL("/v1/embeddings", url);

  return {
    async embed(request) {
      let response: Response;
      try {
        response = await fetch(embeddingsEndpoint, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify(request),
          signal: AbortSignal.timeout(embedMs),
        });
      } catch (error) {
        throw new BrainError(error instanceof DOMException && error.name === "TimeoutError" ? "timeout" : "unreachable", { cause: error });
      }
      const body: unknown = await response.json().catch(() => undefined);
      if (!response.ok) {
        const failure = EmbeddingFailure.safeParse(body);
        throw new BrainError("refused", { cause: new Error(failure.success ? failure.data.detail : `brain answered ${response.status}`) });
      }
      const parsed = Embeddings.safeParse(body);
      if (!parsed.success || parsed.data.vectors.length !== request.texts.length) {
        throw new BrainError("malformed", { cause: parsed.error ?? new Error("the brain returned the wrong number of vectors") });
      }
      return parsed.data;
    },

    async engines() {
      try {
        const response = await fetch(enginesEndpoint, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(3000) });
        if (!response.ok) {
          throw new BrainError("refused", { cause: new Error(`brain answered ${response.status}`) });
        }
        return AvailableEngines.parse(await response.json()).available;
      } catch (error) {
        throw error instanceof BrainError ? error : new BrainError("unreachable", { cause: error });
      }
    },

    async *turn(request, signal) {
      const idle = new AbortController();
      const overall = AbortSignal.timeout(totalMs);
      const combined = AbortSignal.any([signal, overall, idle.signal]);
      let timer = setTimeout(() => idle.abort(), idleMs);
      const stillAlive = () => {
        clearTimeout(timer);
        timer = setTimeout(() => idle.abort(), idleMs);
      };
      const cause = (error: unknown): BrainError => {
        if (error instanceof BrainError) {
          return error;
        }
        if (signal.aborted) {
          return new BrainError("stopped", { cause: error });
        }
        if (overall.aborted || idle.signal.aborted) {
          return new BrainError("timeout", { cause: error });
        }
        return new BrainError("unreachable", { cause: error });
      };

      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/x-ndjson" },
          body: JSON.stringify(request),
          signal: combined,
        });
        if (!response.ok || response.body === null) {
          await response.body?.cancel();
          throw new BrainError("refused", { cause: new Error(`brain answered ${response.status}`) });
        }

        let buffer = "";
        for await (const chunk of response.body.pipeThrough(new TextDecoderStream())) {
          stillAlive();
          buffer += chunk;
          let newline = buffer.indexOf("\n");
          while (newline !== -1) {
            const line = buffer.slice(0, newline).trim();
            buffer = buffer.slice(newline + 1);
            if (line.length > 0) {
              yield parseLine(line);
            }
            newline = buffer.indexOf("\n");
          }
        }
        if (buffer.trim().length > 0) {
          yield parseLine(buffer.trim());
        }
      } catch (error) {
        throw cause(error);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export function brainEmbedder(brain: Brain): Embedder {
  return {
    embed: (texts, requestId) => brain.embed({ request_id: requestId, texts: [...texts] }),
  };
}

function parseLine(line: string): TurnEvent {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch (error) {
    throw new BrainError("malformed", { cause: error });
  }
  const parsed = TurnEvent.safeParse(value);
  if (!parsed.success) {
    throw new BrainError("malformed", { cause: parsed.error });
  }
  return parsed.data;
}
