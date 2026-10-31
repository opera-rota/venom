import { homedir } from "node:os";
import { join } from "node:path";
import { databaseUrls } from "@venom/db";
import { z } from "zod";

const Environment = z.object({
  VENOM_GATEWAY_HOST: z.string().min(1).default("127.0.0.1"),
  VENOM_GATEWAY_PORT: z.coerce.number().int().min(1).max(65_535).default(4100),
  VENOM_LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  VENOM_SMTP_URL: z.url().default("smtp://127.0.0.1:2525"),
  VENOM_MAIL_FROM: z.string().min(3).default("VENOM <no-reply@venom.local>"),
  VENOM_BRAIN_URL: z.url().default("http://127.0.0.1:4200"),
  VENOM_FREE_DAILY_ANSWERS: z.coerce.number().int().min(0).max(10_000).default(30),
  VENOM_IDENTITY_KEY_FILE: z.string().min(1).default(join(homedir(), ".venom", "identity-server-setup")),
  VENOM_COMMAND_KEY_FILE: z.string().min(1).default(join(homedir(), ".venom", "command-key")),
});

export interface GatewayConfig {
  readonly host: string;
  readonly port: number;
  readonly logLevel: z.infer<typeof Environment>["VENOM_LOG_LEVEL"];
  readonly databaseUrl: string;
  readonly smtpUrl: string;
  readonly mailFrom: string;
  readonly identityKeyFile: string;
  readonly commandKeyFile: string;
  readonly brainUrl: string;
  readonly freeDailyAnswers: number;
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): GatewayConfig {
  const parsed = Environment.parse(environment);
  return {
    host: parsed.VENOM_GATEWAY_HOST,
    port: parsed.VENOM_GATEWAY_PORT,
    logLevel: parsed.VENOM_LOG_LEVEL,
    databaseUrl: databaseUrls.app,
    smtpUrl: parsed.VENOM_SMTP_URL,
    mailFrom: parsed.VENOM_MAIL_FROM,
    identityKeyFile: parsed.VENOM_IDENTITY_KEY_FILE,
    commandKeyFile: parsed.VENOM_COMMAND_KEY_FILE,
    brainUrl: parsed.VENOM_BRAIN_URL,
    freeDailyAnswers: parsed.VENOM_FREE_DAILY_ANSWERS,
  };
}
