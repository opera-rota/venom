import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { CommandFrame, safetyLimits, type CommandBody } from "@venom/contracts";
import type { DeviceRef } from "@venom/db";
import { v7 as uuidv7 } from "uuid";
import { commandText, isKeyPair, newKeyPair, signText, type KeyPair } from "./crypto.ts";

export interface IssuedCommand {
  readonly commandId: string;
  readonly frame: CommandFrame;
}

export interface CommandSigner {
  readonly publicKey: string;
  issue(device: DeviceRef, body: CommandBody): IssuedCommand;
}

export interface CommandKey {
  readonly pair: KeyPair;
  readonly created: boolean;
}

export function createCommandSigner(pair: KeyPair, now: () => number = Date.now): CommandSigner {
  return {
    publicKey: pair.publicKey,
    issue(device, body) {
      const commandId = uuidv7();
      const issued = now();
      const payload = JSON.stringify({
        command_id: commandId,
        account_id: device.account_id,
        device_id: device.id,
        issued_at: new Date(issued).toISOString(),
        expires_at: new Date(issued + safetyLimits.commandLifetimeSeconds * 1000).toISOString(),
        body,
      });
      const frame = CommandFrame.parse({ type: "command", command: { payload, signature: signText(pair, commandText(payload)) } });
      return { commandId, frame };
    },
  };
}

function readKey(text: string, file: string): KeyPair {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === "object" && parsed !== null && "private_key" in parsed && "public_key" in parsed) {
      const pair = { privateKey: String(parsed.private_key), publicKey: String(parsed.public_key) };
      if (isKeyPair(pair)) {
        return pair;
      }
    }
  } catch {}
  throw new Error(`The command key in ${file} is damaged. Restore it from backup, or delete it and restart every VENOM app so they learn the new key.`);
}

export async function loadCommandKey(file: string): Promise<CommandKey> {
  try {
    return { pair: readKey(await readFile(file, "utf8"), file), created: false };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  const pair = newKeyPair();
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  try {
    await writeFile(file, `${JSON.stringify({ private_key: pair.privateKey, public_key: pair.publicKey })}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      return { pair: readKey(await readFile(file, "utf8"), file), created: false };
    }
    throw error;
  }
  return { pair, created: true };
}
