import { describe, expect, it } from "vitest";
import { understand } from "../src/spoken.ts";

describe("chat sentences VENOM acts on by itself", () => {
  it("knows stop, run, yes, no and the don't ask me sentences", () => {
    expect(understand("Stop")).toEqual({ kind: "stop" });
    expect(understand("run it")).toEqual({ kind: "yes", runs: true });
    expect(understand("Yes.")).toEqual({ kind: "yes", runs: false });
    expect(understand("no thanks")).toEqual({ kind: "no" });
    expect(understand("Don't ask me before reaching outside the computer")).toEqual({ kind: "asking", ask: false, effect: "reaches_outside" });
    expect(understand("please don't ask me before paying")).toEqual({ kind: "asking", ask: false, effect: "pays" });
    expect(understand("Ask me again before opening websites")).toEqual({ kind: "asking", ask: true, effect: "reaches_outside" });
  });

  it("leaves a message with more in it to the brain, so nothing typed is dropped", () => {
    expect(understand("Don't ask me before reaching outside\nOpen Chrome on wikipedia.org")).toBeNull();
    expect(understand("Don't ask me before reaching outside and open Chrome on wikipedia.org")).toBeNull();
    expect(understand("stop\nthen open Notepad")).toBeNull();
    expect(understand("yes\nand also delete the old list")).toBeNull();
  });
});
