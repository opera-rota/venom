import { z } from "zod";
import { Id, Timestamp } from "./primitives.ts";
import { MemoryItem, MemoryType } from "./records.ts";
import { contracts } from "./registry.ts";

export const memoryLimits = {
  items: 500,
  characters: 500,
  preferences: 20,
  recalled: 6,
} as const;

export const MemoryContent = z
  .string()
  .min(1)
  .max(memoryLimits.characters)
  .regex(/\S/)
  .register(contracts, { id: "MemoryContent" });

export const MemoryDraft = z
  .strictObject({
    type: MemoryType,
    content: MemoryContent,
  })
  .register(contracts, { id: "MemoryDraft" });

export const MemoryList = z
  .strictObject({
    items: z.array(MemoryItem).max(memoryLimits.items),
    limit: z.int().positive(),
  })
  .register(contracts, { id: "MemoryList" });

export const MemoryForgotten = z
  .strictObject({
    item_id: Id,
    message_ids: z.array(Id),
  })
  .register(contracts, { id: "MemoryForgotten" });

export const MemoryContext = z
  .strictObject({
    type: MemoryType,
    content: MemoryContent,
    saved_at: Timestamp,
  })
  .register(contracts, { id: "MemoryContext" });

export type MemoryContent = z.infer<typeof MemoryContent>;
export type MemoryDraft = z.infer<typeof MemoryDraft>;
export type MemoryList = z.infer<typeof MemoryList>;
export type MemoryForgotten = z.infer<typeof MemoryForgotten>;
export type MemoryContext = z.infer<typeof MemoryContext>;
