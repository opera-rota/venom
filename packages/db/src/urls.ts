export const databaseUrls = {
  migrator: process.env["VENOM_MIGRATOR_URL"] ?? "postgres://venom:venom@127.0.0.1:55432/venom",
  app: process.env["VENOM_DATABASE_URL"] ?? "postgres://venom_app:venom_app@127.0.0.1:55432/venom",
} as const;

export function withDatabase(url: string, database: string): string {
  const next = new URL(url);
  next.pathname = `/${database}`;
  return next.toString();
}
