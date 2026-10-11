import { z } from "zod";
import { Email, Id, Timestamp } from "./primitives.ts";
import { Capabilities, DeviceType, Platform, StepTarget } from "./records.ts";
import { contracts } from "./registry.ts";

export const DeviceInfo = z
  .strictObject({
    type: DeviceType,
    name: z.string().min(1).max(80),
    platform: Platform,
    capabilities: Capabilities,
  })
  .register(contracts, { id: "DeviceInfo" });

export const AttachRequest = z
  .strictObject({
    email: Email,
    secret_word_proof: z.string().min(1),
    device: DeviceInfo,
  })
  .register(contracts, { id: "AttachRequest" });

export const RouteMethod = z
  .enum(["device_action", "connector", "script"])
  .register(contracts, { id: "RouteMethod" });

export const RouteDecision = z
  .strictObject({
    task_id: Id,
    step_id: Id,
    method: RouteMethod,
    target: StepTarget,
  })
  .register(contracts, { id: "RouteDecision" });

export const Risk = z
  .enum(["low", "medium", "high"])
  .register(contracts, { id: "Risk" });

export const ConfirmRequest = z
  .strictObject({
    task_id: Id,
    step_id: Id,
    plain_language: z.string().min(1),
    risk: Risk,
  })
  .register(contracts, { id: "ConfirmRequest" });

export const StopAll = z
  .strictObject({ kind: z.literal("all") })
  .register(contracts, { id: "StopAll" });

export const StopTask = z
  .strictObject({ kind: z.literal("task"), task_id: Id })
  .register(contracts, { id: "StopTask" });

export const StopDevice = z
  .strictObject({ kind: z.literal("device"), device_id: Id })
  .register(contracts, { id: "StopDevice" });

export const StopScope = z
  .discriminatedUnion("kind", [StopAll, StopTask, StopDevice])
  .register(contracts, { id: "StopScope" });

export const StopSignal = z
  .strictObject({
    account_id: Id,
    scope: StopScope,
    issued_at: Timestamp,
  })
  .register(contracts, { id: "StopSignal" });

export const CapabilityReport = z
  .strictObject({
    device_id: Id,
    capabilities: Capabilities,
  })
  .register(contracts, { id: "CapabilityReport" });

export const LiveEventKind = z
  .enum(["started", "output", "awaiting_confirmation", "done", "failed", "stopped"])
  .register(contracts, { id: "LiveEventKind" });

export const LiveEvent = z
  .strictObject({
    request_id: Id,
    task_id: Id.nullable(),
    step_id: Id.nullable(),
    kind: LiveEventKind,
    text: z.string(),
    emitted_at: Timestamp,
  })
  .register(contracts, { id: "LiveEvent" });

export type DeviceInfo = z.infer<typeof DeviceInfo>;
export type AttachRequest = z.infer<typeof AttachRequest>;
export type RouteMethod = z.infer<typeof RouteMethod>;
export type RouteDecision = z.infer<typeof RouteDecision>;
export type Risk = z.infer<typeof Risk>;
export type ConfirmRequest = z.infer<typeof ConfirmRequest>;
export type StopAll = z.infer<typeof StopAll>;
export type StopTask = z.infer<typeof StopTask>;
export type StopDevice = z.infer<typeof StopDevice>;
export type StopScope = z.infer<typeof StopScope>;
export type StopSignal = z.infer<typeof StopSignal>;
export type CapabilityReport = z.infer<typeof CapabilityReport>;
export type LiveEventKind = z.infer<typeof LiveEventKind>;
export type LiveEvent = z.infer<typeof LiveEvent>;
