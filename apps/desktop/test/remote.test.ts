import type { Device, Task, TaskMove } from "@venom/contracts";
import { describe, expect, it } from "vitest";
import { controllerWords } from "../src/renderer/src/live-screen.ts";
import { heldFor, pictureBox, scrollSteps, spotIn } from "../src/renderer/src/remote.ts";

const laptop = "0199d2a0-7c1e-7a3b-9f2d-1a2b3c4d5e02";

const job: Task = {
  id: "0199d2a0-7c1e-7a3b-9f2d-1a2b3c4d5e60",
  account_id: "0199d2a0-7c1e-7a3b-9f2d-1a2b3c4d5e01",
  origin_device_id: laptop,
  target_device_id: laptop,
  request_text: "Write a shopping list in Notepad",
  kind: "goal",
  plan: [],
  status: "awaiting_confirmation",
  progress: { done: 0, counted: 0, skipped: 0, ignored: 0, total: 0, percent: 0 },
  moves: 1,
  result: null,
  created_at: "2026-11-28T10:00:00.000Z",
  updated_at: "2026-11-28T10:00:05.000Z",
};

function move(status: TaskMove["status"]): TaskMove {
  return {
    id: "0199d2a0-7c1e-7a3b-9f2d-1a2b3c4d5e71",
    task_id: job.id,
    number: 1,
    intent: "Wait for Notepad",
    seen: "Notepad is opening.",
    move: { name: "pause", seconds: 1 },
    effects: [],
    status,
    detail: null,
    created_at: "2026-11-28T10:00:01.000Z",
    finished_at: null,
  };
}

describe("Remote: turning her touch into a spot on the computer", () => {
  it("finds the picture inside a letterboxed video and turns a touch into a share of the screen", () => {
    const box = pictureBox({ left: 0, top: 0, width: 400, height: 400 }, 1920, 1080);
    expect(box).toEqual({ left: 0, top: 87.5, width: 400, height: 225 });
    expect(spotIn(box, 200, 200)).toEqual({ x: 0.5, y: 0.5 });
    expect(spotIn(box, 100, 143.75)).toEqual({ x: 0.25, y: 0.25 });
    expect(spotIn(box, 200, 40)).toBeNull();
    expect(pictureBox({ left: 5, top: 5, width: 300, height: 200 }, 0, 0)).toEqual({ left: 5, top: 5, width: 300, height: 200 });
  });

  it("turns a drag into a scroll the way a phone does, and ignores a tiny one", () => {
    expect(scrollSteps(20)).toBeNull();
    expect(scrollSteps(-100)).toEqual({ direction: "down", steps: 2 });
    expect(scrollSteps(150)).toEqual({ direction: "up", steps: 3 });
    expect(scrollSteps(-5000)).toEqual({ direction: "down", steps: 10 });
  });

  it("offers Carry on only while VENOM's job on that computer waits for her, and not while it asks a question", () => {
    expect(heldFor(job, [move("done")], laptop)).toBe(true);
    expect(heldFor(job, [move("asking")], laptop)).toBe(false);
    expect(heldFor({ ...job, status: "running" }, [], laptop)).toBe(false);
    expect(heldFor(job, [], "0199d2a0-7c1e-7a3b-9f2d-1a2b3c4d5e09")).toBe(false);
    expect(heldFor(null, [], laptop)).toBe(false);
  });

  it("names the device in control on the computer", () => {
    expect(controllerWords([])).toBeNull();
    expect(controllerWords([{ name: "Android phone (SM-G950U1)" } as Device])).toBe("Controlled from Android phone (SM-G950U1)");
  });
});
