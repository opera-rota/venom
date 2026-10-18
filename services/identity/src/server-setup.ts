import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import * as opaque from "@serenity-kit/opaque";

export interface ServerSetup {
  readonly value: string;
  readonly created: boolean;
}

function assertUsable(value: string, file: string): string {
  try {
    opaque.server.getPublicKey(value);
    return value;
  } catch {
    throw new Error(`The identity key in ${file} is damaged. Restore it from backup; a new key would lock every account out.`);
  }
}

export async function loadServerSetup(file: string): Promise<ServerSetup> {
  await opaque.ready;

  try {
    return { value: assertUsable((await readFile(file, "utf8")).trim(), file), created: false };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  const value = opaque.server.createSetup();
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  try {
    await writeFile(file, `${value}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      return { value: assertUsable((await readFile(file, "utf8")).trim(), file), created: false };
    }
    throw error;
  }
  return { value, created: true };
}

export async function createEphemeralServerSetup(): Promise<string> {
  await opaque.ready;
  return opaque.server.createSetup();
}
