import type { TokenUsage } from "@venom/contracts";
import type { Embedded, Embedder } from "./memory.ts";

const dimensions = 1024;

const ignored = new Set(["a", "an", "the", "is", "are", "was", "i", "my", "me", "on", "of", "to", "in", "what", "did", "do", "say", "about", "and"]);

function bucket(word: string): number {
  let hash = 2166136261;
  for (const character of word) {
    hash = Math.imul(hash ^ (character.codePointAt(0) ?? 0), 16777619);
  }
  return (hash >>> 0) % dimensions;
}

export function wordVector(text: string): number[] {
  const vector = new Array<number>(dimensions).fill(0);
  for (const raw of text.toLowerCase().match(/\p{L}+/gu) ?? []) {
    const word = raw.length > 3 && raw.endsWith("s") ? raw.slice(0, -1) : raw;
    if (word.length > 1 && !ignored.has(word)) {
      vector[bucket(word)] = (vector[bucket(word)] ?? 0) + 1;
    }
  }
  const length = Math.hypot(...vector);
  return length === 0 ? vector.map((_, index) => (index === 0 ? 1 : 0)) : vector.map((value) => value / length);
}

export interface WordEmbedder extends Embedder {
  readonly calls: { readonly texts: readonly string[]; readonly requestId: string }[];
  model: string;
  working: boolean;
  usage: TokenUsage;
}

export function wordEmbedder(model = "scripted-embedding"): WordEmbedder {
  const embedder: WordEmbedder = {
    calls: [],
    model,
    working: true,
    usage: { input_tokens: 8, output_tokens: 0, cost_micro_usd: 0 },
    async embed(texts, requestId): Promise<Embedded> {
      embedder.calls.push({ texts, requestId });
      if (!embedder.working) {
        throw new Error("embeddings are down");
      }
      return { model: embedder.model, vectors: texts.map(wordVector), usage: embedder.usage };
    },
  };
  return embedder;
}
