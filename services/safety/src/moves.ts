import type { ConfirmationStrictness, Effect, MakeMove, Observation, Risk, ScreenMark, ScreenMarkKind, ScreenPoint } from "@venom/contracts";
import { alwaysAsks, effectOrder, effectWords, highRisk, opensOutside } from "./rules.ts";

export type MoveVerdict = "go" | "ask" | "refuse";

export interface MoveJudgement {
  readonly verdict: MoveVerdict;
  readonly effects: readonly Effect[];
  readonly risk: Risk;
  readonly because: readonly string[];
}

export interface Spot {
  readonly kind: ScreenMarkKind;
  readonly name: string;
  readonly password: boolean;
}

type Named = Pick<ScreenMark, "kind" | "name">;

interface Meaning {
  readonly effect: Effect;
  readonly words: RegExp;
}

const pressedMeanings: readonly Meaning[] = [
  {
    effect: "pays",
    words: /\b(?:pay|pay now|buy|buy now|purchase|check ?out|place (?:your )?order|order now|subscribe|donate|tip|payer|acheter|commander|s'abonner|valider (?:la |le )?(?:commande|paiement))\b/,
  },
  {
    effect: "uses_credential",
    words: /\b(?:sign ?in|log ?in|sign-in|log-in|continue with (?:google|microsoft|apple|facebook)|authori[sz]e|allow access|grant access|se connecter|connexion|s'identifier)\b/,
  },
  {
    effect: "deletes",
    words: /\b(?:delete|remove|trash|discard|erase|uninstall|empty (?:the )?(?:bin|trash|recycle bin)|delete forever|supprimer|effacer|retirer|vider)\b/,
  },
  {
    effect: "posts",
    words: /\b(?:send|post|publish|share|tweet|reply|comment|submit|upload|invite|forward|repost|retweet|envoyer|publier|partager|r[ée]pondre|soumettre|commenter|transf[ée]rer)\b/,
  },
];

const sendingBox = /\b(?:message|reply|comment|chat|post|tweet|write (?:a|an|your)|compose|r[ée]ponse|commentaire)\b/;

const cardNumber = /(?:\d[ -]?){13,19}/;

function plain(name: string): string {
  return name.toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();
}

function area(mark: ScreenMark): number {
  return mark.box.width * mark.box.height;
}

function under(point: ScreenPoint, seen: Observation): ScreenMark | null {
  const hits = seen.marks.filter(
    ({ box }) => point.x >= box.x && point.x < box.x + box.width && point.y >= box.y && point.y < box.y + box.height,
  );
  return hits.reduce<ScreenMark | null>((smallest, mark) => (smallest === null || area(mark) < area(smallest) ? mark : smallest), null);
}

function marked(seen: Observation, id: number | null): ScreenMark | null {
  return id === null ? null : (seen.marks[id - 1] ?? null);
}

function quoted(mark: Named): string {
  return `"${mark.name.length > 60 ? `${mark.name.slice(0, 57)}...` : mark.name}"`;
}

function pressed(mark: Named | null): { effects: Effect[]; because: string[] } {
  if (mark === null || mark.name.length === 0) {
    return { effects: [], because: [] };
  }
  const name = plain(mark.name);
  const found = pressedMeanings.filter(({ words }) => words.test(name)).map(({ effect }) => effect);
  return {
    effects: found,
    because: found.map((effect) => `It presses the ${mark.kind} named ${quoted(mark)}. ${effectWords[effect]}`),
  };
}

function entered(box: ScreenMark | null): { effects: Effect[]; because: string[] } {
  if (box === null || !box.editable || !sendingBox.test(plain(box.name))) {
    return { effects: [], because: [] };
  }
  return { effects: ["posts"], because: [`It presses Enter in the box named ${quoted(box)}, which can send it. ${effectWords.posts}`] };
}

function refused(because: string): MoveJudgement {
  return { verdict: "refuse", effects: [], risk: "high", because: [because] };
}

export const passwordWords = "VENOM never types into a password box. Please type it yourself, then tell VENOM to go on.";
export const cardWords = "VENOM never types a card number. Please type it yourself, then tell VENOM to go on.";
export const unreadWords = "VENOM cannot read what is at the spot it would click, so it asks first.";

function clicked(point: ScreenPoint, seen: Observation, spot: Spot | null): Named[] {
  const read = spot !== null && spot.kind !== "other" && spot.name.length > 0 ? [spot] : [];
  const mark = under(point, seen);
  return [...read, ...(mark !== null ? [mark] : [])];
}

export function judgeMove(
  choice: MakeMove,
  seen: Observation,
  strictness: ConfirmationStrictness,
  skipAsking: readonly Effect[] = [],
  spot: Spot | null = null,
): MoveJudgement {
  const move = choice.move;
  const focused = marked(seen, seen.focused);
  const found: { effects: Effect[]; because: string[] } = { effects: [], because: [] };
  let unread = false;
  const add = (more: { effects: readonly Effect[]; because: readonly string[] }) => {
    found.effects.push(...more.effects);
    found.because.push(...more.because);
  };

  switch (move.name) {
    case "click": {
      const marks = move.mark !== null ? [marked(seen, move.mark)].filter((mark) => mark !== null) : move.point !== null ? clicked(move.point, seen, spot) : [];
      unread = marks.length === 0;
      marks.forEach((target) => add(pressed(target)));
      break;
    }
    case "type": {
      const box = move.mark !== null ? marked(seen, move.mark) : focused;
      if (box?.password === true) {
        return refused(passwordWords);
      }
      if (cardNumber.test(move.text)) {
        return refused(cardWords);
      }
      if (move.enter) {
        add(entered(box));
      }
      break;
    }
    case "key":
      if (move.key === "enter") {
        add(focused?.editable === true ? entered(focused) : pressed(focused));
      }
      break;
    case "open":
      if (opensOutside({ name: "open_app", app: move.app, open: move.open })) {
        add({ effects: ["reaches_outside"], because: [`It opens ${move.open ?? move.app}. ${effectWords.reaches_outside}`] });
      }
      break;
    case "scroll":
    case "pause":
      break;
  }

  const effects = effectOrder.filter((effect) => choice.effects.includes(effect) || found.effects.includes(effect));
  const claimed = effects.filter((effect) => !found.effects.includes(effect)).map((effect) => `VENOM's brain said: ${effectWords[effect]}`);
  const asking = effects.filter((effect) => alwaysAsks.has(effect) || !skipAsking.includes(effect));
  const strictAsks = strictness === "strict" && effects.length > 0;
  const risk: Risk = effects.some((effect) => highRisk.has(effect)) ? "high" : effects.length > 0 || unread ? "medium" : "low";
  return {
    verdict: asking.length > 0 || strictAsks || unread ? "ask" : "go",
    effects,
    risk,
    because: [...new Set([...found.because, ...claimed, ...(unread ? [unreadWords] : [])])],
  };
}
