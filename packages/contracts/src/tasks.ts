import { z } from "zod";
import { Id } from "./primitives.ts";
import { SetAsideReason } from "./records.ts";
import { contracts } from "./registry.ts";

export const ResumeTask = z
  .strictObject({ kind: z.literal("resume") })
  .register(contracts, { id: "ResumeTask" });

export const RetryStep = z
  .strictObject({ kind: z.literal("retry"), step_id: Id })
  .register(contracts, { id: "RetryStep" });

export const SkipStep = z
  .strictObject({ kind: z.literal("skip"), step_id: Id, reason: SetAsideReason })
  .register(contracts, { id: "SkipStep" });

export const IgnoreStep = z
  .strictObject({ kind: z.literal("ignore"), step_id: Id, reason: SetAsideReason })
  .register(contracts, { id: "IgnoreStep" });

export const RestoreStep = z
  .strictObject({ kind: z.literal("restore"), step_id: Id })
  .register(contracts, { id: "RestoreStep" });

export const TaskControl = z
  .discriminatedUnion("kind", [ResumeTask, RetryStep, SkipStep, IgnoreStep, RestoreStep])
  .register(contracts, { id: "TaskControl" });

export type ResumeTask = z.infer<typeof ResumeTask>;
export type RetryStep = z.infer<typeof RetryStep>;
export type SkipStep = z.infer<typeof SkipStep>;
export type IgnoreStep = z.infer<typeof IgnoreStep>;
export type RestoreStep = z.infer<typeof RestoreStep>;
export type TaskControl = z.infer<typeof TaskControl>;
