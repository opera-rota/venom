import { z } from "zod";
import { MessageText } from "./gateway.ts";
import { MemoryContext } from "./memory.ts";
import { EngineId, ModelName } from "./power.ts";
import { Id } from "./primitives.ts";
import { PromptRole } from "./prompts.ts";
import { Speaker } from "./records.ts";
import { contracts } from "./registry.ts";

export const ConversationEntry = z
  .strictObject({
    speaker: Speaker,
    text: z.string().min(1).max(16_000),
  })
  .register(contracts, { id: "ConversationEntry" });

export const TurnRequest = z
  .strictObject({
    request_id: Id,
    account_id: Id,
    device_id: Id,
    engine: EngineId,
    history: z.array(ConversationEntry).max(40),
    memories: z.array(MemoryContext).max(40),
    remembered: MemoryContext.nullable(),
    text: MessageText,
  })
  .register(contracts, { id: "TurnRequest" });

export const IntentKind = z
  .enum(["question", "task"])
  .register(contracts, { id: "IntentKind" });

export const Intent = z
  .strictObject({
    kind: IntentKind,
  })
  .register(contracts, { id: "Intent" });

export const TextOutput = z
  .strictObject({ kind: z.literal("text") })
  .register(contracts, { id: "TextOutput" });

export const StructuredOutput = z
  .strictObject({ kind: z.literal("structured"), contract: z.enum(["Intent"]) })
  .register(contracts, { id: "StructuredOutput" });

export const ReasoningOutput = z
  .discriminatedUnion("kind", [TextOutput, StructuredOutput])
  .register(contracts, { id: "ReasoningOutput" });

export const ReasoningRequest = z
  .strictObject({
    request_id: Id,
    role: PromptRole,
    prompt_version: z.int().positive(),
    messages: z.array(ConversationEntry).min(1).max(41),
    memories: z.array(MemoryContext).max(40),
    remembered: MemoryContext.nullable(),
    output: ReasoningOutput,
    max_output_tokens: z.int().min(1).max(8192),
  })
  .register(contracts, { id: "ReasoningRequest" });

export const ReasoningFailure = z
  .enum(["not_configured", "refused", "rate_limited", "unavailable", "timeout", "invalid_output", "internal"])
  .register(contracts, { id: "ReasoningFailure" });

export const TokenUsage = z
  .strictObject({
    input_tokens: z.int().nonnegative(),
    output_tokens: z.int().nonnegative(),
    cost_micro_usd: z.int().nonnegative(),
  })
  .register(contracts, { id: "TokenUsage" });

export const EmbeddingText = z
  .string()
  .min(1)
  .max(2000)
  .regex(/\S/)
  .register(contracts, { id: "EmbeddingText" });

export const EmbeddingRequest = z
  .strictObject({
    request_id: Id,
    texts: z.array(EmbeddingText).min(1).max(32),
  })
  .register(contracts, { id: "EmbeddingRequest" });

export const Embeddings = z
  .strictObject({
    model: ModelName,
    vectors: z.array(z.array(z.number()).min(1).max(8192)).min(1).max(32),
    usage: TokenUsage,
  })
  .register(contracts, { id: "Embeddings" });

export const EmbeddingFailure = z
  .strictObject({
    error: ReasoningFailure,
    detail: z.string().min(1),
  })
  .register(contracts, { id: "EmbeddingFailure" });

export const ReasoningDelta = z
  .strictObject({ type: z.literal("delta"), text: z.string().min(1) })
  .register(contracts, { id: "ReasoningDelta" });

export const ReasoningDone = z
  .strictObject({
    type: z.literal("done"),
    text: z.string(),
    model: ModelName,
    stop_reason: z.string().nullable(),
    usage: TokenUsage,
  })
  .register(contracts, { id: "ReasoningDone" });

export const ReasoningFailed = z
  .strictObject({ type: z.literal("failed"), reason: ReasoningFailure, detail: z.string().min(1) })
  .register(contracts, { id: "ReasoningFailed" });

export const ReasoningEvent = z
  .discriminatedUnion("type", [ReasoningDelta, ReasoningDone, ReasoningFailed])
  .register(contracts, { id: "ReasoningEvent" });

export const TurnDelta = z
  .strictObject({ type: z.literal("delta"), text: z.string().min(1) })
  .register(contracts, { id: "TurnDelta" });

export const TurnDone = z
  .strictObject({
    type: z.literal("done"),
    intent: IntentKind,
    text: z.string().min(1).max(16_000),
    model: ModelName.nullable(),
    usage: TokenUsage,
  })
  .register(contracts, { id: "TurnDone" });

export const TurnFailed = z
  .strictObject({ type: z.literal("failed"), reason: ReasoningFailure, detail: z.string().min(1) })
  .register(contracts, { id: "TurnFailed" });

export const TurnEvent = z
  .discriminatedUnion("type", [TurnDelta, TurnDone, TurnFailed])
  .register(contracts, { id: "TurnEvent" });

export type ConversationEntry = z.infer<typeof ConversationEntry>;
export type TurnRequest = z.infer<typeof TurnRequest>;
export type IntentKind = z.infer<typeof IntentKind>;
export type Intent = z.infer<typeof Intent>;
export type TextOutput = z.infer<typeof TextOutput>;
export type StructuredOutput = z.infer<typeof StructuredOutput>;
export type ReasoningOutput = z.infer<typeof ReasoningOutput>;
export type ReasoningRequest = z.infer<typeof ReasoningRequest>;
export type ReasoningFailure = z.infer<typeof ReasoningFailure>;
export type TokenUsage = z.infer<typeof TokenUsage>;
export type EmbeddingText = z.infer<typeof EmbeddingText>;
export type EmbeddingRequest = z.infer<typeof EmbeddingRequest>;
export type Embeddings = z.infer<typeof Embeddings>;
export type EmbeddingFailure = z.infer<typeof EmbeddingFailure>;
export type ReasoningDelta = z.infer<typeof ReasoningDelta>;
export type ReasoningDone = z.infer<typeof ReasoningDone>;
export type ReasoningFailed = z.infer<typeof ReasoningFailed>;
export type ReasoningEvent = z.infer<typeof ReasoningEvent>;
export type TurnDelta = z.infer<typeof TurnDelta>;
export type TurnDone = z.infer<typeof TurnDone>;
export type TurnFailed = z.infer<typeof TurnFailed>;
export type TurnEvent = z.infer<typeof TurnEvent>;
