import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connect, developmentAccount, seedDevelopment } from "../src/index.ts";
import { createTestDatabase, type TestDatabase } from "../src/testing.ts";

let database: TestDatabase;
let owner: Sql;
let app: Sql;

beforeAll(async () => {
  database = await createTestDatabase();
  owner = connect(database.migratorUrl, { max: 1 });
  app = connect(database.appUrl, { max: 1 });
  await seedDevelopment(owner);
});

afterAll(async () => {
  await Promise.all([owner?.end(), app?.end()]);
  await database?.drop();
});

describe("audit log is append-only, enforced by the database", () => {
  it("lets the app add an audit record", async () => {
    const [row] = await app`
      insert into audit_log (account_id, actor, action) values (${developmentAccount.id}, 'system', 'test.appended')
      returning id
    `;
    expect(row?.["id"]).toBeDefined();
  });

  it.each([
    ["update", "update audit_log set action = 'test.changed'"],
    ["delete", "delete from audit_log"],
    ["truncate", "truncate audit_log"],
  ])("refuses %s from the app role", async (_, statement) => {
    await expect(app.unsafe(statement)).rejects.toMatchObject({ code: "42501" });
  });

  it.each([
    ["update", "update audit_log set action = 'test.changed'"],
    ["delete", "delete from audit_log"],
    ["truncate", "truncate audit_log"],
  ])("refuses %s even from the table owner", async (_, statement) => {
    await expect(owner.unsafe(statement)).rejects.toMatchObject({ code: "23001" });
  });

  it("keeps every record after the refused attempts", async () => {
    const [row] = await owner`select count(*)::int as total from audit_log`;
    expect(row?.["total"]).toBe(2);
  });

  it("does not let the app role change accounts", async () => {
    await expect(app`update accounts set name = 'changed'`).rejects.toMatchObject({ code: "42501" });
  });
});
