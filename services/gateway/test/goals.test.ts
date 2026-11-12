import { Observation, Task, TaskMove, TaskMoves, type DeviceSession, type GatewayEvent, type MessageEvent, type MoveEvent, type NextMove, type ScreenMark, type TaskEvent } from "@venom/contracts";
import { encode } from "jpeg-js";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { thumbnailOf } from "../src/thumbnail.ts";
import { handToLoop, movesWith, type MoveScript } from "../src/testing.ts";
import { actingDevice, type ActingDevice, type Screen } from "./acting-device.ts";
import { call, createEnvironment, destroyEnvironment, drillMs, signUpOverHttp, startGateway, type Environment, type RunningGateway } from "./harness.ts";

let environment: Environment;
let gateway: RunningGateway;
let accounts = 0;
const opened: ActingDevice[] = [];

function picture(width: number, height: number): string {
  const data = Buffer.alloc(width * height * 4);
  for (let at = 0; at < width * height; at += 1) {
    data[at * 4] = (at * 7) % 256;
    data[at * 4 + 1] = (at * 13) % 256;
    data[at * 4 + 2] = (at * 29) % 256;
    data[at * 4 + 3] = 255;
  }
  return encode({ data, width, height }, 90).data.toString("base64");
}

const screenPicture = picture(1280, 800);

const marks: ScreenMark[] = [
  { id: 1, kind: "text", name: "Text editor", editable: true, password: false, box: { x: 10, y: 80, width: 1200, height: 600 } },
  { id: 2, kind: "link", name: "Log in", editable: false, password: false, box: { x: 1100, y: 10, width: 60, height: 20 } },
  { id: 3, kind: "box", name: "Password", editable: true, password: true, box: { x: 400, y: 300, width: 300, height: 30 } },
];

const notepad: Screen = {
  look: () => Observation.parse({ picture: screenPicture, width: 1280, height: 800, window: "Untitled - Notepad", app: "Notepad", marks, focused: 1 }),
};

const typing: NextMove = {
  seen: "Notepad is open and the text editor is empty.",
  next: { kind: "move", intent: "Type the shopping list into the text editor", effects: [], move: { name: "type", text: "Milk, bread, eggs", mark: 1, enter: false } },
};

const opening: NextMove = {
  seen: "The desktop is showing.",
  next: { kind: "move", intent: "Open Notepad", effects: [], move: { name: "open", app: "Notepad", open: null } },
};

const signingIn: NextMove = {
  seen: "Wikipedia is open.",
  next: { kind: "move", intent: "Click Log in", effects: [], move: { name: "click", mark: 2, point: null, double: false } },
};

const password: NextMove = {
  seen: "A sign in page asks for a password.",
  next: { kind: "move", intent: "Type the password", effects: [], move: { name: "type", text: "secret", mark: 3, enter: false } },
};

const waiting: NextMove = { seen: "The page is loading.", next: { kind: "move", intent: "Wait for the page", effects: [], move: { name: "pause", seconds: 1 } } };

const longWait: NextMove = { seen: "The page is loading.", next: { kind: "move", intent: "Wait for the page", effects: [], move: { name: "pause", seconds: 10 } } };

const finished: NextMove = { seen: "The list is in Notepad.", next: { kind: "done", answer: "Your shopping list is in Notepad." } };

beforeAll(async () => {
  environment = await createEnvironment();
  gateway = await startGateway(environment, { commandGraceMs: 2000, loopLimits: { retryMs: 10 } });
  gateway.brain.script = handToLoop;
});

afterEach(() => {
  gateway.brain.mover = movesWith([finished]);
  for (const device of opened.splice(0)) {
    device.close();
  }
});

afterAll(async () => {
  await gateway?.stop();
  await destroyEnvironment(environment);
});

async function account(screen: Screen = notepad): Promise<{ readonly here: DeviceSession; readonly near: ActingDevice }> {
  accounts += 1;
  const here = await signUpOverHttp(gateway.base, environment.mailer, `goals-${accounts}@venom.test`, "goals secret word");
  const response = await call(gateway.base, "PUT", "/v1/devices/current/capabilities", {
    token: here.device_token,
    body: { device_id: here.device.id, capabilities: { ...here.device.capabilities, screen_control: true } },
  });
  expect(response.status).toBe(200);
  const near = await actingDevice(gateway.base, here, { screen });
  opened.push(near);
  return { here, near };
}

async function say(session: DeviceSession, text: string): Promise<string> {
  const response = await call(gateway.base, "POST", "/v1/messages", { token: session.device_token, body: { text } });
  expect(response.status).toBe(202);
  return ((await response.json()) as { request_id: string }).request_id;
}

function venom(kind: MessageEvent["message"]["kind"], starts: string) {
  return (event: GatewayEvent): event is MessageEvent =>
    event.type === "message" && event.message.speaker === "venom" && event.message.kind === kind && event.message.text.startsWith(starts);
}

function answered(requestId: string) {
  return (event: GatewayEvent): event is MessageEvent => event.type === "message" && event.message.speaker === "venom" && event.request_id === requestId;
}

function goal(status: Task["status"]) {
  return (event: GatewayEvent): event is TaskEvent => event.type === "task" && event.task.kind === "goal" && event.task.status === status;
}

function moved(status: TaskMove["status"]) {
  return (event: GatewayEvent): event is MoveEvent => event.type === "move" && event.move.status === status;
}

function once(choices: readonly NextMove[], hold: Promise<void>): MoveScript {
  const script = movesWith(choices);
  let first = true;
  return async (request) => {
    if (first) {
      first = false;
      await hold;
    }
    return script(request);
  };
}

describe("Definition of done 1: a goal is reached one move at a time", () => {
  it("starts at once, looks, moves, looks again, and says Done with the moves counted", async () => {
    gateway.brain.mover = movesWith([opening, typing, finished]);
    const { here, near } = await account();
    await say(here, "Open Notepad and write a shopping list with milk, bread and eggs");

    const started = (await near.until(venom("report", "On it, buddy."))) as MessageEvent;
    expect(started.message.task_id).not.toBeNull();
    const done = (await near.until(venom("report", "Done."))) as MessageEvent;
    expect(done.message.text).toBe('Done. Your shopping list is in Notepad. (2 moves on "Open Notepad and write a shopping list with milk, bread and eggs".)');
    const completed = (await near.until(goal("completed"))) as TaskEvent;
    expect(completed.task).toMatchObject({ moves: 2, plan: [], result: "Done. Your shopping list is in Notepad." });

    expect(near.looks).toHaveLength(3);
    expect(near.moves.map((command) => [command.move.name, command.confirmed])).toEqual([["open", false], ["type", false]]);
    expect(gateway.brain.moves.slice(-3).map((request) => request.moves.map((past) => `${past.intent}: ${past.outcome}`))).toEqual([
      [],
      ["Open Notepad: done"],
      ["Open Notepad: done", "Type the shopping list into the text editor: done"],
    ]);
    const reports = near.events.filter(venom("report", "")).map((event) => event.message.text);
    expect(reports).toEqual([started.message.text, done.message.text]);
    const listed = await call(gateway.base, "GET", `/v1/tasks/${completed.task.id}/moves`, { token: here.device_token });
    expect(listed.status).toBe(200);
    expect(TaskMoves.parse(await listed.json()).moves.map((move) => [move.number, move.intent, move.status, move.detail])).toEqual([
      [1, "Open Notepad", "done", "Did open."],
      [2, "Type the shopping list into the text editor", "done", "Did type."],
    ]);
    const pictures = near.events.filter((event): event is MoveEvent => event.type === "move" && event.picture !== null);
    expect(pictures.length).toBeGreaterThanOrEqual(2);
  });
});

describe("Definition of done 5 and 6: sensitive moves ask, password boxes are refused", () => {
  it("asks in the chat before a sign in, and a typed yes sends the move as confirmed", async () => {
    gateway.brain.mover = movesWith([signingIn, finished]);
    const { here, near } = await account();
    await say(here, "Log in to Wikipedia");

    const question = (await near.until(venom("question", "Quick check, buddy."))) as MessageEvent;
    expect(question.message.move_id).not.toBeNull();
    expect(question.message.text).toContain('It presses the link named "Log in".');
    expect(question.message.text).toContain("Next I would click Log in on ");
    expect(near.moves).toHaveLength(0);

    const yes = await say(here, "yes");
    expect(((await near.until(answered(yes))) as MessageEvent).message.text).toBe("Okay, doing it now.");
    await near.until(goal("completed"));
    expect(near.moves.map((command) => command.confirmed)).toEqual([true]);
  });

  it("a no cancels the goal and nothing is clicked", async () => {
    gateway.brain.mover = movesWith([signingIn, finished]);
    const { here, near } = await account();
    await say(here, "Log in to Wikipedia");
    await near.until(venom("question", "Quick check, buddy."));

    const no = await say(here, "no");
    expect(((await near.until(answered(no))) as MessageEvent).message.text).toBe('Okay, I did not do it, and I stopped working on "Log in to Wikipedia".');
    await near.until(goal("cancelled"));
    await near.until(moved("declined"));
    expect(near.moves).toHaveLength(0);
  });

  it("never types into a password box, says so and waits for her word", async () => {
    gateway.brain.mover = movesWith([password, finished]);
    const { here, near } = await account();
    await say(here, "Sign in to my bank");

    const refused = (await near.until(venom("report", "VENOM never types into a password box."))) as MessageEvent;
    expect(refused.message.text).toContain("Say no if you want me to stop here.");
    await near.until(goal("awaiting_confirmation"));
    const no = await say(here, "no");
    expect(((await near.until(answered(no))) as MessageEvent).message.text).toBe('Okay, I stopped working on "Sign in to my bank" there.');
    await near.until(goal("cancelled"));
    expect(near.moves).toHaveLength(0);
  });

  it("asks again before a click on a spot it cannot read", async () => {
    gateway.brain.mover = movesWith([{ seen: "A page.", next: { kind: "move", intent: "Click the corner", effects: [], move: { name: "click", mark: null, point: { x: 5, y: 790 }, double: false } } }, finished]);
    const { here, near } = await account();
    await say(here, "Click the corner");
    const question = (await near.until(venom("question", "Quick check, buddy."))) as MessageEvent;
    expect(question.message.text).toContain("VENOM cannot read what is at the spot it would click, so it asks first.");
    expect(near.spots.map((command) => command.point)).toEqual([{ x: 5, y: 790 }]);
  });
});

describe("Definition of done 4: guidance while it works reaches the next move", () => {
  it("takes what she types into the next turn", async () => {
    let release = () => {};
    gateway.brain.mover = once([waiting, finished], new Promise<void>((resolve) => (release = resolve)));
    const { here, near } = await account();
    await say(here, "Find the search box");
    await near.until((event) => event.type === "task" && event.task.kind === "goal");
    while (gateway.brain.moves.length === 0 || near.looks.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const guided = await say(here, "use the search box instead");
    expect(((await near.until(answered(guided))) as MessageEvent).message.text).toBe("Got it. I will use that in my next move.");
    release();
    await near.until(goal("completed"));
    expect(gateway.brain.moves.at(-1)?.guidance).toEqual(["use the search box instead"]);
  });

  it("passes on her answer when VENOM asks her something", async () => {
    gateway.brain.mover = movesWith([{ seen: "Two accounts are signed in.", next: { kind: "ask", question: "Which account should I use, the first or the second?" } }, finished]);
    const { here, near } = await account();
    await say(here, "Open my LinkedIn");
    await near.until(venom("report", "Which account should I use"));
    const reply = await say(here, "the second one");
    expect(((await near.until(answered(reply))) as MessageEvent).message.text).toBe("Okay, carrying on.");
    await near.until(goal("completed"));
    expect(gateway.brain.moves.at(-1)?.guidance).toEqual(["the second one"]);
  });
});

describe("Definition of done 7 and 8: stop wins, and long goals ask to keep going", () => {
  it("stops between moves at once and records the move as stopped", async () => {
    gateway.brain.mover = movesWith([longWait, finished]);
    const { here, near } = await account();
    await say(here, "Wait for the slow page");
    while (near.moves.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await say(here, "stop");
    await near.until(goal("stopped"));
    await near.until(moved("stopped"));
    const looks = near.looks.length;
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(near.looks).toHaveLength(looks);
    expect(near.stops).toHaveLength(1);
  });

  it("pauses after the move limit and carries on after a yes", async () => {
    const limited = await startGateway(environment, { commandGraceMs: 2000, loopLimits: { moves: 2, retryMs: 10 } });
    limited.brain.script = handToLoop;
    limited.brain.mover = movesWith([waiting, waiting, waiting, finished]);
    accounts += 1;
    const here = await signUpOverHttp(limited.base, environment.mailer, `goals-${accounts}@venom.test`, "goals secret word");
    await call(limited.base, "PUT", "/v1/devices/current/capabilities", {
      token: here.device_token,
      body: { device_id: here.device.id, capabilities: { ...here.device.capabilities, screen_control: true } },
    });
    const near = await actingDevice(limited.base, here, { screen: notepad, speed: 20 });
    try {
      await call(limited.base, "POST", "/v1/messages", { token: here.device_token, body: { text: "Keep waiting" } });
      const paused = (await near.until(venom("report", "I have made 2 moves"))) as MessageEvent;
      expect(paused.message.text).toContain("Say yes for 2 more, or no to stop here.");
      await call(limited.base, "POST", "/v1/messages", { token: here.device_token, body: { text: "yes" } });
      const done = (await near.until(goal("completed"))) as TaskEvent;
      expect(done.task.moves).toBe(3);
    } finally {
      near.close();
      await limited.stop();
    }
  }, drillMs);
});

describe("the computer's answers come back on their own routes", () => {
  it("refuses a look or a spot nobody is waiting for", async () => {
    const { here } = await account();
    const look = await call(gateway.base, "POST", "/v1/commands/observation", {
      token: here.device_token,
      body: { command_id: "0199d2a0-7c1e-7a3b-9f2d-1a2b3c4d5e99", observation: notepad.look(1) },
    });
    expect(look.status).toBe(404);
    const spot = await call(gateway.base, "POST", "/v1/commands/spot", { token: here.device_token, body: { command_id: "0199d2a0-7c1e-7a3b-9f2d-1a2b3c4d5e99", spot: null } });
    expect(spot.status).toBe(404);
  });

  it("lists the moves of a goal only for its own account", async () => {
    const { here } = await account();
    const { here: stranger } = await account();
    const task = await gateway.goals.begin({ id: here.device.id, account_id: here.device.account_id }, here.device.id, "Open Notepad", "0199d2a0-7c1e-7a3b-9f2d-1a2b3c4d5e98");
    const own = await call(gateway.base, "GET", `/v1/tasks/${task.id}/moves`, { token: here.device_token });
    expect(TaskMoves.parse(await own.json())).toEqual({ moves: [] });
    const other = await call(gateway.base, "GET", `/v1/tasks/${task.id}/moves`, { token: stranger.device_token });
    expect(other.status).toBe(404);
    await gateway.goals.end(here.device.account_id, task.id, "cancelled", "Cleaned up after the test.", "0199d2a0-7c1e-7a3b-9f2d-1a2b3c4d5e97");
  });

  it("makes a small picture of the screen for the live view", () => {
    const small = thumbnailOf(screenPicture);
    expect(small).not.toBeNull();
    expect((small ?? "").length).toBeLessThan(screenPicture.length / 4);
    expect(thumbnailOf("bm90IGEgcGljdHVyZQ==")).toBeNull();
  });

  it("answers a move question through its own route", async () => {
    gateway.brain.mover = movesWith([signingIn, finished]);
    const { here, near } = await account();
    await say(here, "Log in to Wikipedia");
    const question = (await near.until(venom("question", "Quick check, buddy."))) as MessageEvent;
    const response = await call(gateway.base, "POST", `/v1/tasks/${question.message.task_id ?? ""}/moves/${question.message.move_id ?? ""}/confirmation`, {
      token: here.device_token,
      body: { decision: "approve" },
    });
    expect(response.status).toBe(200);
    expect(TaskMove.parse(await response.json()).status).toBe("running");
    await near.until(goal("completed"));
  });
});
