import { databaseUrls } from "@venom/db";
import { z } from "zod";

const Environment = z.object({
  VENOM_GATEWAY_HOST: z.string().min(1).default("127.0.0.1"),
  VENOM_GATEWAY_PORT: z.coerce.number().int().min(1).max(65_535).default(4100),
  VENOM_LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
});

export interface GatewayConfig {
  readonly host: string;
  readonly port: number;
  readonly logLevel: z.infer<typeof Environment>["VENOM_LOG_LEVEL"];
  readonly databaseUrl: string;
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): GatewayConfig {
  const parsed = Environment.parse(environment);
  return {
    host: parsed.VENOM_GATEWAY_HOST,
    port: parsed.VENOM_GATEWAY_PORT,
    logLevel: parsed.VENOM_LOG_LEVEL,
    databaseUrl: databaseUrls.app,
  };
}
