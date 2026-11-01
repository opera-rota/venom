import { z } from "zod";
import { ActionSpec, Effect } from "./records.ts";
import { contracts } from "./registry.ts";

export const planLimits = {
  steps: 12,
  title: 120,
  summary: 300,
  reason: 300,
} as const;

export const DraftStep = z
  .strictObject({
    summary: z.string().min(1).max(planLimits.summary).regex(/\S/),
    spec: ActionSpec,
    effects: z.array(Effect).max(5),
    reversible: z.boolean(),
  })
  .register(contracts, { id: "DraftStep" });

export const PlanDraft = z
  .strictObject({
    title: z.string().min(1).max(planLimits.title).regex(/\S/),
    steps: z.array(DraftStep).max(planLimits.steps),
    cannot: z.string().min(1).max(planLimits.reason).regex(/\S/).nullable(),
  })
  .superRefine((plan, context) => {
    if ((plan.cannot === null) === (plan.steps.length === 0)) {
      context.addIssue({
        code: "custom",
        path: ["cannot"],
        message: "A plan has steps and no reason it cannot be done, or a reason and no steps.",
      });
    }
  })
  .register(contracts, { id: "PlanDraft" });

export type DraftStep = z.infer<typeof DraftStep>;
export type PlanDraft = z.infer<typeof PlanDraft>;
