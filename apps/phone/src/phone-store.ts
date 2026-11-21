import { StoredCredential, type CredentialStore } from "@desktop/main/credential.ts";

export type PhoneStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export class PhoneCredentialStore implements CredentialStore {
  readonly #storage: PhoneStorage;
  readonly #key: string;

  constructor(storage: PhoneStorage, key = "venom.credential") {
    this.#storage = storage;
    this.#key = key;
  }

  read(): StoredCredential | null {
    const saved = this.#storage.getItem(this.#key);
    if (saved === null) {
      return null;
    }
    try {
      const stored = StoredCredential.safeParse(JSON.parse(saved));
      return stored.success ? stored.data : null;
    } catch {
      return null;
    }
  }

  write(credential: StoredCredential): void {
    this.#storage.setItem(this.#key, JSON.stringify(StoredCredential.parse(credential)));
  }

  clear(): void {
    this.#storage.removeItem(this.#key);
  }
}
