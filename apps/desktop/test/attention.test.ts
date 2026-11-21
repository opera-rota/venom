import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Attention } from "../src/main/attention.ts";

interface Desk {
  idle: number;
  focused: boolean;
  readonly told: string[];
  readonly attention: Attention;
}

function desk(): Desk {
  const told: string[] = [];
  const state = { idle: 30, focused: false, told };
  const attention = new Attention({
    idleSeconds: () => state.idle,
    ownFocused: () => state.focused,
    interrupted: (taskId) => told.push(taskId),
    everyMs: 100,
    graceMs: 1500,
    activeMs: 10_000,
  });
  return Object.assign(state, { attention });
}

describe("noticing her hand on the mouse or keyboard while VENOM works", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("tells the cloud once when she uses the computer between VENOM's moves", () => {
    const state = desk();
    state.attention.started("job", false);
    state.attention.finished("job", false);
    vi.advanceTimersByTime(2000);
    expect(state.told).toEqual([]);
    state.idle = 0;
    vi.advanceTimersByTime(300);
    expect(state.told).toEqual(["job"]);
    vi.advanceTimersByTime(3000);
    expect(state.told).toEqual(["job"]);
    state.attention.stop();
  });

  it("does not mistake VENOM's own clicks and typing for her hand", () => {
    const state = desk();
    state.attention.started("job", false);
    vi.advanceTimersByTime(2000);
    state.attention.started("job", true);
    state.idle = 0;
    vi.advanceTimersByTime(1000);
    state.attention.finished("job", true);
    vi.advanceTimersByTime(1000);
    expect(state.told).toEqual([]);
    state.idle = 1;
    vi.advanceTimersByTime(1000);
    expect(state.told).toEqual([]);
    state.attention.stop();
  });

  it("ignores her typing in VENOM's own window, such as guidance in the chat", () => {
    const state = desk();
    state.attention.started("job", false);
    vi.advanceTimersByTime(2000);
    state.focused = true;
    state.idle = 0;
    vi.advanceTimersByTime(1000);
    expect(state.told).toEqual([]);
    state.attention.stop();
  });

  it("watches again after she says continue, and stops watching when the job goes quiet", () => {
    const state = desk();
    state.attention.started("job", false);
    vi.advanceTimersByTime(2000);
    state.idle = 0;
    vi.advanceTimersByTime(200);
    expect(state.told).toEqual(["job"]);
    state.attention.started("job", false);
    vi.advanceTimersByTime(1000);
    expect(state.told).toEqual(["job"]);
    vi.advanceTimersByTime(1000);
    expect(state.told).toEqual(["job", "job"]);
    state.idle = 30;
    vi.advanceTimersByTime(20_000);
    expect(vi.getTimerCount()).toBe(0);
  });
});
