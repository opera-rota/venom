import { Account, Device } from "@venom/contracts";

export interface AccountRow {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly listening_mode: string;
  readonly confirmation_strictness: string;
  readonly created_at: Date;
}

export interface DeviceRow {
  readonly id: string;
  readonly account_id: string;
  readonly type: string;
  readonly name: string;
  readonly platform: string;
  readonly capabilities: unknown;
  readonly status: string;
  readonly last_seen_at: Date | null;
}

export function toAccount(row: AccountRow): Account {
  return Account.parse({
    id: row.id,
    name: row.name,
    email: row.email,
    settings: {
      listening_mode: row.listening_mode,
      confirmation_strictness: row.confirmation_strictness,
    },
    created_at: row.created_at.toISOString(),
  });
}

export function toDevice(row: DeviceRow): Device {
  return Device.parse({ ...row, last_seen_at: row.last_seen_at?.toISOString() ?? null });
}
