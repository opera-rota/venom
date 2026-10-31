import { z } from "zod";
import { Timestamp } from "./primitives.ts";
import { contracts } from "./registry.ts";

export const ModelName = z
  .string()
  .min(1)
  .max(100)
  .register(contracts, { id: "ModelName" });

export const EngineId = z
  .enum([
    "dove",
    "sparrow",
    "breeze",
    "pebble",
    "ember",
    "turbo",
    "comet",
    "stormi",
    "falcon",
    "viper",
    "utopia",
    "phantom",
    "nova",
    "titan",
    "oracle",
  ])
  .register(contracts, { id: "EngineId" });

export const EngineClass = z
  .enum(["free", "swift", "titan"])
  .register(contracts, { id: "EngineClass" });

export const ProficiencyLevel = z
  .int()
  .min(1)
  .max(5)
  .register(contracts, { id: "ProficiencyLevel" });

export const Proficiency = z
  .strictObject({
    thinking: ProficiencyLevel,
    coding: ProficiencyLevel,
    writing: ProficiencyLevel,
    speed: ProficiencyLevel,
    long_memory: ProficiencyLevel,
  })
  .register(contracts, { id: "Proficiency" });

export const Engine = z
  .strictObject({
    id: EngineId,
    name: z.string().min(1).max(24),
    class: EngineClass,
    tagline: z.string().min(1).max(60),
    proficiency: Proficiency,
    typical_power: z.int().nonnegative(),
  })
  .register(contracts, { id: "Engine" });

export const EngineSpec = z
  .strictObject({
    ...Engine.shape,
    models: z.array(ModelName).min(1).max(3),
  })
  .register(contracts, { id: "EngineSpec" });

export const EngineList = z
  .strictObject({
    engines: z.array(Engine),
    current: EngineId,
  })
  .register(contracts, { id: "EngineList" });

export const ChooseEngine = z
  .strictObject({
    engine: EngineId,
  })
  .register(contracts, { id: "ChooseEngine" });

export const AvailableEngines = z
  .strictObject({
    available: z.array(EngineId),
  })
  .register(contracts, { id: "AvailableEngines" });

export const PowerStatus = z
  .strictObject({
    engine: EngineId,
    engine_class: EngineClass,
    balance: z.int(),
    free_daily_answers: z.int().nonnegative(),
    free_used_today: z.int().nonnegative(),
    free_resets_at: Timestamp,
    answers_left: z.int().nonnegative(),
    answers_left_exact: z.boolean(),
  })
  .register(contracts, { id: "PowerStatus" });

export type ModelName = z.infer<typeof ModelName>;
export type EngineId = z.infer<typeof EngineId>;
export type EngineClass = z.infer<typeof EngineClass>;
export type ProficiencyLevel = z.infer<typeof ProficiencyLevel>;
export type Proficiency = z.infer<typeof Proficiency>;
export type Engine = z.infer<typeof Engine>;
export type EngineSpec = z.infer<typeof EngineSpec>;
export type EngineList = z.infer<typeof EngineList>;
export type ChooseEngine = z.infer<typeof ChooseEngine>;
export type AvailableEngines = z.infer<typeof AvailableEngines>;
export type PowerStatus = z.infer<typeof PowerStatus>;

export const defaultEngine: EngineId = "dove";

export const powerUnitMicroUsd = 100;

export const engines = {
  dove: {
    id: "dove",
    name: "Dove",
    class: "free",
    tagline: "Gentle everyday helper",
    proficiency: { thinking: 2, coding: 2, writing: 3, speed: 5, long_memory: 5 },
    typical_power: 0,
    models: ["google/gemini-2.5-flash-lite", "deepseek/deepseek-v4.1-flash"],
  },
  sparrow: {
    id: "sparrow",
    name: "Sparrow",
    class: "free",
    tagline: "Quick and light",
    proficiency: { thinking: 3, coding: 3, writing: 2, speed: 4, long_memory: 5 },
    typical_power: 0,
    models: ["deepseek/deepseek-v4.1-flash", "qwen/qwen3.7-flash"],
  },
  breeze: {
    id: "breeze",
    name: "Breeze",
    class: "free",
    tagline: "Short, clear answers",
    proficiency: { thinking: 2, coding: 2, writing: 2, speed: 5, long_memory: 4 },
    typical_power: 0,
    models: ["openai/gpt-5-nano", "google/gemini-2.5-flash-lite"],
  },
  pebble: {
    id: "pebble",
    name: "Pebble",
    class: "free",
    tagline: "Small and steady",
    proficiency: { thinking: 2, coding: 2, writing: 3, speed: 4, long_memory: 5 },
    typical_power: 0,
    models: ["meta-llama/llama-4-scout", "google/gemini-2.5-flash-lite"],
  },
  ember: {
    id: "ember",
    name: "Ember",
    class: "free",
    tagline: "Warm thinker for small tasks",
    proficiency: { thinking: 3, coding: 3, writing: 2, speed: 4, long_memory: 5 },
    typical_power: 0,
    models: ["qwen/qwen3.7-flash", "deepseek/deepseek-v4.1-flash"],
  },
  turbo: {
    id: "turbo",
    name: "Turbo",
    class: "swift",
    tagline: "Fast and sharp",
    proficiency: { thinking: 3, coding: 4, writing: 4, speed: 5, long_memory: 5 },
    typical_power: 7,
    models: ["anthropic/claude-haiku-5.5", "openai/gpt-6-luna"],
  },
  comet: {
    id: "comet",
    name: "Comet",
    class: "swift",
    tagline: "Quick all-rounder",
    proficiency: { thinking: 3, coding: 3, writing: 3, speed: 5, long_memory: 5 },
    typical_power: 7,
    models: ["openai/gpt-6-luna", "anthropic/claude-haiku-5.5"],
  },
  stormi: {
    id: "stormi",
    name: "Stormi",
    class: "swift",
    tagline: "Bright and lively",
    proficiency: { thinking: 3, coding: 3, writing: 3, speed: 5, long_memory: 5 },
    typical_power: 25,
    models: ["google/gemini-3.5-flash-lite", "google/gemini-2.5-flash-lite"],
  },
  falcon: {
    id: "falcon",
    name: "Falcon",
    class: "swift",
    tagline: "Sharp-eyed reasoner",
    proficiency: { thinking: 4, coding: 4, writing: 3, speed: 3, long_memory: 5 },
    typical_power: 14,
    models: ["deepseek/deepseek-v4-pro", "deepseek/deepseek-v4.1-flash"],
  },
  viper: {
    id: "viper",
    name: "Viper",
    class: "swift",
    tagline: "Precise writer",
    proficiency: { thinking: 3, coding: 3, writing: 4, speed: 4, long_memory: 4 },
    typical_power: 23,
    models: ["mistralai/mistral-medium-3.1", "anthropic/claude-haiku-5.5"],
  },
  utopia: {
    id: "utopia",
    name: "Utopia",
    class: "titan",
    tagline: "The deepest thinker",
    proficiency: { thinking: 5, coding: 5, writing: 5, speed: 2, long_memory: 5 },
    typical_power: 221,
    models: ["anthropic/claude-opus-5.5", "anthropic/claude-sonnet-5.5"],
  },
  phantom: {
    id: "phantom",
    name: "Phantom",
    class: "titan",
    tagline: "Silent problem solver",
    proficiency: { thinking: 5, coding: 5, writing: 4, speed: 3, long_memory: 5 },
    typical_power: 111,
    models: ["openai/gpt-6.1-sol", "anthropic/claude-sonnet-5.5"],
  },
  nova: {
    id: "nova",
    name: "Nova",
    class: "titan",
    tagline: "Wide knowledge, long reading",
    proficiency: { thinking: 5, coding: 4, writing: 4, speed: 3, long_memory: 5 },
    typical_power: 111,
    models: ["google/gemini-4-argon", "anthropic/claude-sonnet-5.5"],
  },
  titan: {
    id: "titan",
    name: "Titan",
    class: "titan",
    tagline: "Strong and balanced",
    proficiency: { thinking: 4, coding: 5, writing: 5, speed: 4, long_memory: 5 },
    typical_power: 111,
    models: ["anthropic/claude-sonnet-5.5", "openai/gpt-6.1-sol"],
  },
  oracle: {
    id: "oracle",
    name: "Oracle",
    class: "titan",
    tagline: "Bold and current",
    proficiency: { thinking: 4, coding: 4, writing: 4, speed: 4, long_memory: 4 },
    typical_power: 83,
    models: ["x-ai/grok-4.7", "anthropic/claude-sonnet-5.5"],
  },
} as const satisfies Record<EngineId, EngineSpec>;

export function publicEngine({ models: _models, ...engine }: EngineSpec): Engine {
  return engine;
}
