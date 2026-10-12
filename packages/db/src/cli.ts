import type { Sql } from "postgres";
import { seedDevelopment } from "./development.ts";
import { migrate, migrationStatus } from "./migrator.ts";
import { connect } from "./store.ts";
import { databaseUrls } from "./urls.ts";

async function runMigrations(sql: Sql): Promise<void> {
  const applied = await migrate(sql);
  if (applied.length === 0) {
    console.log("Database is up to date.");
    return;
  }
  for (const migration of applied) {
    console.log(`applied ${migration.version} ${migration.name}`);
  }
}

async function showStatus(sql: Sql): Promise<void> {
  const { applied, pending } = await migrationStatus(sql);
  for (const migration of applied) {
    console.log(`applied  ${migration.version} ${migration.name}  ${migration.applied_at.toISOString()}`);
  }
  for (const migration of pending) {
    console.log(`pending  ${migration.version} ${migration.name}`);
  }
}

async function setUp(sql: Sql): Promise<void> {
  await runMigrations(sql);
  const created = await seedDevelopment(sql);
  console.log(created ? "Development account and device created." : "Development account and device already exist.");
}

const commands: Record<string, (sql: Sql) => Promise<void>> = {
  migrate: runMigrations,
  status: showStatus,
  setup: setUp,
};

const command = commands[process.argv[2] ?? ""];

if (command === undefined) {
  console.error(`Usage: node src/cli.ts <${Object.keys(commands).join(" | ")}>`);
  process.exit(2);
}

const sql = connect(databaseUrls.migrator, { max: 1 });

try {
  await command(sql);
} catch (error) {
  console.error(error instanceof Error ? `${error.name}: ${error.message}` : error);
  process.exitCode = 1;
} finally {
  await sql.end();
}
