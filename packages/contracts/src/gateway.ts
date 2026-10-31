import { z } from "zod";
import { PowerStatus } from "./power.ts";
import { Id, Timestamp } from "./primitives.ts";
import { Device, Message } from "./records.ts";
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

export const MessageHistory = z
  .strictObject({
    messages: z.array(Message),
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

export const GatewayEvent = z
  .discriminatedUnion("type", [MessageEvent, AnswerEvent, RequestEvent, DevicesEvent, PowerEvent])
  .register(contracts, { id: "GatewayEvent" });

export type MessageText = z.infer<typeof MessageText>;
export type SendMessage = z.infer<typeof SendMessage>;
export type SendMessageAccepted = z.infer<typeof SendMessageAccepted>;
export type RetryAnswer = z.infer<typeof RetryAnswer>;
export type MessageHistory = z.infer<typeof MessageHistory>;
export type RequestState = z.infer<typeof RequestState>;
export type MessageEvent = z.infer<typeof MessageEvent>;
export type RequestEvent = z.infer<typeof RequestEvent>;
export type AnswerEvent = z.infer<typeof AnswerEvent>;
export type DevicesEvent = z.infer<typeof DevicesEvent>;
export type PowerEvent = z.infer<typeof PowerEvent>;
export type GatewayEvent = z.infer<typeof GatewayEvent>;
