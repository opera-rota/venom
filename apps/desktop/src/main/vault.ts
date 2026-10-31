import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { DeviceToken, PublicKey, Session } from "@venom/contracts";
import { z } from "zod";

export interface Encryptor {
  available(): boolean;
  encrypt(plain: string): Buffer;
  decrypt(sealed: Buffer): string;
}

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

export class CredentialVault {
  readonly #file: string;
  readonly #encryptor: Encryptor;

  constructor(file: string, encryptor: Encryptor) {
    this.#file = file;
    this.#encryptor = encryptor;
  }

  read(): StoredCredential | null {
    let sealed: Buffer;
    try {
      sealed = readFileSync(this.#file);
    } catch {
      return null;
    }
    try {
      const stored = StoredCredential.safeParse(JSON.parse(this.#encryptor.decrypt(sealed)));
      return stored.success ? stored.data : null;
    } catch {
      return null;
    }
  }

  write(credential: StoredCredential): void {
    if (!this.#encryptor.available()) {
      throw new Error("This computer cannot encrypt VENOM's sign-in key, so it will not be saved.");
    }
    writeFileSync(this.#file, this.#encryptor.encrypt(JSON.stringify(StoredCredential.parse(credential))), { mode: 0o600 });
  }

  clear(): void {
    rmSync(this.#file, { force: true });
  }
}
