import { z } from "zod";
import { PowerStatus } from "./power.ts";
import { Id, Timestamp } from "./primitives.ts";
import { Device, MemoryItem, Message } from "./records.ts";
import { contracts } from "./registry.ts";

export const MessageText = z
  .string()
  .min(1)
  .max(4000)
  .regex(/\S/)
  .register(contracts, { id: "MessageText" });

export const SendMessage = z
  .strictObject({
    text: MessageText,
  })
  .register(contracts, { id: "SendMessage" });

export const SendMessageAccepted = z
  .strictObject({
    request_id: Id,
  })
  .register(contracts, { id: "SendMessageAccepted" });

export const RetryAnswer = z
  .strictObject({
    request_id: Id,
  })
  .register(contracts, { id: "RetryAnswer" });

export const QuestionRef = z
  .strictObject({
    request_id: Id,
    message_id: Id,
  })
  .register(contracts, { id: "QuestionRef" });

export const PendingAnswer = z
  .strictObject({
    request_id: Id,
    question: QuestionRef,
    sequence: z.int().nonnegative(),
    text: z.string(),
    failure: z.string().min(1).nullable(),
  })
  .register(contracts, { id: "PendingAnswer" });

export const MessageHistory = z
  .strictObject({
    messages: z.array(Message),
    pending: z.array(PendingAnswer),
  })
  .register(contracts, { id: "MessageHistory" });

export const RequestState = z
  .enum(["accepted", "completed", "failed"])
  .register(contracts, { id: "RequestState" });

const eventFields = {
  request_id: Id,
  sequence: z.int().nonnegative(),
  emitted_at: Timestamp,
};

export const MessageEvent = z
  .strictObject({
    type: z.literal("message"),
    ...eventFields,
    message: Message,
  })
  .register(contracts, { id: "MessageEvent" });

export const RequestEvent = z
  .strictObject({
    type: z.literal("request"),
    ...eventFields,
    state: RequestState,
    detail: z.string().nullable(),
    question: QuestionRef.nullable(),
  })
  .register(contracts, { id: "RequestEvent" });

export const AnswerEvent = z
  .strictObject({
    type: z.literal("answer"),
    ...eventFields,
    delta: z.string().min(1),
  })
  .register(contracts, { id: "AnswerEvent" });

export const DevicesEvent = z
  .strictObject({
    type: z.literal("devices"),
    ...eventFields,
    devices: z.array(Device),
  })
  .register(contracts, { id: "DevicesEvent" });

export const PowerEvent = z
  .strictObject({
    type: z.literal("power"),
    ...eventFields,
    power: PowerStatus,
  })
  .register(contracts, { id: "PowerEvent" });

export const MemoryEvent = z
  .strictObject({
    type: z.literal("memory"),
    ...eventFields,
    item: MemoryItem,
  })
  .register(contracts, { id: "MemoryEvent" });

export const ForgottenEvent = z
  .strictObject({
    type: z.literal("forgotten"),
    ...eventFields,
    item_id: Id,
    message_ids: z.array(Id),
  })
  .register(contracts, { id: "ForgottenEvent" });

export const GatewayEvent = z
  .discriminatedUnion("type", [MessageEvent, AnswerEvent, RequestEvent, DevicesEvent, PowerEvent, MemoryEvent, ForgottenEvent])
  .register(contracts, { id: "GatewayEvent" });

export type MessageText = z.infer<typeof MessageText>;
export type SendMessage = z.infer<typeof SendMessage>;
export type SendMessageAccepted = z.infer<typeof SendMessageAccepted>;
export type RetryAnswer = z.infer<typeof RetryAnswer>;
export type QuestionRef = z.infer<typeof QuestionRef>;
export type PendingAnswer = z.infer<typeof PendingAnswer>;
export type MessageHistory = z.infer<typeof MessageHistory>;
export type RequestState = z.infer<typeof RequestState>;
export type MessageEvent = z.infer<typeof MessageEvent>;
export type RequestEvent = z.infer<typeof RequestEvent>;
export type AnswerEvent = z.infer<typeof AnswerEvent>;
export type DevicesEvent = z.infer<typeof DevicesEvent>;
export type PowerEvent = z.infer<typeof PowerEvent>;
export type MemoryEvent = z.infer<typeof MemoryEvent>;
export type ForgottenEvent = z.infer<typeof ForgottenEvent>;
export type GatewayEvent = z.infer<typeof GatewayEvent>;
