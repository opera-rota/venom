import { z } from "zod";
import { Id, Timestamp } from "./primitives.ts";
import { Message } from "./records.ts";
import { contracts } from "./registry.ts";

export const MessageText = z
  .string()
  .min(1)
  .max(4000)
  .regex(/\S/)
  .register(contracts, { id: "MessageText" });

export const SendMessage = z
  .strictObject({
    device_id: Id,
    text: MessageText,
  })
  .register(contracts, { id: "SendMessage" });

export const SendMessageAccepted = z
  .strictObject({
    request_id: Id,
  })
  .register(contracts, { id: "SendMessageAccepted" });

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

export const GatewayEvent = z
  .discriminatedUnion("type", [MessageEvent, RequestEvent])
  .register(contracts, { id: "GatewayEvent" });

export type MessageText = z.infer<typeof MessageText>;
export type SendMessage = z.infer<typeof SendMessage>;
export type SendMessageAccepted = z.infer<typeof SendMessageAccepted>;
export type MessageHistory = z.infer<typeof MessageHistory>;
export type RequestState = z.infer<typeof RequestState>;
export type MessageEvent = z.infer<typeof MessageEvent>;
export type RequestEvent = z.infer<typeof RequestEvent>;
export type GatewayEvent = z.infer<typeof GatewayEvent>;
