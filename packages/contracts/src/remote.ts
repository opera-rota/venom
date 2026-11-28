import { z } from "zod";
import { Id } from "./primitives.ts";
import { contracts } from "./registry.ts";
import { ScreenKey, screenLimits } from "./screen.ts";

const share = z.number().min(0).max(1);

export const RemoteSpot = z
  .strictObject({ x: share, y: share })
  .register(contracts, { id: "RemoteSpot" });

export const RemoteClick = z
  .strictObject({ kind: z.literal("click"), spot: RemoteSpot })
  .register(contracts, { id: "RemoteClick" });

export const RemoteDouble = z
  .strictObject({ kind: z.literal("double"), spot: RemoteSpot })
  .register(contracts, { id: "RemoteDouble" });

export const RemoteRight = z
  .strictObject({ kind: z.literal("right"), spot: RemoteSpot })
  .register(contracts, { id: "RemoteRight" });

export const RemoteScroll = z
  .strictObject({
    kind: z.literal("scroll"),
    spot: RemoteSpot,
    direction: z.enum(["up", "down"]),
    steps: z.int().min(1).max(screenLimits.scrollSteps),
  })
  .register(contracts, { id: "RemoteScroll" });

export const RemoteKey = z
  .strictObject({ kind: z.literal("key"), key: ScreenKey })
  .register(contracts, { id: "RemoteKey" });

export const RemoteType = z
  .strictObject({ kind: z.literal("type"), text: z.string().min(1).max(screenLimits.typedText) })
  .register(contracts, { id: "RemoteType" });

export const RemoteAction = z
  .discriminatedUnion("kind", [RemoteClick, RemoteDouble, RemoteRight, RemoteScroll, RemoteKey, RemoteType])
  .register(contracts, { id: "RemoteAction" });

export const SendRemote = z
  .strictObject({ device_id: Id, action: RemoteAction })
  .register(contracts, { id: "SendRemote" });

export const RemoteSession = z
  .strictObject({ device_id: Id, on: z.boolean() })
  .register(contracts, { id: "RemoteSession" });

export type RemoteSpot = z.infer<typeof RemoteSpot>;
export type RemoteAction = z.infer<typeof RemoteAction>;
export type SendRemote = z.infer<typeof SendRemote>;
export type RemoteSession = z.infer<typeof RemoteSession>;
