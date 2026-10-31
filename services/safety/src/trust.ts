import { randomBytes } from "node:crypto";
import { DeviceKeyEnrolled, LiveChallenge, safetyLimits } from "@venom/contracts";
import type { DeviceRef } from "@venom/db";
import type { Sql } from "postgres";
import { liveChallengeText, verifyText } from "./crypto.ts";
import { refuseSafety } from "./errors.ts";

export interface TrustOptions {
  readonly sql: Sql;
  readonly serverKey: string;
}

export interface Trust {
  enroll(device: DeviceRef, publicKey: string, requestId: string): Promise<DeviceKeyEnrolled>;
  hasKey(device: DeviceRef): Promise<boolean>;
  challenge(device: DeviceRef): Promise<LiveChallenge>;
  prove(device: DeviceRef, challengeId: string, signature: string): Promise<boolean>;
}

export function createTrust({ sql, serverKey }: TrustOptions): Trust {
  async function enrolledKey(device: DeviceRef): Promise<Buffer | null> {
    const [row] = await sql<{ public_key: Buffer | null }[]>`
      select public_key from devices where id = ${device.id} and account_id = ${device.account_id} and status <> 'revoked'
    `;
    return row?.public_key ?? null;
  }

  return {
    async enroll(device, publicKey, requestId) {
      const wanted = Buffer.from(publicKey, "base64url");
      const enrolled = await sql.begin(async (tx) => {
        const [row] = await tx<{ public_key: Buffer | null }[]>`
          select public_key from devices where id = ${device.id} and account_id = ${device.account_id} for update
        `;
        if (row?.public_key != null) {
          return row.public_key.equals(wanted);
        }
        await tx`update devices set public_key = ${wanted}, key_enrolled_at = clock_timestamp() where id = ${device.id}`;
        await tx`
          insert into audit_log (account_id, device_id, request_id, actor, action, subject_id)
          values (${device.account_id}, ${device.id}, ${requestId}, 'system', 'device.key_enrolled', ${device.id})
        `;
        return true;
      });
      if (!enrolled) {
        throw refuseSafety.keyTaken();
      }
      return DeviceKeyEnrolled.parse({ device_id: device.id, server_key: serverKey });
    },

    async hasKey(device) {
      return (await enrolledKey(device)) !== null;
    },

    async challenge(device) {
      if ((await enrolledKey(device)) === null) {
        throw refuseSafety.keyMissing();
      }
      const nonce = randomBytes(32);
      const [row] = await sql<{ id: string; expires_at: Date }[]>`
        insert into live_challenges (device_id, nonce, expires_at)
        values (${device.id}, ${nonce}, clock_timestamp() + make_interval(secs => ${safetyLimits.challengeLifetimeSeconds}))
        returning id, expires_at
      `;
      if (row === undefined) {
        throw new Error("Challenge insert returned no row");
      }
      return LiveChallenge.parse({ challenge_id: row.id, nonce: nonce.toString("base64url"), expires_at: row.expires_at.toISOString() });
    },

    async prove(device, challengeId, signature) {
      const [row] = await sql<{ nonce: Buffer; public_key: Buffer }[]>`
        update live_challenges c
        set used_at = clock_timestamp()
        from devices d
        where c.id = ${challengeId}
          and c.device_id = ${device.id}
          and c.used_at is null
          and c.expires_at > clock_timestamp()
          and d.id = c.device_id
          and d.account_id = ${device.account_id}
          and d.public_key is not null
        returning c.nonce, d.public_key
      `;
      const proven =
        row !== undefined &&
        verifyText(row.public_key.toString("base64url"), liveChallengeText(device.id, challengeId, row.nonce.toString("base64url")), signature);
      if (!proven) {
        await sql`
          insert into audit_log (account_id, device_id, actor, action, subject_id, detail)
          values (${device.account_id}, ${device.id}, 'system', 'device.challenge_refused', ${device.id}, ${sql.json({ known: row !== undefined })})
        `;
      }
      return proven;
    },
  };
}
