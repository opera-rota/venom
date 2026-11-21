import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { StoredCredential, type CredentialStore } from "./credential.ts";

export interface Encryptor {
  available(): boolean;
  encrypt(plain: string): Buffer;
  decrypt(sealed: Buffer): string;
}

export class CredentialVault implements CredentialStore {
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
