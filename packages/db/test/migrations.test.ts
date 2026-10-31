import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connect, loadMigrations, migrate, MigrationError, migrationStatus } from "../src/index.ts";
import { createTestDatabase, type TestDatabase } from "../src/testing.ts";

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
});

afterAll(async () => {
  await database?.drop();
});

describe("versioned migrations", () => {
  it("applies every migration once and reports nothing pending", async () => {
    const sql = connect(database.migratorUrl, { max: 1 });
    expect(await migrate(sql)).toEqual([]);
    const status = await migrationStatus(sql);
    expect(status.applied.map((row) => row.version)).toEqual(loadMigrations().map((m) => m.version));
    expect(status.pending).toEqual([]);
    await sql.end();
  });

  it("ignores Windows line endings when comparing checksums", () => {
    const folder = mkdtempSync(join(tmpdir(), "venom-migrations-"));
    writeFileSync(join(folder, "0001_example.sql"), "select 1;\r\nselect 2;\r\n");
    const [crlf] = loadMigrations(folder);
    writeFileSync(join(folder, "0001_example.sql"), "select 1;\nselect 2;\n");
    const [lf] = loadMigrations(folder);
    expect(crlf?.checksum).toBe(lf?.checksum);
  });

  it("refuses to run when an applied migration was edited", async () => {
    const sql = connect(database.migratorUrl, { max: 1 });
    const edited = loadMigrations().map((m) => (m.version === 1 ? { ...m, checksum: "edited" } : m));
    await expect(migrate(sql, edited)).rejects.toBeInstanceOf(MigrationError);
    await sql.end();
  });

  it("refuses gaps in migration numbers", () => {
    const folder = mkdtempSync(join(tmpdir(), "venom-migrations-"));
    writeFileSync(join(folder, "0001_first.sql"), "select 1;");
    writeFileSync(join(folder, "0003_third.sql"), "select 3;");
    expect(() => loadMigrations(folder)).toThrow(MigrationError);
  });
});

describe("upgrading a database that already holds Phase 2 data", () => {
  it("keeps old accounts, devices and messages when the identity migration runs", async () => {
    const legacy = await createTestDatabase();
    const sql = connect(legacy.migratorUrl, { max: 1 });
    try {
      await sql.unsafe("drop table stops, steps, tasks, live_challenges");
      await sql.unsafe("drop function steps_moves_allowed, tasks_moves_allowed");
      await sql.unsafe("drop function steps_finished_work_stays");
      await sql.unsafe("drop trigger devices_key_once on devices");
      await sql.unsafe("drop function devices_key_enrolled_once");
      await sql.unsafe("alter table devices drop column public_key, drop column key_enrolled_at");
      await sql.unsafe("drop table memories");
      await sql.unsafe("drop function memories_within_limit, forget_memory");
      await sql.unsafe("drop extension vector");
      await sql.unsafe("drop table engine_choices, power_ledger");
      await sql.unsafe("drop function power_ledger_refuse_change");
      await sql.unsafe("drop table account_secrets, signups, attach_attempts");
      await sql.unsafe("alter table devices drop column credential_hash, drop column revoked_at");
      await sql.unsafe("alter table accounts drop column email_verified_at");
      await sql`delete from schema_migrations where version > 1`;

      const [account] = await sql<{ id: string }[]>`
        insert into accounts (name, email) values ('Old owner', 'old@venom.local') returning id
      `;
      const [device] = await sql<{ id: string }[]>`
        insert into devices (account_id, type, name, platform, capabilities, status)
        values (${account?.id ?? null}, 'computer', 'Old computer', 'windows', '{}', 'active')
        returning id
      `;
      await sql`
        insert into messages (account_id, device_id, request_id, speaker, text)
        values (${account?.id ?? null}, ${device?.id ?? null}, uuidv7(), 'user', 'still here')
      `;

      const applied = await migrate(sql);
      expect(applied.map((migration) => migration.name)).toEqual(loadMigrations().slice(1).map((m) => m.name));

      const [kept] = await sql<{ text: string; credential_hash: Buffer | null }[]>`
        select m.text, d.credential_hash from messages m join devices d on d.id = m.device_id
      `;
      expect(kept).toEqual({ text: "still here", credential_hash: null });
    } finally {
      await sql.end();
      await legacy.drop();
    }
  });
});
