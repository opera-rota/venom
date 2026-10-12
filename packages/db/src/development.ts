import type { Sql } from "postgres";

export const developmentAccount = {
  id: "01a12a2d-0000-7000-8000-000000000001",
  name: "VENOM developer",
  email: "developer@venom.local",
} as const;

export const developmentDevice = {
  id: "01a12a2d-0000-7000-8000-000000000002",
  type: "computer",
  name: "Work computer",
  platform: "windows",
  capabilities: {
    screen_control: false,
    microphone: false,
    speaker: false,
    shortcuts: false,
    notifications: false,
    network: true,
  },
} as const;

export async function seedDevelopment(sql: Sql): Promise<boolean> {
  return sql.begin(async (tx) => {
    const created = await tx`
      insert into accounts (id, name, email)
      values (${developmentAccount.id}, ${developmentAccount.name}, ${developmentAccount.email})
      on conflict do nothing
      returning id
    `;
    await tx`
      insert into devices (id, account_id, type, name, platform, capabilities, status)
      values (
        ${developmentDevice.id}, ${developmentAccount.id}, ${developmentDevice.type}, ${developmentDevice.name},
        ${developmentDevice.platform}, ${tx.json(developmentDevice.capabilities)}, 'active'
      )
      on conflict do nothing
    `;
    if (created.length === 0) {
      return false;
    }
    await tx`
      insert into audit_log (account_id, device_id, actor, action, subject_id)
      values (${developmentAccount.id}, ${developmentDevice.id}, 'system', 'account.seeded', ${developmentAccount.id})
    `;
    return true;
  });
}
