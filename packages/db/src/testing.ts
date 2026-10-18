import { randomBytes } from "node:crypto";
import type { Sql } from "postgres";
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

export interface TestAccount {
  readonly accountId: string;
  readonly deviceId: string;
  readonly email: string;
}

export async function insertAccountWithDevice(sql: Sql): Promise<TestAccount> {
  const email = `owner-${randomBytes(4).toString("hex")}@venom.test`;
  return sql.begin(async (tx) => {
    const [account] = await tx<{ id: string }[]>`
      insert into accounts (name, email, email_verified_at) values ('Test owner', ${email}, clock_timestamp()) returning id
    `;
    if (account === undefined) {
      throw new Error("Account insert returned no row");
    }
    const [device] = await tx<{ id: string }[]>`
      insert into devices (account_id, type, name, platform, capabilities, credential_hash)
      values (
        ${account.id}, 'computer', 'Test computer', 'linux',
        ${tx.json({ screen_control: false, microphone: false, speaker: false, shortcuts: false, notifications: false, network: true })},
        ${randomBytes(32)}
      )
      returning id
    `;
    if (device === undefined) {
      throw new Error("Device insert returned no row");
    }
    return { accountId: account.id, deviceId: device.id, email };
  });
}
