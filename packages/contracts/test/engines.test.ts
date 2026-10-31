import { describe, expect, it } from "vitest";
import { Engine, EngineId, EngineSpec, engines, publicEngine } from "../src/index.ts";

describe("engine catalogue", () => {
  it("has exactly one engine for every engine id", () => {
    expect(Object.keys(engines).sort()).toEqual([...EngineId.options].sort());
  });

  it.each(Object.entries(engines))("%s is a valid engine whose key matches its id", (id, engine) => {
    expect(EngineSpec.parse(engine).id).toBe(id);
  });

  it("charges nothing for free engines and something for every other engine", () => {
    for (const engine of Object.values(engines)) {
      expect(engine.typical_power === 0).toBe(engine.class === "free");
    }
  });

  it("never shows a model to devices", () => {
    const shown = publicEngine(engines.utopia);
    expect(Engine.parse(shown)).toEqual(shown);
    expect(Object.keys(shown)).not.toContain("models");
  });
});
