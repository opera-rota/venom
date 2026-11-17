import { describe, expect, it } from "vitest";
import { documentFileName, documentText } from "../src/main/documents.ts";

describe("saving a document VENOM handed over", () => {
  it.each([
    ["Shopping list", "Shopping list.md"],
    ["Plan: week 1 / week 2?", "Plan week 1 week 2.md"],
    ["  Notes...  ", "Notes.md"],
    ["CON", "Document.md"],
    ['<>:"|?*', "Document.md"],
    ["x".repeat(200), `${"x".repeat(80)}.md`],
  ])("names the file for %j as %j, safe for Windows", (title, name) => {
    expect(documentFileName(title)).toBe(name);
  });

  it("writes the title as a heading above the body", () => {
    expect(documentText({ title: "Shopping list", body: "- Milk\n- Bread\n\n" })).toBe("# Shopping list\n\n- Milk\n- Bread\n");
  });
});
