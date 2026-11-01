import { z } from "zod";
import { Email, Id, Timestamp } from "./primitives.ts";
import { progressOf, sameProgress } from "./progress.ts";
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
    task_id: Id.nullable(),
    created_at: Timestamp,
  })
  .register(contracts, { id: "Message" });

export const StepAction = z
  .enum(["wait", "open_app", "type_text", "click", "run_script", "take_screenshot", "call_connector"])
  .register(contracts, { id: "StepAction" });

export const actionLimits = {
  waitSeconds: 600,
  appName: 80,
  typedText: 2000,
  typedInto: 120,
  clickOn: 160,
  scriptPurpose: 300,
  scriptCode: 4000,
  connectorOperation: 120,
  connectorDetails: 600,
} as const;

const said = (limit: number) => z.string().min(1).max(limit).regex(/\S/);

export const ConnectorService = z
  .enum(["mail", "calendar"])
  .register(contracts, { id: "ConnectorService" });

export const ScriptLanguage = z
  .enum(["powershell", "python"])
  .register(contracts, { id: "ScriptLanguage" });

export const WaitAction = z
  .strictObject({
    name: z.literal("wait"),
    seconds: z.int().min(1).max(actionLimits.waitSeconds),
  })
  .register(contracts, { id: "WaitAction" });

export const OpenAppAction = z
  .strictObject({
    name: z.literal("open_app"),
    app: said(actionLimits.appName),
  })
  .register(contracts, { id: "OpenAppAction" });

export const TypeTextAction = z
  .strictObject({
    name: z.literal("type_text"),
    text: said(actionLimits.typedText),
    into: said(actionLimits.typedInto),
  })
  .register(contracts, { id: "TypeTextAction" });

export const ClickAction = z
  .strictObject({
    name: z.literal("click"),
    on: said(actionLimits.clickOn),
  })
  .register(contracts, { id: "ClickAction" });

export const RunScriptAction = z
  .strictObject({
    name: z.literal("run_script"),
    language: ScriptLanguage,
    purpose: said(actionLimits.scriptPurpose),
    code: said(actionLimits.scriptCode),
  })
  .register(contracts, { id: "RunScriptAction" });

export const TakeScreenshotAction = z
  .strictObject({
    name: z.literal("take_screenshot"),
  })
  .register(contracts, { id: "TakeScreenshotAction" });

export const CallConnectorAction = z
  .strictObject({
    name: z.literal("call_connector"),
    service: ConnectorService,
    operation: said(actionLimits.connectorOperation),
    details: said(actionLimits.connectorDetails),
  })
  .register(contracts, { id: "CallConnectorAction" });

export const ActionSpec = z
  .discriminatedUnion("name", [WaitAction, OpenAppAction, TypeTextAction, ClickAction, RunScriptAction, TakeScreenshotAction, CallConnectorAction])
  .register(contracts, { id: "ActionSpec" });

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
  .enum(["pending", "waiting", "running", "done", "failed", "skipped", "stopped", "ignored"])
  .register(contracts, { id: "StepStatus" });

const stepFields = {
  action: StepAction,
  spec: ActionSpec,
  target: StepTarget,
  effects: z.array(Effect).max(5),
  requires_confirmation: z.boolean(),
  reversible: z.boolean(),
  on_failure: FailurePolicy,
};

export const SetAsideReason = z
  .string()
  .min(1)
  .max(300)
  .regex(/\S/)
  .register(contracts, { id: "SetAsideReason" });

function specMatchesAction(step: { readonly action: StepAction; readonly spec: ActionSpec }, context: z.core.$RefinementCtx): void {
  if (step.spec.name !== step.action) {
    context.addIssue({ code: "custom", path: ["spec"], message: "The step's details must be for the same action as the step." });
  }
}

export const StepTemplate = z
  .strictObject(stepFields)
  .superRefine(specMatchesAction)
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
    set_aside_reason: SetAsideReason.nullable(),
    repeatable: z.boolean(),
  })
  .superRefine(specMatchesAction)
  .register(contracts, { id: "Step" });

export const TaskStatus = z
  .enum(["created", "planned", "running", "awaiting_confirmation", "completed", "failed", "cancelled", "stopped"])
  .register(contracts, { id: "TaskStatus" });

const stepCount = z.int().nonnegative();

export const TaskProgress = z
  .strictObject({
    done: stepCount,
    counted: stepCount,
    skipped: stepCount,
    ignored: stepCount,
    total: stepCount,
    percent: z.int().min(0).max(100),
  })
  .register(contracts, { id: "TaskProgress" });

export const Task = z
  .strictObject({
    id: Id,
    account_id: Id,
    origin_device_id: Id,
    target_device_id: Id.nullable(),
    request_text: z.string().min(1),
    plan: z.array(Step),
    status: TaskStatus,
    progress: TaskProgress,
    result: z.string().nullable(),
    created_at: Timestamp,
    updated_at: Timestamp,
  })
  .superRefine((task, context) => {
    if (!sameProgress(task.progress, progressOf(task.plan.map((step) => step.status)))) {
      context.addIssue({ code: "custom", path: ["progress"], message: "Progress must be counted from the steps of the plan." });
    }
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
export type ScriptLanguage = z.infer<typeof ScriptLanguage>;
export type WaitAction = z.infer<typeof WaitAction>;
export type OpenAppAction = z.infer<typeof OpenAppAction>;
export type TypeTextAction = z.infer<typeof TypeTextAction>;
export type ClickAction = z.infer<typeof ClickAction>;
export type RunScriptAction = z.infer<typeof RunScriptAction>;
export type TakeScreenshotAction = z.infer<typeof TakeScreenshotAction>;
export type CallConnectorAction = z.infer<typeof CallConnectorAction>;
export type ActionSpec = z.infer<typeof ActionSpec>;
export type Effect = z.infer<typeof Effect>;
export type DeviceTarget = z.infer<typeof DeviceTarget>;
export type ConnectorTarget = z.infer<typeof ConnectorTarget>;
export type StepTarget = z.infer<typeof StepTarget>;
export type FailurePolicy = z.infer<typeof FailurePolicy>;
export type StepStatus = z.infer<typeof StepStatus>;
export type SetAsideReason = z.infer<typeof SetAsideReason>;
export type StepTemplate = z.infer<typeof StepTemplate>;
export type Step = z.infer<typeof Step>;
export type TaskStatus = z.infer<typeof TaskStatus>;
export type TaskProgress = z.infer<typeof TaskProgress>;
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
