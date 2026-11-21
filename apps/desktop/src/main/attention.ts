export interface AttentionOptions {
  readonly idleSeconds: () => number;
  readonly ownFocused: () => boolean;
  readonly interrupted: (taskId: string) => void;
  readonly now?: () => number;
  readonly everyMs?: number;
  readonly graceMs?: number;
  readonly activeMs?: number;
}

export class Attention {
  readonly #idleSeconds: () => number;
  readonly #ownFocused: () => boolean;
  readonly #interrupted: (taskId: string) => void;
  readonly #now: () => number;
  readonly #everyMs: number;
  readonly #graceMs: number;
  readonly #activeMs: number;
  #task: string | null = null;
  #lastCommand = 0;
  #quietUntil = 0;
  #moving = 0;
  #told = false;
  #timer: ReturnType<typeof setInterval> | null = null;

  constructor({ idleSeconds, ownFocused, interrupted, now = Date.now, everyMs = 400, graceMs = 1500, activeMs = 90_000 }: AttentionOptions) {
    this.#idleSeconds = idleSeconds;
    this.#ownFocused = ownFocused;
    this.#interrupted = interrupted;
    this.#now = now;
    this.#everyMs = everyMs;
    this.#graceMs = graceMs;
    this.#activeMs = activeMs;
  }

  started(taskId: string, moving: boolean): void {
    const now = this.#now();
    if (taskId !== this.#task || this.#told) {
      this.#task = taskId;
      this.#told = false;
      this.#quietUntil = now + this.#graceMs;
    }
    this.#lastCommand = now;
    if (moving) {
      this.#moving += 1;
    }
    this.#timer ??= setInterval(() => this.#check(), this.#everyMs);
  }

  finished(taskId: string, moving: boolean): void {
    if (taskId !== this.#task) {
      return;
    }
    const now = this.#now();
    this.#lastCommand = now;
    if (moving) {
      this.#moving = Math.max(0, this.#moving - 1);
      this.#quietUntil = now + this.#graceMs;
    }
  }

  stop(): void {
    if (this.#timer !== null) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
    this.#task = null;
    this.#moving = 0;
  }

  #check(): void {
    const now = this.#now();
    const task = this.#task;
    if (task === null || now - this.#lastCommand > this.#activeMs) {
      this.stop();
      return;
    }
    if (this.#told || this.#moving > 0 || now < this.#quietUntil || this.#ownFocused()) {
      return;
    }
    if (this.#idleSeconds() === 0) {
      this.#told = true;
      this.#interrupted(task);
    }
  }
}
