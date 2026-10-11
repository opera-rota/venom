import { describe, expect, it } from "vitest";
import { Prompt, PromptRole, prompts } from "../src/index.ts";

describe("role prompts", () => {
  it("has exactly one prompt for every role", () => {
    expect(Object.keys(prompts).sort()).toEqual([...PromptRole.options].sort());
  });

  it.each(Object.entries(prompts))("%s is a valid versioned prompt", (role, prompt) => {
    expect(Prompt.parse(prompt).role).toBe(role);
  });
});
