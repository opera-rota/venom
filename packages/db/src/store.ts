import postgres, { type Sql } from "postgres";
import { ConversationEntry, Message, type IntentKind, type QuestionRef, type Speaker } from "@venom/contracts";

export interface DeviceRef {
  readonly id: string;
  readonly account_id: string;
}

export interface RecordMessage {
  readonly device: DeviceRef;
  readonly requestId: string;
  readonly speaker: Speaker;
  readonly text: string;
  readonly answer?: { readonly model: string | null; readonly intent: IntentKind };
}

export interface AskedRequest {
  readonly question: Message;
  readonly answered: boolean;
}

export interface Conversation {
  readonly messages: Message[];
  readonly unanswered: QuestionRef[];
}

export interface Store {
  recordMessage(input: RecordMessage): Promise<Message>;
  listConversation(accountId: string, limit: number): Promise<Conversation>;
  conversationBefore(accountId: string, messageId: string, limit: number): Promise<ConversationEntry[]>;
  findRequest(accountId: string, requestId: string): Promise<AskedRequest | null>;
  ping(): Promise<void>;
  close(): Promise<void>;
}

interface EntryRow {
  speaker: string;
  text: string;
}

interface RequestRow extends MessageRow {
  answered: boolean;
}

interface ConversationRow extends RequestRow {
  request_id: string;
}

interface MessageRow {
  id: string;
  account_id: string;
  device_id: string;
  speaker: string;
  text: string;
  created_at: Date;
}

function toMessage({ id, account_id, device_id, speaker, text, created_at }: MessageRow): Message {
  return Message.parse({ id, account_id, device_id, speaker, text, created_at: created_at.toISOString() });
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
    async recordMessage({ device, requestId, speaker, text, answer }) {
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
            ${tx.json({ speaker, characters: text.length, ...answer })}
          )
        `;
        return toMessage(row);
      });
    },

    async listConversation(accountId, limit) {
      const rows = await sql<ConversationRow[]>`
        select
          latest.id, latest.account_id, latest.device_id, latest.request_id, latest.speaker, latest.text, latest.created_at,
          latest.speaker = 'venom' or exists (
            select 1 from messages reply
            where reply.account_id = latest.account_id and reply.request_id = latest.request_id and reply.speaker = 'venom'
          ) as answered
        from (
          select * from messages
          where account_id = ${accountId}
          order by created_at desc, id desc
          limit ${limit}
        ) latest
        order by latest.created_at, latest.id
      `;
      return {
        messages: rows.map(toMessage),
        unanswered: rows.filter((row) => !row.answered).map((row) => ({ request_id: row.request_id, message_id: row.id })),
      };
    },

    async conversationBefore(accountId, messageId, limit) {
      const rows = await sql<EntryRow[]>`
        select speaker, text
        from (
          select earlier.speaker, earlier.text, earlier.created_at, earlier.id
          from messages pivot
          join messages earlier
            on earlier.account_id = pivot.account_id
           and (earlier.created_at, earlier.id) < (pivot.created_at, pivot.id)
          where pivot.id = ${messageId} and pivot.account_id = ${accountId}
          order by earlier.created_at desc, earlier.id desc
          limit ${limit}
        ) recent
        order by created_at, id
      `;
      return rows.map((row) => ConversationEntry.parse(row));
    },

    async findRequest(accountId, requestId) {
      const [row] = await sql<RequestRow[]>`
        select
          question.id, question.account_id, question.device_id, question.speaker, question.text, question.created_at,
          exists (
            select 1 from messages reply
            where reply.request_id = question.request_id and reply.speaker = 'venom'
          ) as answered
        from messages question
        where question.account_id = ${accountId} and question.request_id = ${requestId} and question.speaker = 'user'
      `;
      if (row === undefined) {
        return null;
      }
      const { answered, ...question } = row;
      return { question: toMessage(question), answered };
    },

    async ping() {
      await sql`select 1`;
    },

    async close() {
      await sql.end({ timeout: 5 });
    },
  };
}
