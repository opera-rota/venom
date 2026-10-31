import { z } from "zod";
import { ConfirmRequest, StopScope } from "./messages.ts";
import { Id, Timestamp } from "./primitives.ts";
import { ConfirmationStrictness, Task } from "./records.ts";
import { contracts } from "./registry.ts";

export const safetyLimits = {
  commandLifetimeSeconds: 30,
  clockSkewSeconds: 30,
  challengeLifetimeSeconds: 60,
  waitSeconds: 600,
  recentTasks: 20,
} as const;

export const PublicKey = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/)
  .register(contracts, { id: "PublicKey" });

export const Signature = z
  .string()
  .regex(/^[A-Za-z0-9_-]{86}$/)
  .register(contracts, { id: "Signature" });

export const DeviceKey = z
  .strictObject({
    public_key: PublicKey,
  })
  .register(contracts, { id: "DeviceKey" });

export const DeviceKeyEnrolled = z
  .strictObject({
    device_id: Id,
    server_key: PublicKey,
  })
  .register(contracts, { id: "DeviceKeyEnrolled" });

export const LiveChallenge = z
  .strictObject({
    challenge_id: Id,
    nonce: PublicKey,
    expires_at: Timestamp,
  })
  .register(contracts, { id: "LiveChallenge" });

export const WaitAction = z
  .strictObject({
    name: z.literal("wait"),
    seconds: z.int().min(1).max(safetyLimits.waitSeconds),
  })
  .register(contracts, { id: "WaitAction" });

export const DeviceAction = z
  .discriminatedUnion("name", [WaitAction])
  .register(contracts, { id: "DeviceAction" });

export const RunStepCommand = z
  .strictObject({
    kind: z.literal("run_step"),
    task_id: Id,
    step_id: Id,
    action: DeviceAction,
  })
  .register(contracts, { id: "RunStepCommand" });

export const StopCommand = z
  .strictObject({
    kind: z.literal("stop"),
    stop_id: Id,
    task_id: Id.nullable(),
  })
  .register(contracts, { id: "StopCommand" });

export const CommandBody = z
  .discriminatedUnion("kind", [RunStepCommand, StopCommand])
  .register(contracts, { id: "CommandBody" });

export const CommandPayload = z
  .strictObject({
    command_id: Id,
    account_id: Id,
    device_id: Id,
    issued_at: Timestamp,
    expires_at: Timestamp,
    body: CommandBody,
  })
  .register(contracts, { id: "CommandPayload" });

export const SignedCommand = z
  .strictObject({
    payload: z.string().min(2).max(4096),
    signature: Signature,
  })
  .register(contracts, { id: "SignedCommand" });

export const CommandFrame = z
  .strictObject({
    type: z.literal("command"),
    command: SignedCommand,
  })
  .register(contracts, { id: "CommandFrame" });

export const CommandOutcome = z
  .enum(["done", "stopped", "failed", "refused"])
  .register(contracts, { id: "CommandOutcome" });

export const CommandReport = z
  .strictObject({
    command_id: Id,
    outcome: CommandOutcome,
    detail: z.string().min(1).max(300).nullable(),
  })
  .register(contracts, { id: "CommandReport" });

export const StopRequest = z
  .strictObject({
    stop_id: Id,
    scope: StopScope,
  })
  .register(contracts, { id: "StopRequest" });

export const StopReceipt = z
  .strictObject({
    stop_id: Id,
    stopped_at: Timestamp,
    tasks: z.array(Task),
  })
  .register(contracts, { id: "StopReceipt" });

export const DrillKind = z
  .enum(["wait", "sensitive", "progress"])
  .register(contracts, { id: "DrillKind" });

export const TaskDrill = z
  .strictObject({
    kind: DrillKind,
  })
  .register(contracts, { id: "TaskDrill" });

export const ConfirmDecision = z
  .enum(["approve", "decline"])
  .register(contracts, { id: "ConfirmDecision" });

export const ConfirmAnswer = z
  .strictObject({
    decision: ConfirmDecision,
  })
  .register(contracts, { id: "ConfirmAnswer" });

export const ConfirmationOutcome = z
  .enum(["approved", "declined", "stopped"])
  .register(contracts, { id: "ConfirmationOutcome" });

export const ConfirmationAnswered = z
  .strictObject({
    outcome: ConfirmationOutcome,
    device_id: Id.nullable(),
    device_name: z.string().min(1).max(80).nullable(),
    answered_at: Timestamp,
  })
  .register(contracts, { id: "ConfirmationAnswered" });

export const TaskList = z
  .strictObject({
    tasks: z.array(Task).max(safetyLimits.recentTasks),
    confirmations: z.array(ConfirmRequest),
  })
  .register(contracts, { id: "TaskList" });

export const SafetySettings = z
  .strictObject({
    confirmation_strictness: ConfirmationStrictness,
  })
  .register(contracts, { id: "SafetySettings" });

export type PublicKey = z.infer<typeof PublicKey>;
export type Signature = z.infer<typeof Signature>;
export type DeviceKey = z.infer<typeof DeviceKey>;
export type DeviceKeyEnrolled = z.infer<typeof DeviceKeyEnrolled>;
export type LiveChallenge = z.infer<typeof LiveChallenge>;
export type WaitAction = z.infer<typeof WaitAction>;
export type DeviceAction = z.infer<typeof DeviceAction>;
export type RunStepCommand = z.infer<typeof RunStepCommand>;
export type StopCommand = z.infer<typeof StopCommand>;
export type CommandBody = z.infer<typeof CommandBody>;
export type CommandPayload = z.infer<typeof CommandPayload>;
export type SignedCommand = z.infer<typeof SignedCommand>;
export type CommandFrame = z.infer<typeof CommandFrame>;
export type CommandOutcome = z.infer<typeof CommandOutcome>;
export type CommandReport = z.infer<typeof CommandReport>;
export type StopRequest = z.infer<typeof StopRequest>;
export type StopReceipt = z.infer<typeof StopReceipt>;
export type DrillKind = z.infer<typeof DrillKind>;
export type TaskDrill = z.infer<typeof TaskDrill>;
export type ConfirmDecision = z.infer<typeof ConfirmDecision>;
export type ConfirmAnswer = z.infer<typeof ConfirmAnswer>;
export type ConfirmationOutcome = z.infer<typeof ConfirmationOutcome>;
export type ConfirmationAnswered = z.infer<typeof ConfirmationAnswered>;
export type TaskList = z.infer<typeof TaskList>;
export type SafetySettings = z.infer<typeof SafetySettings>;
