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

describe("upgrading moves made before targets were recorded", () => {
  it("learns which button, box and window each old move used from its own words", async () => {
    const legacy = await createTestDatabase();
    const sql = connect(legacy.migratorUrl, { max: 1 });
    try {
      await sql.unsafe("alter table moves drop column target");
      await sql`delete from schema_migrations where version >= 15`;
      const [account] = await sql<{ id: string }[]>`insert into accounts (name, email) values ('Old owner', 'moves@venom.local') returning id`;
      const accountId = account?.id ?? "";
      const [device] = await sql<{ id: string }[]>`
        insert into devices (account_id, type, name, platform, capabilities, status)
        values (${accountId}, 'computer', 'Old computer', 'windows', '{}', 'active') returning id
      `;
      const [task] = await sql<{ id: string }[]>`
        insert into tasks (account_id, origin_device_id, target_device_id, request_text, kind, status)
        values (${accountId}, ${device?.id ?? null}, ${device?.id ?? null}, 'Add numbers', 'goal', 'completed') returning id
      `;
      const old = [
        [{ name: "click", mark: 7, point: null, double: false }, "Clicked mark 7 'Plus' in 'Calculator'."],
        [{ name: "click", mark: 2, point: null, double: true }, "Double-clicked mark 2 'Don't save' in 'Notepad'."],
        [{ name: "click", mark: null, point: { x: 3, y: 4 }, double: false }, "Clicked the point 3,4 in 'Calculator'."],
        [{ name: "type", text: "hi", mark: 3, enter: false }, "Typed 2 characters at the end of mark 3 'Search' and checked that it arrived."],
        [{ name: "key", key: "enter" }, "Pressed enter in 'Calculator'."],
        [{ name: "open", app: "Calculator", open: null }, "Opened Calculator."],
      ] as const;
      for (const [index, [move, detail]] of old.entries()) {
        await sql`
          insert into moves (task_id, account_id, number, intent, seen, move, status, detail, started_at, finished_at)
          values (${task?.id ?? null}, ${accountId}, ${index + 1}, 'A move.', 'The screen.', ${sql.json(move)}, 'done', ${detail}, clock_timestamp(), clock_timestamp())
        `;
      }
      expect((await migrate(sql)).map((migration) => migration.version)).toEqual([15]);
      const targets = await sql<{ target: unknown }[]>`select target from moves where task_id = ${task?.id ?? null} order by number`;
      expect(targets.map((row) => row.target)).toEqual([
        { kind: null, name: "Plus", window: "Calculator" },
        { kind: null, name: "Don't save", window: "Notepad" },
        null,
        { kind: null, name: "Search", window: null },
        { kind: null, name: null, window: "Calculator" },
        null,
      ]);
    } finally {
      await sql.end();
      await legacy.drop();
    }
  });
});

describe("upgrading a database that already holds Phase 2 data", () => {
  it("keeps old accounts, devices and messages when the identity migration runs", async () => {
    const legacy = await createTestDatabase();
    const sql = connect(legacy.migratorUrl, { max: 1 });
    try {
      await sql.unsafe("drop table howto_runs, howtos");
      await sql.unsafe("alter table devices drop column in_use, drop column locked");
      await sql.unsafe("drop table later_items");
      await sql.unsafe("alter table messages drop column document");
      await sql.unsafe("alter table messages drop column move_id");
      await sql.unsafe("drop table moves");
      await sql.unsafe("drop function moves_moves_allowed");
      await sql.unsafe("alter table tasks drop column kind");
      await sql.unsafe("alter table messages drop column kind, drop column step_id");
      await sql.unsafe("alter table messages drop column task_id");
      await sql.unsafe("alter table accounts drop column skip_asking");
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

      const [kept] = await sql<{ text: string; kind: string; credential_hash: Buffer | null }[]>`
        select m.text, m.kind, d.credential_hash from messages m join devices d on d.id = m.device_id
      `;
      expect(kept).toEqual({ text: "still here", kind: "text", credential_hash: null });
    } finally {
      await sql.end();
      await legacy.drop();
    }
  });
});
