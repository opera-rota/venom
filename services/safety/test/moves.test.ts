import { describe, expect, it } from "vitest";
import type { Effect, MakeMove, Observation, ScreenMark, ScreenMove } from "@venom/contracts";
import { cardWords, judgeMove, passwordWords, unreadWords } from "../src/index.ts";

function mark(id: number, kind: ScreenMark["kind"], name: string, x: number, more: Partial<ScreenMark> = {}): ScreenMark {
  return { id, kind, name, editable: false, password: false, box: { x, y: 100, width: 80, height: 30 }, ...more };
}

const seen: Observation = {
  picture: "QUJD",
  width: 1280,
  height: 720,
  window: "Inbox - Gmail - Google Chrome",
  app: "chrome",
  marks: [
    mark(1, "button", "Send", 0),
    mark(2, "box", "Password", 100, { editable: true, password: true }),
    mark(3, "link", "Random article", 200),
    mark(4, "box", "Write a message", 300, { editable: true }),
    mark(5, "box", "Search Wikipedia", 400, { editable: true }),
    mark(6, "button", "Place your order", 500),
    mark(7, "button", "Sign in", 600),
    mark(8, "button", "Delete forever", 700),
    mark(9, "button", "Supprimer", 800),
  ],
  focused: 5,
};

function move(chosen: ScreenMove, effects: readonly Effect[] = []): MakeMove {
  return { kind: "move", intent: "Do the next thing", effects: [...effects], move: chosen };
}

const click = (target: number): MakeMove => move({ name: "click", mark: target, point: null, double: false });

describe("fixed rules judge every move by what is really on the screen", () => {
  it("lets a harmless click go ahead", () => {
    expect(judgeMove(click(3), seen, "standard")).toEqual({ verdict: "go", effects: [], risk: "low", because: [] });
  });

  it.each([
    [1, "posts", 'It presses the button named "Send". It posts or sends something.'],
    [6, "pays", 'It presses the button named "Place your order". It spends money.'],
    [7, "uses_credential", 'It presses the button named "Sign in". It uses a password or key.'],
    [8, "deletes", 'It presses the button named "Delete forever". It deletes something.'],
    [9, "deletes", 'It presses the button named "Supprimer". It deletes something.'],
  ] as const)("asks before pressing mark %i, whatever the brain claimed", (target, effect, because) => {
    expect(judgeMove(click(target), seen, "standard")).toMatchObject({ verdict: "ask", effects: [effect], because: [because] });
  });

  it("reads the mark under a clicked point", () => {
    const atPoint = move({ name: "click", mark: null, point: { x: 20, y: 110 }, double: false });
    expect(judgeMove(atPoint, seen, "standard")).toMatchObject({ verdict: "ask", effects: ["posts"] });
  });

  it("asks first when it cannot read what is at a clicked spot", () => {
    const blank = move({ name: "click", mark: null, point: { x: 1211, y: 600 }, double: false });
    expect(judgeMove(blank, seen, "standard")).toEqual({ verdict: "ask", effects: [], risk: "medium", because: [unreadWords] });
    expect(judgeMove(blank, seen, "standard", [], { kind: "other", name: "Wikipedia, the free encyclopedia", password: false }).verdict).toBe("ask");
  });

  it("reads the real name the hands found at a clicked spot", () => {
    const login = move({ name: "click", mark: null, point: { x: 1211, y: 600 }, double: false });
    expect(judgeMove(login, seen, "standard", [], { kind: "link", name: "Log in", password: false })).toMatchObject({
      verdict: "ask",
      effects: ["uses_credential"],
      because: ['It presses the link named "Log in". It uses a password or key.'],
    });
    expect(judgeMove(login, seen, "standard", [], { kind: "link", name: "Random article", password: false })).toMatchObject({ verdict: "go", risk: "low" });
    const overSend = move({ name: "click", mark: null, point: { x: 20, y: 110 }, double: false });
    expect(judgeMove(overSend, seen, "standard", [], { kind: "link", name: "Log in", password: false }).effects).toEqual(["uses_credential", "posts"]);
  });

  it("asks before Enter sends a message, and not before Enter searches", () => {
    const reply = move({ name: "type", text: "See you at six", mark: 4, enter: true });
    expect(judgeMove(reply, seen, "standard")).toMatchObject({ verdict: "ask", effects: ["posts"] });
    expect(judgeMove(move({ name: "type", text: "Kigali", mark: 5, enter: true }), seen, "standard").verdict).toBe("go");
    expect(judgeMove(move({ name: "key", key: "enter" }), { ...seen, focused: 1 }, "standard")).toMatchObject({ verdict: "ask", effects: ["posts"] });
  });

  it("refuses to type into a password box, named or focused", () => {
    expect(judgeMove(move({ name: "type", text: "hunter2", mark: 2, enter: false }), seen, "standard")).toEqual({
      verdict: "refuse",
      effects: [],
      risk: "high",
      because: [passwordWords],
    });
    expect(judgeMove(move({ name: "type", text: "hunter2", mark: null, enter: true }), { ...seen, focused: 2 }, "standard").verdict).toBe("refuse");
  });

  it("refuses to type a card number", () => {
    const card = move({ name: "type", text: "4111 1111 1111 1111", mark: 5, enter: false });
    expect(judgeMove(card, seen, "standard")).toMatchObject({ verdict: "refuse", because: [cardWords] });
  });

  it("treats opening a web address as reaching outside, and a local file as not", () => {
    expect(judgeMove(move({ name: "open", app: "Chrome", open: "wikipedia.org" }), seen, "standard")).toMatchObject({ verdict: "ask", effects: ["reaches_outside"] });
    expect(judgeMove(move({ name: "open", app: "Notepad", open: null }), seen, "standard").verdict).toBe("go");
  });

  it("lets the brain make a move stricter, never safer", () => {
    expect(judgeMove(move({ name: "scroll", direction: "down", steps: 3, mark: null }, ["posts"]), seen, "standard")).toEqual({
      verdict: "ask",
      effects: ["posts"],
      risk: "medium",
      because: ["VENOM's brain said: It posts or sends something."],
    });
  });

  it("stops asking about posting when the user said so, but always asks about money and passwords", () => {
    const skip = ["deletes", "posts", "reaches_outside"] as const;
    expect(judgeMove(click(1), seen, "standard", skip).verdict).toBe("go");
    expect(judgeMove(click(6), seen, "standard", skip).verdict).toBe("ask");
    expect(judgeMove(click(7), seen, "standard", skip).verdict).toBe("ask");
  });
});
