import { describe, expect, it } from "vitest";
import { classify, detect } from "../src/index.ts";

describe("what VENOM keeps when asked", () => {
  it.each([
    ["Remember that I prefer metric units", "preference", "I prefer metric units"],
    ["please remember that my sister Ana's birthday is on 12 March", "event", "My sister Ana's birthday is on 12 March"],
    ["VENOM, remember: my car is a blue Toyota.", "fact", "My car is a blue Toyota."],
    ["Don’t forget that I have a dentist appointment on Friday", "event", "I have a dentist appointment on Friday"],
    ["Keep in mind that I never drink coffee after 4pm please", "preference", "I never drink coffee after 4pm"],
    ["remember my wife is called Sara", "fact", "My wife is called Sara"],
    ["Remember, call me Nini", "preference", "Call me Nini"],
  ])("keeps %j", (text, type, content) => {
    expect(detect(text)).toEqual({ type, content });
  });

  it.each([
    "What did I say about my sister's birthday?",
    "Do you remember my sister's birthday?",
    "Remember to call my mother tomorrow",
    "Remember when we talked about Rust?",
    "Remember what I said about units?",
    "Remember that",
    "remembering things is hard",
    "Remember that 12345",
    `Remember that ${"x".repeat(501)}`,
  ])("does not keep %j", (text) => {
    expect(detect(text)).toBeNull();
  });

  it.each([
    ["I like short answers", "preference"],
    ["We would rather meet in the morning", "preference"],
    ["My favourite food is isombe", "preference"],
    ["The exam is on 2026-12-04", "event"],
    ["Our anniversary is March 3rd", "event"],
    ["My office is at Norrsken House", "fact"],
  ])("sorts %j as a %s", (content, type) => {
    expect(classify(content)).toBe(type);
  });
});
