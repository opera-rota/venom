import { z } from "zod";

const Environment = z.object({
  VENOM_GATEWAY_URL: z.url().default("http://127.0.0.1:4100"),
});

const Profile = z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/);

export interface DesktopConfig {
  readonly gatewayUrl: string;
  readonly profile: string | null;
}

export function readProfile(argv: readonly string[]): string | null {
  const value = argv.find((argument) => argument.startsWith("--profile="))?.slice("--profile=".length);
  if (value === undefined) {
    return null;
  }
  const profile = Profile.safeParse(value);
  if (!profile.success) {
    throw new Error("A profile name may use lowercase letters, numbers and dashes, up to 32 characters.");
  }
  return profile.data;
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env, argv: readonly string[] = process.argv): DesktopConfig {
  const parsed = Environment.parse(environment);
  return { gatewayUrl: parsed.VENOM_GATEWAY_URL, profile: readProfile(argv) };
}
