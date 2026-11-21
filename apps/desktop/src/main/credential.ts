import { DeviceToken, PublicKey, Session } from "@venom/contracts";
import { z } from "zod";

export const StoredKeys = z.strictObject({
  private_key: PublicKey,
  public_key: PublicKey,
  server_key: PublicKey.nullable(),
});

export const StoredCredential = z.strictObject({
  device_token: DeviceToken,
  session: Session,
  keys: StoredKeys.optional(),
});

export type StoredKeys = z.infer<typeof StoredKeys>;

export type StoredCredential = z.infer<typeof StoredCredential>;

export interface CredentialStore {
  read(): StoredCredential | null;
  write(credential: StoredCredential): void;
  clear(): void;
}
