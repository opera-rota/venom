import { describe, expect, it } from "vitest";
import { asksForLater, laterTitle } from "../src/later.ts";

describe("fixed code hears when she wants something kept for later", () => {
  it.each([
    "find the weather in Kigali and keep it for later",
    "Save this for later",
    "keep the results for later please",
    "Write a packing list and save it to read for later",
    "show me later",
    "Look up bus times, then show me the results later.",
  ])("hears %j", (text) => {
    expect(asksForLater(text)).toBe(true);
  });

  it.each([
    "what is the weather in Kigali?",
    "remind me later",
    "I'll do it later",
    "keep going",
    "save the file in Documents",
    "later, open Notepad",
  ])("does not hear %j", (text) => {
    expect(asksForLater(text)).toBe(false);
  });

  it.each([
    ["find the weather in Kigali and keep it for later", "Find the weather in Kigali"],
    ["Look up bus times, then show me the results later.", "Look up bus times"],
    ["keep it for later", "Kept for later"],
    ["Save this for later: the opening hours of the Kigali library", "The opening hours of the Kigali library"],
  ])("names %j as %j", (text, title) => {
    expect(laterTitle(text)).toBe(title);
  });

  it("keeps a long title within 120 characters", () => {
    expect(laterTitle(`${"word ".repeat(60)}and keep it for later`)).toHaveLength(120);
  });
});
