import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Sql } from "postgres";

export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
  readonly checksum: string;
}

export interface AppliedMigration {
  readonly version: number;
  readonly name: string;
  readonly checksum: string;
  readonly applied_at: Date;
}

export interface MigrationStatus {
  readonly applied: readonly AppliedMigration[];
  readonly pending: readonly Migration[];
}

export class MigrationError extends Error {
  override readonly name = "MigrationError";
}

const fileName = /^(\d{4})_([a-z0-9_]+)\.sql$/;
const lockKey = 7_365_901;

export const migrationsDirectory = join(import.meta.dirname, "..", "migrations");

export function loadMigrations(directory: string = migrationsDirectory): Migration[] {
  const migrations = readdirSync(directory)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => {
      const match = fileName.exec(file);
      if (match?.[1] === undefined || match[2] === undefined) {
        throw new MigrationError(`Migration file name must look like 0001_name.sql: ${file}`);
      }
      const sql = readFileSync(join(directory, file), "utf8").replaceAll("\r\n", "\n");
      return {
        version: Number(match[1]),
        name: match[2],
        sql,
        checksum: createHash("sha256").update(sql).digest("hex"),
      };
    });

  migrations.forEach((migration, index) => {
    if (migration.version !== index + 1) {
      throw new MigrationError(`Migration versions must run 1, 2, 3 without gaps; found ${migration.version} at position ${index + 1}`);
    }
  });

  return migrations;
}

async function ensureLedger(sql: Sql): Promise<void> {
  await sql`
    create table if not exists schema_migrations (
      version integer primary key,
      name text not null,
      checksum text not null,
      applied_at timestamptz not null default clock_timestamp()
    )
  `;
}

function verify(applied: readonly AppliedMigration[], migrations: readonly Migration[]): Migration[] {
  const known = new Map(migrations.map((migration) => [migration.version, migration]));

  for (const row of applied) {
    const migration = known.get(row.version);
    if (migration === undefined) {
      throw new MigrationError(`Database has migration ${row.version} (${row.name}) that is missing from the migrations folder`);
    }
    if (migration.checksum !== row.checksum) {
      throw new MigrationError(`Migration ${row.version} (${row.name}) was edited after it was applied; add a new migration instead`);
    }
  }

  const appliedVersions = new Set(applied.map((row) => row.version));
  return migrations.filter((migration) => !appliedVersions.has(migration.version));
}

export async function migrationStatus(sql: Sql, migrations: readonly Migration[] = loadMigrations()): Promise<MigrationStatus> {
  await ensureLedger(sql);
  const applied = await sql<AppliedMigration[]>`
    select version, name, checksum, applied_at from schema_migrations order by version
  `;
  return { applied, pending: verify(applied, migrations) };
}

export async function migrate(sql: Sql, migrations: readonly Migration[] = loadMigrations()): Promise<Migration[]> {
  await ensureLedger(sql);

  return sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(${lockKey})`;
    const applied = await tx<AppliedMigration[]>`
      select version, name, checksum, applied_at from schema_migrations order by version
    `;
    const pending = verify(applied, migrations);

    for (const migration of pending) {
      await tx.unsafe(migration.sql);
      await tx`
        insert into schema_migrations (version, name, checksum)
        values (${migration.version}, ${migration.name}, ${migration.checksum})
      `;
    }

    return pending;
  });
}
