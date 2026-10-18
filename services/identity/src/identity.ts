import * as opaque from "@serenity-kit/opaque";
import {
  AttachChallenge,
  AttachProven,
  DeviceSession,
  DeviceToken,
  SecretWordRegistrationResponse,
  Session,
  SignupStarted,
  type AttachConfirm,
  type AttachProve,
  type AttachStart,
  type Capabilities,
  type Device,
  type DeviceInfo,
  type SecretWordRegistration,
  type SignupFinish,
  type SignupStart,
  type SignupVerify,
} from "@venom/contracts";
import type { DeviceRef } from "@venom/db";
import type { Sql, TransactionSql } from "postgres";
import { v7 as uuidv7 } from "uuid";
import { IdentityError, refuse } from "./errors.ts";
import { mailTemplates, type Mailer } from "./mailer.ts";
import { toAccount, toDevice, type AccountRow, type DeviceRow } from "./rows.ts";
import {
  codeDigest,
  decodeOpaque,
  digest,
  encodeOpaque,
  newDeviceToken,
  newVerificationCode,
  sameDigest,
  tokenDigest,
} from "./secrets.ts";

export interface IdentityLimits {
  readonly codeLifetime: string;
  readonly loginLifetime: string;
  readonly attemptWindow: string;
  readonly signupsPerWindow: number;
  readonly attachesPerWindow: number;
  readonly codeAttempts: number;
  readonly devicesPerAccount: number;
}

export const defaultLimits: IdentityLimits = {
  codeLifetime: "10 minutes",
  loginLifetime: "5 minutes",
  attemptWindow: "15 minutes",
  signupsPerWindow: 3,
  attachesPerWindow: 5,
  codeAttempts: 5,
  devicesPerAccount: 20,
};

export interface IdentityOptions {
  readonly sql: Sql;
  readonly mailer: Mailer;
  readonly serverSetup: string;
  readonly limits?: Partial<IdentityLimits>;
}

export interface Identity {
  startSignup(input: SignupStart): Promise<SignupStarted>;
  verifySignup(input: SignupVerify): Promise<void>;
  registerSecretWord(input: SecretWordRegistration): Promise<SecretWordRegistrationResponse>;
  finishSignup(input: SignupFinish, requestId: string): Promise<DeviceSession>;
  startAttach(input: AttachStart): Promise<AttachChallenge>;
  proveAttach(input: AttachProve, requestId: string): Promise<AttachProven>;
  confirmAttach(input: AttachConfirm, requestId: string): Promise<DeviceSession>;
  authenticate(token: string): Promise<DeviceRef | null>;
  session(device: DeviceRef): Promise<Session>;
  devices(accountId: string): Promise<Device[]>;
  reportCapabilities(device: DeviceRef, capabilities: Capabilities, requestId: string): Promise<Device>;
  markPresence(device: DeviceRef, online: boolean): Promise<void>;
  resetPresence(): Promise<number>;
  revokeDevice(actor: DeviceRef, deviceId: string, requestId: string): Promise<Device>;
}

interface SignupRow {
  readonly id: string;
  readonly account_id: string;
  readonly name: string;
  readonly email: string;
  readonly code_hash: Buffer;
  readonly code_attempts: number;
  readonly verified_at: Date | null;
}

interface AttachRow {
  readonly id: string;
  readonly account_id: string | null;
  readonly login_state: Buffer | null;
  readonly code_hash: Buffer | null;
  readonly code_attempts: number;
}

type Outcome<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: IdentityError };

const ok = <T>(value: T): Outcome<T> => ({ ok: true, value });
const fail = (error: IdentityError): Outcome<never> => ({ ok: false, error });

function settle<T>(outcome: Outcome<T>): T {
  if (!outcome.ok) {
    throw outcome.error;
  }
  return outcome.value;
}

function decoyIdentifier(email: string): string {
  return digest(`venom.decoy:${email.toLowerCase()}`).toString("hex");
}

function opaqueCall<T>(call: () => T): T {
  try {
    return call();
  } catch {
    throw refuse.malformed();
  }
}

function provesSecretWord(loginState: Buffer, proof: string): boolean {
  try {
    opaque.server.finishLogin({ serverLoginState: encodeOpaque(loginState), finishLoginRequest: proof });
    return true;
  } catch {
    return false;
  }
}

function registrationRecordBytes(record: string): Buffer {
  const bytes = decodeOpaque(record);
  if (bytes.length < 64 || bytes.length > 1024) {
    throw refuse.malformed();
  }
  return bytes;
}

export function createIdentity({ sql, mailer, serverSetup, limits: overrides = {} }: IdentityOptions): Identity {
  const limits: IdentityLimits = { ...defaultLimits, ...overrides };

  async function deliver(to: string, message: { subject: string; text: string }): Promise<void> {
    try {
      await mailer.send({ to, ...message });
    } catch {
      throw refuse.mailUnavailable();
    }
  }

  async function audit(
    tx: TransactionSql,
    entry: { accountId: string | null; deviceId: string | null; requestId: string | null; actor: "user" | "system"; action: string; subjectId: string | null; detail?: Record<string, string | number | boolean> },
  ): Promise<void> {
    await tx`
      insert into audit_log (account_id, device_id, request_id, actor, action, subject_id, detail)
      values (
        ${entry.accountId}, ${entry.deviceId}, ${entry.requestId}, ${entry.actor}, ${entry.action},
        ${entry.subjectId}, ${tx.json(entry.detail ?? {})}
      )
    `;
  }

  async function insertDevice(tx: TransactionSql, accountId: string, device: DeviceInfo, token: string): Promise<DeviceRow> {
    const [row] = await tx<DeviceRow[]>`
      insert into devices (account_id, type, name, platform, capabilities, credential_hash)
      values (${accountId}, ${device.type}, ${device.name}, ${device.platform}, ${tx.json(device.capabilities)}, ${tokenDigest(token)})
      returning id, account_id, type, name, platform, capabilities, status, last_seen_at
    `;
    if (row === undefined) {
      throw new Error("Device insert returned no row");
    }
    return row;
  }

  async function loadAccount(tx: Sql | TransactionSql, accountId: string): Promise<AccountRow> {
    const [row] = await tx<AccountRow[]>`
      select id, name, email, listening_mode, confirmation_strictness, created_at from accounts where id = ${accountId}
    `;
    if (row === undefined) {
      throw new Error(`Account ${accountId} is missing`);
    }
    return row;
  }

  function checkCode(id: string, expected: Buffer | null, attempts: number, code: string): IdentityError | null {
    if (attempts >= limits.codeAttempts) {
      return refuse.tooManyAttempts();
    }
    if (expected === null || !sameDigest(expected, codeDigest(id, code))) {
      return refuse.codeIncorrect(limits.codeAttempts - attempts - 1);
    }
    return null;
  }

  async function activeSignup(tx: TransactionSql, signupId: string): Promise<SignupRow> {
    const [row] = await tx<SignupRow[]>`
      select id, account_id, name, email, code_hash, code_attempts, verified_at
      from signups
      where id = ${signupId} and completed_at is null and expires_at > clock_timestamp()
      for update
    `;
    if (row === undefined) {
      throw refuse.expired();
    }
    return row;
  }

  async function verifiedSignup(tx: TransactionSql, signupId: string): Promise<SignupRow & { verified_at: Date }> {
    const row = await activeSignup(tx, signupId);
    if (row.verified_at === null) {
      throw refuse.emailNotVerified();
    }
    return { ...row, verified_at: row.verified_at };
  }

  return {
    async startSignup({ name, email }) {
      const id = uuidv7();
      const code = newVerificationCode();

      const started = await sql.begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(hashtextextended(lower(${email}), 1))`;
        const [recent] = await tx<{ total: number }[]>`
          select count(*)::int as total from signups
          where lower(email) = lower(${email}) and created_at > clock_timestamp() - ${limits.attemptWindow}::interval
        `;
        if ((recent?.total ?? 0) >= limits.signupsPerWindow) {
          return fail(refuse.tooManyAttempts());
        }
        const [row] = await tx<{ expires_at: Date }[]>`
          insert into signups (id, name, email, code_hash, expires_at)
          values (${id}, ${name}, ${email}, ${codeDigest(id, code)}, clock_timestamp() + ${limits.codeLifetime}::interval)
          returning expires_at
        `;
        return ok(row?.expires_at ?? new Date());
      });

      const expiresAt = settle(started);
      await deliver(email, mailTemplates.signupCode(name, code));
      return SignupStarted.parse({ signup_id: id, expires_at: expiresAt.toISOString() });
    },

    async verifySignup({ signup_id, code }) {
      const outcome = await sql.begin(async (tx) => {
        const row = await activeSignup(tx, signup_id);
        if (row.verified_at !== null) {
          return ok(undefined);
        }
        const wrong = checkCode(row.id, row.code_hash, row.code_attempts, code);
        if (wrong !== null) {
          await tx`update signups set code_attempts = least(code_attempts + 1, ${limits.codeAttempts}) where id = ${row.id}`;
          return fail(wrong);
        }
        const [taken] = await tx`select 1 from accounts where lower(email) = lower(${row.email})`;
        if (taken !== undefined) {
          return fail(refuse.accountExists());
        }
        await tx`update signups set verified_at = clock_timestamp() where id = ${row.id}`;
        return ok(undefined);
      });
      settle(outcome);
    },

    async registerSecretWord({ signup_id, registration_request }) {
      const accountId = await sql.begin(async (tx) => (await verifiedSignup(tx, signup_id)).account_id);
      const { registrationResponse } = opaqueCall(() =>
        opaque.server.createRegistrationResponse({ serverSetup, userIdentifier: accountId, registrationRequest: registration_request }),
      );
      return SecretWordRegistrationResponse.parse({ registration_response: registrationResponse });
    },

    async finishSignup({ signup_id, registration_record, device }, requestId) {
      const record = registrationRecordBytes(registration_record);
      const token = newDeviceToken();

      const created = await sql.begin(async (tx) => {
        const signup = await verifiedSignup(tx, signup_id);
        const [taken] = await tx`select 1 from accounts where lower(email) = lower(${signup.email})`;
        if (taken !== undefined) {
          return fail(refuse.accountExists());
        }
        const [account] = await tx<AccountRow[]>`
          insert into accounts (id, name, email, email_verified_at)
          values (${signup.account_id}, ${signup.name}, ${signup.email}, ${signup.verified_at})
          returning id, name, email, listening_mode, confirmation_strictness, created_at
        `;
        if (account === undefined) {
          throw new Error("Account insert returned no row");
        }
        await tx`insert into account_secrets (account_id, opaque_record) values (${account.id}, ${record})`;
        const deviceRow = await insertDevice(tx, account.id, device, token);
        await tx`update signups set completed_at = clock_timestamp() where id = ${signup.id}`;
        await audit(tx, { accountId: account.id, deviceId: null, requestId, actor: "user", action: "account.created", subjectId: account.id });
        await audit(tx, {
          accountId: account.id,
          deviceId: deviceRow.id,
          requestId,
          actor: "user",
          action: "device.attached",
          subjectId: deviceRow.id,
          detail: { method: "account_created", type: device.type, platform: device.platform },
        });
        return ok({ account, device: deviceRow });
      });

      const { account, device: deviceRow } = settle(created);
      return DeviceSession.parse({ account: toAccount(account), device: toDevice(deviceRow), device_token: token });
    },

    async startAttach({ email, start_login_request }) {
      const id = uuidv7();

      const outcome = await sql.begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(hashtextextended(lower(${email}), 2))`;
        const [recent] = await tx<{ total: number }[]>`
          select count(*)::int as total from attach_attempts
          where lower(email) = lower(${email})
            and proven_at is null
            and created_at > clock_timestamp() - ${limits.attemptWindow}::interval
        `;
        if ((recent?.total ?? 0) >= limits.attachesPerWindow) {
          return fail(refuse.tooManyAttempts());
        }

        const [secret] = await tx<{ account_id: string; opaque_record: Buffer }[]>`
          select s.account_id, s.opaque_record
          from accounts a join account_secrets s on s.account_id = a.id
          where lower(a.email) = lower(${email})
        `;

        const { serverLoginState, loginResponse } = opaqueCall(() =>
          opaque.server.startLogin({
            serverSetup,
            userIdentifier: secret?.account_id ?? decoyIdentifier(email),
            registrationRecord: secret === undefined ? null : encodeOpaque(secret.opaque_record),
            startLoginRequest: start_login_request,
          }),
        );

        const [row] = await tx<{ expires_at: Date }[]>`
          insert into attach_attempts (id, email, account_id, login_state, expires_at)
          values (
            ${id}, ${email}, ${secret?.account_id ?? null}, ${decodeOpaque(serverLoginState)},
            clock_timestamp() + ${limits.loginLifetime}::interval
          )
          returning expires_at
        `;
        return ok({ loginResponse, expiresAt: row?.expires_at ?? new Date() });
      });

      const { loginResponse, expiresAt } = settle(outcome);
      return AttachChallenge.parse({ attach_id: id, login_response: loginResponse, expires_at: expiresAt.toISOString() });
    },

    async proveAttach({ attach_id, secret_word_proof }, requestId) {
      const code = newVerificationCode();

      const outcome = await sql.begin(async (tx) => {
        const [row] = await tx<AttachRow[]>`
          select id, account_id, login_state, code_hash, code_attempts
          from attach_attempts
          where id = ${attach_id}
            and proven_at is null
            and login_state is not null
            and expires_at > clock_timestamp()
          for update
        `;
        if (row?.login_state == null) {
          return fail(refuse.expired());
        }

        await tx`update attach_attempts set login_state = null where id = ${row.id}`;

        if (row.account_id === null || !provesSecretWord(row.login_state, secret_word_proof)) {
          if (row.account_id !== null) {
            await audit(tx, {
              accountId: row.account_id,
              deviceId: null,
              requestId,
              actor: "system",
              action: "device.attach_refused",
              subjectId: row.id,
              detail: { reason: "secret_word_incorrect" },
            });
          }
          return fail(refuse.secretWordIncorrect());
        }

        const [updated] = await tx<{ expires_at: Date }[]>`
          update attach_attempts
          set proven_at = clock_timestamp(),
              code_hash = ${codeDigest(row.id, code)},
              code_attempts = 0,
              expires_at = clock_timestamp() + ${limits.codeLifetime}::interval
          where id = ${row.id}
          returning expires_at
        `;
        const account = await loadAccount(tx, row.account_id);
        return ok({ account, expiresAt: updated?.expires_at ?? new Date() });
      });

      const { account, expiresAt } = settle(outcome);
      await deliver(account.email, mailTemplates.attachCode(account.name, code));
      return AttachProven.parse({ attach_id, expires_at: expiresAt.toISOString() });
    },

    async confirmAttach({ attach_id, code, device }, requestId) {
      const token = newDeviceToken();

      const outcome = await sql.begin(async (tx) => {
        const [row] = await tx<AttachRow[]>`
          select id, account_id, login_state, code_hash, code_attempts
          from attach_attempts
          where id = ${attach_id}
            and proven_at is not null
            and completed_at is null
            and expires_at > clock_timestamp()
          for update
        `;
        if (row?.account_id == null) {
          return fail(refuse.expired());
        }

        const wrong = checkCode(row.id, row.code_hash, row.code_attempts, code);
        if (wrong !== null) {
          await tx`update attach_attempts set code_attempts = least(code_attempts + 1, ${limits.codeAttempts}) where id = ${row.id}`;
          return fail(wrong);
        }

        await tx`select pg_advisory_xact_lock(hashtextextended(${row.account_id}::text, 3))`;
        const [count] = await tx<{ total: number }[]>`
          select count(*)::int as total from devices where account_id = ${row.account_id} and status <> 'revoked'
        `;
        if ((count?.total ?? 0) >= limits.devicesPerAccount) {
          return fail(refuse.deviceLimit(limits.devicesPerAccount));
        }

        const deviceRow = await insertDevice(tx, row.account_id, device, token);
        await tx`
          update attach_attempts set completed_at = clock_timestamp(), device_id = ${deviceRow.id} where id = ${row.id}
        `;
        await audit(tx, {
          accountId: row.account_id,
          deviceId: deviceRow.id,
          requestId,
          actor: "user",
          action: "device.attached",
          subjectId: deviceRow.id,
          detail: { method: "secret_word_and_email_code", type: device.type, platform: device.platform },
        });
        const account = await loadAccount(tx, row.account_id);
        return ok({ account, device: deviceRow });
      });

      const { account, device: deviceRow } = settle(outcome);
      return DeviceSession.parse({ account: toAccount(account), device: toDevice(deviceRow), device_token: token });
    },

    async authenticate(token) {
      if (!DeviceToken.safeParse(token).success) {
        return null;
      }
      const [device] = await sql<DeviceRef[]>`
        select id, account_id from devices where credential_hash = ${tokenDigest(token)} and status <> 'revoked'
      `;
      return device ?? null;
    },

    async session(device) {
      const [row] = await sql<DeviceRow[]>`
        select id, account_id, type, name, platform, capabilities, status, last_seen_at
        from devices where id = ${device.id} and account_id = ${device.account_id}
      `;
      if (row === undefined) {
        throw refuse.notFound();
      }
      return Session.parse({ account: toAccount(await loadAccount(sql, device.account_id)), device: toDevice(row) });
    },

    async devices(accountId) {
      const rows = await sql<DeviceRow[]>`
        select id, account_id, type, name, platform, capabilities, status, last_seen_at
        from devices
        where account_id = ${accountId} and status <> 'revoked' and credential_hash is not null
        order by created_at, id
      `;
      return rows.map(toDevice);
    },

    async reportCapabilities(device, capabilities, requestId) {
      return sql.begin(async (tx) => {
        const [row] = await tx<DeviceRow[]>`
          update devices set capabilities = ${tx.json(capabilities)}
          where id = ${device.id} and account_id = ${device.account_id} and status <> 'revoked'
          returning id, account_id, type, name, platform, capabilities, status, last_seen_at
        `;
        if (row === undefined) {
          throw refuse.notFound();
        }
        await audit(tx, {
          accountId: device.account_id,
          deviceId: device.id,
          requestId,
          actor: "system",
          action: "device.capabilities_reported",
          subjectId: device.id,
          detail: capabilities,
        });
        return toDevice(row);
      });
    },

    async markPresence(device, online) {
      await sql`
        update devices
        set status = ${online ? "active" : "offline"}, last_seen_at = clock_timestamp()
        where id = ${device.id} and account_id = ${device.account_id} and status <> 'revoked'
      `;
    },

    async resetPresence() {
      const result = await sql`update devices set status = 'offline' where status = 'active'`;
      return result.count;
    },

    async revokeDevice(actor, deviceId, requestId) {
      return sql.begin(async (tx) => {
        const [row] = await tx<DeviceRow[]>`
          update devices set status = 'revoked', revoked_at = clock_timestamp()
          where id = ${deviceId} and account_id = ${actor.account_id} and status <> 'revoked'
          returning id, account_id, type, name, platform, capabilities, status, last_seen_at
        `;
        if (row === undefined) {
          throw refuse.notFound();
        }
        await audit(tx, {
          accountId: actor.account_id,
          deviceId: actor.id,
          requestId,
          actor: "user",
          action: "device.revoked",
          subjectId: row.id,
          detail: { self: row.id === actor.id },
        });
        return toDevice(row);
      });
    },
  };
}
