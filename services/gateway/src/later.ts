import { laterLimits } from "@venom/contracts";

const object = String.raw`(?:it|this|that|them|these|those|the (?:answer|result|results|list|page|info|information))`;
const keepVerb = String.raw`(?:keep|save|store|hold|put)`;
const keepPhrase = new RegExp(String.raw`\b${keepVerb}\b(?:\s+${object})?(?:\s+\w+){0,3}?\s+for later\b`, "iu");
const showPhrase = new RegExp(String.raw`\bshow (?:it to )?me(?:\s+${object})? later\b`, "iu");
const keepTail = new RegExp(String.raw`[\s,;:-]*(?:\b(?:and|then|please)\s+)*${keepVerb}(?:\s+${object})?(?:\s+\w+){0,3}?\s+for later\b(?:\s*,?\s*please)?[\s.!?]*`, "giu");
const showTail = new RegExp(String.raw`[\s,;:-]*(?:\b(?:and|then|please)\s+)*show (?:it to )?me(?:\s+${object})? later\b(?:\s*,?\s*please)?[\s.!?]*`, "giu");
const fallbackTitle = "Kept for later";

export const keptWords = "I kept this for later. You will find it in Screen, under For later.";

export function asksForLater(text: string): boolean {
  return keepPhrase.test(text) || showPhrase.test(text);
}

export function laterTitle(text: string): string {
  const cleaned = text.replace(keepTail, " ").replace(showTail, " ").replace(/\s+/gu, " ").replace(/^[\s,;:.!?-]+|[\s,;:-]+$/gu, "").trim();
  if (cleaned === "") {
    return fallbackTitle;
  }
  const titled = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  return titled.length <= laterLimits.title ? titled : `${titled.slice(0, laterLimits.title - 1).trimEnd()}…`;
}
