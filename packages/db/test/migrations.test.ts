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
