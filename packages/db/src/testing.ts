import { randomBytes } from "node:crypto";
import { migrate } from "./migrator.ts";
import { connect } from "./store.ts";
import { databaseUrls, withDatabase } from "./urls.ts";

export interface TestDatabase {
  readonly name: string;
  readonly migratorUrl: string;
  readonly appUrl: string;
  drop(): Promise<void>;
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const name = `venom_test_${randomBytes(6).toString("hex")}`;
  const admin = connect(withDatabase(databaseUrls.migrator, "postgres"), { max: 1 });
  await admin.unsafe(`create database ${name}`);

  const migratorUrl = withDatabase(databaseUrls.migrator, name);
  const appUrl = withDatabase(databaseUrls.app, name);
  const migrator = connect(migratorUrl, { max: 1 });
  await migrate(migrator);
  await migrator.end();

  return {
    name,
    migratorUrl,
    appUrl,
    async drop() {
      await admin.unsafe(`drop database if exists ${name} with (force)`);
      await admin.end();
    },
  };
}
