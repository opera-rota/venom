import postgres, { type Sql } from "postgres";
import { Message, type Speaker } from "@venom/contracts";

export interface DeviceRef {
  readonly id: string;
  readonly account_id: string;
}

export interface RecordMessage {
  readonly device: DeviceRef;
  readonly requestId: string;
  readonly speaker: Speaker;
  readonly text: string;
}

export interface Store {
  findDevice(deviceId: string): Promise<DeviceRef | null>;
  recordMessage(input: RecordMessage): Promise<Message>;
  listMessages(accountId: string, limit: number): Promise<Message[]>;
  ping(): Promise<void>;
  close(): Promise<void>;
}

interface MessageRow {
  id: string;
  account_id: string;
  device_id: string;
  speaker: string;
  text: string;
  created_at: Date;
}

function toMessage(row: MessageRow): Message {
  return Message.parse({ ...row, created_at: row.created_at.toISOString() });
}

export function connect(url: string, options: { max?: number } = {}): Sql {
  return postgres(url, {
    max: options.max ?? 10,
    idle_timeout: 30,
    connect_timeout: 10,
    onnotice: () => {},
    connection: { application_name: "venom" },
  });
}

export function createStore(url: string): Store {
  const sql = connect(url);

  return {
    async findDevice(deviceId) {
      const [device] = await sql<DeviceRef[]>`
        select id, account_id from devices where id = ${deviceId} and status <> 'revoked'
      `;
      return device ?? null;
    },

    async recordMessage({ device, requestId, speaker, text }) {
      return sql.begin(async (tx) => {
        const [row] = await tx<MessageRow[]>`
          insert into messages (account_id, device_id, request_id, speaker, text)
          values (${device.account_id}, ${device.id}, ${requestId}, ${speaker}, ${text})
          returning id, account_id, device_id, speaker, text, created_at
        `;
        if (row === undefined) {
          throw new Error("Message insert returned no row");
        }
        await tx`
          insert into audit_log (account_id, device_id, request_id, actor, action, subject_id, detail)
          values (
            ${device.account_id}, ${device.id}, ${requestId}, ${speaker}, 'message.recorded', ${row.id},
            ${tx.json({ speaker, characters: text.length })}
          )
        `;
        return toMessage(row);
      });
    },

    async listMessages(accountId, limit) {
      const rows = await sql<MessageRow[]>`
        select id, account_id, device_id, speaker, text, created_at
        from (
          select * from messages
          where account_id = ${accountId}
          order by created_at desc, id desc
          limit ${limit}
        ) latest
        order by created_at, id
      `;
      return rows.map(toMessage);
    },

    async ping() {
      await sql`select 1`;
    },

    async close() {
      await sql.end({ timeout: 5 });
    },
  };
}
