import type { AwakeLevel } from "../shared/bridge.ts";

export type BlockerKind = "prevent-app-suspension" | "prevent-display-sleep";

export interface Blocker {
  start(kind: BlockerKind): number;
  stop(id: number): void;
}

const kinds: Readonly<Record<Exclude<AwakeLevel, "none">, BlockerKind>> = {
  system: "prevent-app-suspension",
  display: "prevent-display-sleep",
};

export function awakeLevel(level: unknown): AwakeLevel | null {
  return level === "none" || level === "system" || level === "display" ? level : null;
}

export class Awake {
  readonly #blocker: Blocker;
  #level: AwakeLevel = "none";
  #held: number | null = null;

  constructor(blocker: Blocker) {
    this.#blocker = blocker;
  }

  get level(): AwakeLevel {
    return this.#level;
  }

  set(level: AwakeLevel): void {
    if (level === this.#level) {
      return;
    }
    const before = this.#held;
    this.#held = level === "none" ? null : this.#blocker.start(kinds[level]);
    this.#level = level;
    if (before !== null) {
      this.#blocker.stop(before);
    }
  }
}
