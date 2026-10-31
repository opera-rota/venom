import { z } from "zod";
import { Email, Id, Timestamp } from "./primitives.ts";
import { contracts } from "./registry.ts";

export const ListeningMode = z
  .enum(["wake_word", "press_to_talk"])
  .register(contracts, { id: "ListeningMode" });

export const ConfirmationStrictness = z
  .enum(["standard", "strict"])
  .register(contracts, { id: "ConfirmationStrictness" });

export const AccountSettings = z
  .strictObject({
    listening_mode: ListeningMode,
    confirmation_strictness: ConfirmationStrictness,
  })
  .register(contracts, { id: "AccountSettings" });

export const Account = z
  .strictObject({
    id: Id,
    name: z.string().min(1).max(120),
    email: Email,
    settings: AccountSettings,
    created_at: Timestamp,
  })
  .register(contracts, { id: "Account" });

export const DeviceType = z
  .enum(["computer", "phone", "tv", "watch"])
  .register(contracts, { id: "DeviceType" });

export const Platform = z
  .enum(["windows", "macos", "linux", "android", "ios", "android_tv", "tvos", "wear_os", "watchos"])
  .register(contracts, { id: "Platform" });

export const DeviceStatus = z
  .enum(["registered", "active", "offline", "revoked"])
  .register(contracts, { id: "DeviceStatus" });

export const Capabilities = z
  .strictObject({
    screen_control: z.boolean(),
    microphone: z.boolean(),
    speaker: z.boolean(),
    shortcuts: z.boolean(),
    notifications: z.boolean(),
    network: z.boolean(),
  })
  .register(contracts, { id: "Capabilities" });

export const Device = z
  .strictObject({
    id: Id,
    account_id: Id,
    type: DeviceType,
    name: z.string().min(1).max(80),
    platform: Platform,
    capabilities: Capabilities,
    status: DeviceStatus,
    last_seen_at: Timestamp.nullable(),
  })
  .register(contracts, { id: "Device" });

export const Speaker = z
  .enum(["user", "venom"])
  .register(contracts, { id: "Speaker" });

export const Message = z
  .strictObject({
    id: Id,
    account_id: Id,
    device_id: Id,
    speaker: Speaker,
    text: z.string().min(1),
    created_at: Timestamp,
  })
  .register(contracts, { id: "Message" });

export const StepAction = z
  .enum(["wait", "open_app", "type_text", "click", "run_script", "take_screenshot", "call_connector"])
  .register(contracts, { id: "StepAction" });

export const Effect = z
  .enum(["deletes", "pays", "posts", "uses_credential", "reaches_outside"])
  .register(contracts, { id: "Effect" });

export const DeviceTarget = z
  .strictObject({ kind: z.literal("device"), device_id: Id })
  .register(contracts, { id: "DeviceTarget" });

export const ConnectorTarget = z
  .strictObject({ kind: z.literal("connector"), connector_id: Id })
  .register(contracts, { id: "ConnectorTarget" });

export const StepTarget = z
  .discriminatedUnion("kind", [DeviceTarget, ConnectorTarget])
  .register(contracts, { id: "StepTarget" });

export const FailurePolicy = z
  .enum(["abort", "retry", "reroute"])
  .register(contracts, { id: "FailurePolicy" });

export const StepStatus = z
  .enum(["pending", "waiting", "running", "done", "failed", "skipped", "stopped"])
  .register(contracts, { id: "StepStatus" });

const stepFields = {
  action: StepAction,
  target: StepTarget,
  effects: z.array(Effect).max(5),
  requires_confirmation: z.boolean(),
  reversible: z.boolean(),
  on_failure: FailurePolicy,
};

export const StepTemplate = z
  .strictObject(stepFields)
  .register(contracts, { id: "StepTemplate" });

export const Step = z
  .strictObject({
    id: Id,
    task_id: Id,
    order: z.int().nonnegative(),
    summary: z.string().min(1).max(300),
    ...stepFields,
    status: StepStatus,
    output: z.string().nullable(),
  })
  .register(contracts, { id: "Step" });

export const TaskStatus = z
  .enum(["created", "planned", "running", "awaiting_confirmation", "completed", "failed", "cancelled", "stopped"])
  .register(contracts, { id: "TaskStatus" });

export const Task = z
  .strictObject({
    id: Id,
    account_id: Id,
    origin_device_id: Id,
    target_device_id: Id.nullable(),
    request_text: z.string().min(1),
    plan: z.array(Step),
    status: TaskStatus,
    result: z.string().nullable(),
    created_at: Timestamp,
    updated_at: Timestamp,
  })
  .register(contracts, { id: "Task" });

export const SkillStatus = z
  .enum(["taught", "saved", "active", "updated", "retired"])
  .register(contracts, { id: "SkillStatus" });

export const Skill = z
  .strictObject({
    id: Id,
    account_id: Id,
    name: z.string().min(1).max(80),
    trigger: z.string().min(1),
    steps: z.array(StepTemplate).min(1),
    run_count: z.int().nonnegative(),
    success_count: z.int().nonnegative(),
    last_run_at: Timestamp.nullable(),
    status: SkillStatus,
  })
  .register(contracts, { id: "Skill" });

export const MemoryType = z
  .enum(["fact", "preference", "event"])
  .register(contracts, { id: "MemoryType" });

export const MemoryStatus = z
  .enum(["active", "archived", "forgotten"])
  .register(contracts, { id: "MemoryStatus" });

export const MemorySource = z
  .enum(["chat", "settings"])
  .register(contracts, { id: "MemorySource" });

export const MemoryItem = z
  .strictObject({
    id: Id,
    account_id: Id,
    type: MemoryType,
    content: z.string().min(1).max(500),
    source: MemorySource,
    created_at: Timestamp,
    updated_at: Timestamp,
    status: MemoryStatus,
  })
  .register(contracts, { id: "MemoryItem" });

export const ConnectorService = z
  .enum(["mail", "calendar"])
  .register(contracts, { id: "ConnectorService" });

export const ConnectorStatus = z
  .enum(["connected", "expired", "disconnected"])
  .register(contracts, { id: "ConnectorStatus" });

export const ConnectorScope = z
  .string()
  .min(1)
  .register(contracts, { id: "ConnectorScope" });

export const Connector = z
  .strictObject({
    id: Id,
    account_id: Id,
    service: ConnectorService,
    scopes: z.array(ConnectorScope),
    status: ConnectorStatus,
  })
  .register(contracts, { id: "Connector" });

export type ListeningMode = z.infer<typeof ListeningMode>;
export type ConfirmationStrictness = z.infer<typeof ConfirmationStrictness>;
export type AccountSettings = z.infer<typeof AccountSettings>;
export type Account = z.infer<typeof Account>;
export type DeviceType = z.infer<typeof DeviceType>;
export type Platform = z.infer<typeof Platform>;
export type DeviceStatus = z.infer<typeof DeviceStatus>;
export type Capabilities = z.infer<typeof Capabilities>;
export type Device = z.infer<typeof Device>;
export type Speaker = z.infer<typeof Speaker>;
export type Message = z.infer<typeof Message>;
export type StepAction = z.infer<typeof StepAction>;
export type Effect = z.infer<typeof Effect>;
export type DeviceTarget = z.infer<typeof DeviceTarget>;
export type ConnectorTarget = z.infer<typeof ConnectorTarget>;
export type StepTarget = z.infer<typeof StepTarget>;
export type FailurePolicy = z.infer<typeof FailurePolicy>;
export type StepStatus = z.infer<typeof StepStatus>;
export type StepTemplate = z.infer<typeof StepTemplate>;
export type Step = z.infer<typeof Step>;
export type TaskStatus = z.infer<typeof TaskStatus>;
export type Task = z.infer<typeof Task>;
export type SkillStatus = z.infer<typeof SkillStatus>;
export type Skill = z.infer<typeof Skill>;
export type MemoryType = z.infer<typeof MemoryType>;
export type MemoryStatus = z.infer<typeof MemoryStatus>;
export type MemorySource = z.infer<typeof MemorySource>;
export type MemoryItem = z.infer<typeof MemoryItem>;
export type ConnectorService = z.infer<typeof ConnectorService>;
export type ConnectorStatus = z.infer<typeof ConnectorStatus>;
export type ConnectorScope = z.infer<typeof ConnectorScope>;
export type Connector = z.infer<typeof Connector>;
