import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import { HandHelper, type HandMove, type HandResult } from "../src/main/hand-helper.ts";

const Mark = z.object({
  id: z.number().int(),
  kind: z.string(),
  name: z.string(),
  editable: z.boolean(),
  password: z.boolean(),
});

const Observation = z.object({
  picture: z.string().min(1),
  width: z.number().int(),
  height: z.number().int(),
  window: z.string(),
  marks: z.array(Mark),
  focused: z.number().int().nullable(),
});

type Seen = z.infer<typeof Observation>;

class Stopped extends Error {}

const helper = new HandHelper({
  script: fileURLToPath(new URL("../hands/venom-hands.ps1", import.meta.url)),
  log: (line) => console.log(`      helper said: ${line}`),
});

let folder = "";
let looks = 0;
let lastPicture = "";

function report(result: HandResult): HandResult {
  console.log(`      ${result.ok ? "ok" : "not ok"}: ${result.detail}`);
  if (!result.ok) {
    throw new Stopped(result.detail);
  }
  return result;
}

function windowOf(result: HandResult): number {
  const value = result.data["window"];
  if (typeof value !== "number") {
    throw new Stopped("The hands did not say which window opened.");
  }
  return value;
}

async function look(window: number, why: string): Promise<Seen> {
  console.log(`   look: ${why}`);
  const result = report(await helper.send({ op: "observe", window }, { timeoutMs: 60_000 }));
  const seen = Observation.parse(result.data["observation"]);
  looks += 1;
  lastPicture = join(folder, `look-${String(looks).padStart(2, "0")}.jpg`);
  await writeFile(lastPicture, Buffer.from(seen.picture, "base64"));
  console.log(`      saw "${seen.window}" with ${seen.marks.length} marks (picture ${lastPicture})`);
  return seen;
}

async function move(step: HandMove, intent: string): Promise<HandResult> {
  console.log(`   move: ${intent}`);
  return report(await helper.send({ op: "move", move: step }, { timeoutMs: 60_000 }));
}

function find(seen: Seen, name: string): z.infer<typeof Mark> | undefined {
  const wanted = name.toLowerCase();
  return seen.marks.find((mark) => mark.name.trim().toLowerCase() === wanted);
}

async function notepadPart(): Promise<void> {
  console.log("\n1. Notepad: look, find the place to type, click it by its number, type, press keys");
  const notepad = windowOf(report(await helper.send({ op: "open_app", app: "Notepad", open: null, task: "hands-move" })));
  const first = await look(notepad, "where can I type?");
  const box = first.marks.find((mark) => mark.editable);
  if (box === undefined) {
    throw new Stopped("I found no place to type in Notepad.");
  }
  console.log(`      the place to type is mark ${box.id}`);
  await move({ kind: "click", mark: box.id, point: null, double: false }, `click mark ${box.id}`);
  await move({ kind: "type", text: "Hello, I am VENOM. I looked at the screen, found the place to type and typed here.", mark: null, enter: true }, "type a line and press Enter");
  await move({ kind: "key", key: "ctrl+a" }, "press Ctrl+A to select everything");
  await move({ kind: "type", text: "VENOM can press keys too: this line replaced everything.", mark: null, enter: false }, "type over the selection");
  await look(notepad, "did it work?");
}

async function chromePart(): Promise<void> {
  console.log("\n2. Your Chrome: open Wikipedia, look, find Random article, click it, read the new title");
  const chrome = windowOf(report(await helper.send({ op: "open_app", app: "Chrome", open: "https://en.wikipedia.org/wiki/Main_Page", task: "hands-move" })));
  await sleep(2000);
  let seen = await look(chrome, "what is on the page?");
  if (find(seen, "Random article") === undefined && find(seen, "Main menu") === undefined) {
    await sleep(1500);
    seen = await look(chrome, "the page was still loading, looking again");
  }
  let random = find(seen, "Random article");
  if (random === undefined) {
    const menu = find(seen, "Main menu");
    if (menu === undefined) {
      console.log(`      names I saw: ${seen.marks.map((mark) => `${mark.id} "${mark.name}"`).join(", ")}`);
      throw new Stopped("I could not find Random article or Main menu on the page.");
    }
    await move({ kind: "click", mark: menu.id, point: null, double: false }, `Random article is hidden, so click mark ${menu.id} (Main menu)`);
    await sleep(800);
    seen = await look(chrome, "is Random article showing now?");
    random = find(seen, "Random article");
    if (random === undefined) {
      throw new Stopped("The menu opened, but I could not see Random article in it.");
    }
  }
  const before = seen.window;
  await move({ kind: "click", mark: random.id, point: null, double: false }, `click mark ${random.id} (Random article)`);
  let after = seen;
  for (let attempt = 0; attempt < 10 && after.window === before; attempt++) {
    await sleep(700);
    after = await look(chrome, "has the new page loaded?");
  }
  if (after.window === before) {
    throw new Stopped("The page never changed after the click.");
  }
  console.log(`      the random article is: ${after.window.replace(/ - Wikipedia.*$/, "")}`);
  await move({ kind: "scroll", direction: "down", steps: 4, mark: null }, "scroll down to read more");
  await sleep(600);
  await look(chrome, "after scrolling");
}

async function main(): Promise<void> {
  if (process.platform !== "win32") {
    console.log("VENOM's fingers work on Windows only.");
    process.exitCode = 1;
    return;
  }
  console.log("VENOM's eyes and fingers. Please do not touch the mouse or keyboard until it finishes.");
  try {
    const hello = await helper.start();
    folder = join(hello.work, "hands-move");
    await mkdir(folder, { recursive: true });
    await notepadPart();
    await chromePart();
    console.log(`\nDone: VENOM looked ${looks} times and every move worked.`);
    console.log("The last picture opens now. Close Notepad without saving when you are finished.");
    spawn("explorer.exe", [lastPicture], { detached: true, stdio: "ignore" }).unref();
  } catch (error) {
    console.log(`\nStopped here: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  } finally {
    helper.stop();
  }
}

await main();
