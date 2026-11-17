import { z } from "zod";
import { Id, Timestamp } from "./primitives.ts";
import { contracts } from "./registry.ts";

export const laterLimits = {
  title: 120,
  body: 32_000,
  items: 100,
} as const;

export const LaterItem = z
  .strictObject({
    id: Id,
    account_id: Id,
    task_id: Id.nullable(),
    title: z.string().min(1).max(laterLimits.title).regex(/\S/),
    body: z.string().min(1).max(laterLimits.body).regex(/\S/),
    seen_at: Timestamp.nullable(),
    created_at: Timestamp,
  })
  .register(contracts, { id: "LaterItem" });

export const LaterList = z
  .strictObject({
    items: z.array(LaterItem).max(laterLimits.items),
  })
  .register(contracts, { id: "LaterList" });

export type LaterItem = z.infer<typeof LaterItem>;
export type LaterList = z.infer<typeof LaterList>;
