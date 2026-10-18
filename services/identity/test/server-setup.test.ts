import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadServerSetup } from "../src/index.ts";

describe("identity server key", () => {
  it("is created once and then reused", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "venom-identity-")), "nested", "identity-server-setup");
    const first = await loadServerSetup(file);
    const second = await loadServerSetup(file);

    expect(first.created).toBe(true);
    expect(second).toEqual({ value: first.value, created: false });
    expect(readFileSync(file, "utf8").trim()).toBe(first.value);
    if (process.platform !== "win32") {
      expect(statSync(file).mode & 0o777).toBe(0o600);
    }
  });

  it("refuses a damaged key instead of silently replacing it", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "venom-identity-")), "identity-server-setup");
    writeFileSync(file, "damaged");
    await expect(loadServerSetup(file)).rejects.toThrow(/damaged/);
  });
});
