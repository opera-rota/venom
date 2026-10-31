import { memoryLimits, type MemoryDraft, type MemoryType } from "@venom/contracts";

const opening =
  /^\s*(?:(?:hey|hi|ok|okay)[\s,]+)?(?:venom[\s,:]+)?(?:please\s+)?(?:remember|don['’]t\s+forget|do\s+not\s+forget|keep\s+in\s+mind)\b(?:\s*,?\s*please\b)?(?:\s+that\b|\s+this\s*:|\s*[:,])?\s*/iu;

const notSomethingToKeep = /^(?:to|when|what|how|if|whether|who|where|why|which|me|us|it)\b/iu;

const politeEnding = /[\s,]*please[\s.!]*$/iu;

const month =
  "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";

const preference =
  /\b(?:i|we)(?:\s+(?:really|usually|always|generally|also))?\s+(?:prefer|like|love|enjoy|hate|dislike|want|would\s+rather)\b|\b(?:i|we)['’]d\s+rather\b|\b(?:i|we)\s+(?:don['’]t|do\s+not|never)\s+(?:like|want|eat|drink|use|enjoy)\b|\b(?:always|never)\b|\bcall\s+me\b|\bmy\s+favou?rite\b/iu;

const event = new RegExp(
  [
    String.raw`\b(?:birthday|anniversary|appointment|meeting|wedding|exam|deadline|interview|flight|trip|holiday|vacation|funeral|graduation)s?\b`,
    String.raw`\b(?:today|tonight|tomorrow|yesterday)\b`,
    String.raw`\b(?:on|this|next|last)\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|week|month|year|weekend)\b`,
    String.raw`\b\d{1,2}(?:st|nd|rd|th)?\s+(?:of\s+)?${month}\b`,
    String.raw`\b${month}\s+\d{1,2}(?:st|nd|rd|th)?\b`,
    String.raw`\b\d{4}-\d{2}-\d{2}\b`,
    String.raw`\b\d{1,2}[/.]\d{1,2}[/.]\d{2,4}\b`,
  ].join("|"),
  "iu",
);

export function classify(content: string): MemoryType {
  if (preference.test(content)) {
    return "preference";
  }
  return event.test(content) ? "event" : "fact";
}

export function detect(text: string): MemoryDraft | null {
  const opened = opening.exec(text);
  if (opened === null) {
    return null;
  }
  const rest = text.slice(opened[0].length).replace(politeEnding, "").replace(/\s+/gu, " ").trim();
  if (rest.length < 3 || rest.length > memoryLimits.characters || rest.endsWith("?") || !/\p{L}/u.test(rest) || notSomethingToKeep.test(rest)) {
    return null;
  }
  const content = rest.charAt(0).toLocaleUpperCase("en") + rest.slice(1);
  return { type: classify(content), content };
}
