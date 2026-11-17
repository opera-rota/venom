import type { ChatDocument } from "@venom/contracts";

const unsafeCharacters = /[<>:"/\\|?*\u0000-\u001f]/gu;
const reservedNames = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu;
const nameCharacters = 80;
const fallbackName = "Document";

export function documentFileName(title: string): string {
  const cleaned = title
    .replace(unsafeCharacters, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, nameCharacters)
    .replace(/[. ]+$/u, "");
  const name = cleaned === "" || reservedNames.test(cleaned) ? fallbackName : cleaned;
  return `${name}.md`;
}

export function documentText({ title, body }: ChatDocument): string {
  return `# ${title}\n\n${body.trimEnd()}\n`;
}
