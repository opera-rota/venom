import { describe, expect, it } from "vitest";
import { howItRuns, whyItAsks } from "../src/renderer/src/plan-words.ts";

describe("every step says how it will run, in plain words", () => {
  it.each([
    [{ name: "wait", seconds: 1 }, "Waits 1 second"],
    [{ name: "wait", seconds: 30 }, "Waits 30 seconds"],
    [{ name: "open_app", app: "Notepad" }, "Opens Notepad"],
    [{ name: "type_text", text: "Milk\nbread\neggs", into: "the Notepad window" }, 'Types "Milk bread eggs" into the Notepad window'],
    [{ name: "click", on: "the Save button" }, "Clicks the Save button"],
    [{ name: "run_script", language: "powershell", purpose: "Save the list on the desktop", code: "Set-Content list.txt 'Milk'" }, "Runs a PowerShell script: Save the list on the desktop"],
    [{ name: "take_screenshot" }, "Takes a screenshot"],
    [{ name: "call_connector", service: "mail", operation: "send an email", details: "To Alex" }, "Uses Mail to send an email: To Alex"],
  ] as const)("%o", (spec, words) => {
    expect(howItRuns(spec)).toBe(words);
  });

  it("shortens long typed text", () => {
    const words = howItRuns({ name: "type_text", text: "a".repeat(200), into: "the note" });
    expect(words).toBe(`Types "${"a".repeat(59)}…" into the note`);
  });
});

describe("a step that asks says why", () => {
  it("names every reason the fixed rules found", () => {
    expect(whyItAsks({ effects: ["deletes"], reversible: false })).toBe("Asks you first because it deletes something");
    expect(whyItAsks({ effects: ["pays", "posts", "reaches_outside"], reversible: false })).toBe(
      "Asks you first because it spends money, it sends or posts something and it reaches outside this computer",
    );
    expect(whyItAsks({ effects: [], reversible: false })).toBe("Asks you first because it cannot be undone");
  });
});
