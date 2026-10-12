import { Id } from "@venom/contracts";
import { z } from "zod";

const Environment = z.object({
  VENOM_GATEWAY_URL: z.url().default("http://127.0.0.1:4100"),
  VENOM_DEVICE_ID: Id.default("01a12a2d-0000-7000-8000-000000000002"),
});

export interface DesktopConfig {
  readonly gatewayUrl: string;
  readonly deviceId: string;
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): DesktopConfig {
  const parsed = Environment.parse(environment);
  return { gatewayUrl: parsed.VENOM_GATEWAY_URL, deviceId: parsed.VENOM_DEVICE_ID };
}
