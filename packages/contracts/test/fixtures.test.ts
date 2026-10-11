import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import * as shapes from "../src/index.ts";

const fixturesRoot = join(import.meta.dirname, "..", "fixtures");

function loadFixtures(kind: "valid" | "invalid") {
  return readdirSync(join(fixturesRoot, kind))
    .filter((file) => file.endsWith(".json"))
    .map((file) => ({
      file,
      shape: file.split(".")[0] ?? "",
      data: JSON.parse(readFileSync(join(fixturesRoot, kind, file), "utf8")) as unknown,
    }));
}

function schemaFor(shape: string): z.ZodType {
  const candidate: unknown = Reflect.get(shapes, shape);
  if (!(candidate instanceof z.ZodType)) {
    throw new Error(`No contract named ${shape}`);
  }
  return candidate;
}

describe("contract fixtures", () => {
  it.each(loadFixtures("valid"))("accepts $file", ({ shape, data }) => {
    const result = schemaFor(shape).safeParse(data);
    expect(result.error?.issues).toBeUndefined();
  });

  it.each(loadFixtures("invalid"))("rejects $file", ({ shape, data }) => {
    expect(schemaFor(shape).safeParse(data).success).toBe(false);
  });
});
