import { execFileSync } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import { HandHelper, type HandHello, type HandResult } from "../src/main/hand-helper.ts";

type Verdict = "passed" | "failed" | "skipped";

interface Check {
  readonly name: string;
  readonly run: () => Promise<Verdict>;
}

const task = "hands-check";
const stopTask = "hands-check-stop";
const helper = new HandHelper({
  script: fileURLToPath(new URL("../hands/venom-hands.ps1", import.meta.url)),
  log: (line) => console.log(`      helper said: ${line}`),
});

const Observed = z.object({
  picture: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  marks: z.array(z.object({ id: z.number().int(), editable: z.boolean() })),
  focused: z.number().int().nullable(),
});

let hello: HandHello | null = null;
let notepad: number | null = null;

const page = [
  "<!doctype html>",
  '<html><head><meta charset="utf-8"><title>VENOM hands check</title></head>',
  '<body style="font-family: sans-serif; padding: 48px">',
  "<h1>VENOM hands check</h1>",
  "<button onclick=\"document.title = 'Hello from VENOM'; this.textContent = 'Hello received'\">Say hello</button>",
  '<div style="position: relative; margin-top: 24px"><button>Say hello</button><div style="position: absolute; inset: 0; background: white"></div></div>',
  "</body></html>",
].join("\n");

const sandboxScript = [
  '"Hello from the sandbox"',
  'Set-Content -Path allowed.txt -Value "VENOM can write here"',
  '"Wrote allowed.txt in the work folder"',
  '1..3 | ForEach-Object { "Counting $_"; Start-Sleep -Seconds 1 }',
  '$desktop = [Environment]::GetFolderPath("Desktop")',
  'try {',
  '  Set-Content -Path (Join-Path $desktop "venom-should-not-exist.txt") -Value "x" -ErrorAction Stop',
  '  "WROTE OUTSIDE"',
  '} catch {',
  '  "Windows refused the write outside: $($_.Exception.Message)"',
  '}',
].join("\r\n");

const tickScript = '1..60 | ForEach-Object { Add-Content -Path ticks.txt -Value "tick $_"; "tick $_"; Start-Sleep -Seconds 1 }';

function work(...parts: string[]): string {
  if (hello === null) {
    throw new Error("The hands are not started.");
  }
  return join(hello.work, ...parts);
}

function say(result: HandResult): void {
  console.log(`      ${result.stopped ? "stopped" : result.ok ? "ok" : "not ok"}: ${result.detail}`);
}

function windowOf(result: HandResult): number | null {
  const value = result.data["window"];
  return typeof value === "number" ? value : null;
}

function live(start: number): (text: string) => void {
  return (text) => {
    for (const line of text.split(/\r?\n/).filter((part) => part.trim().length > 0)) {
      console.log(`      ${((performance.now() - start) / 1000).toFixed(1).padStart(5)}s | ${line}`);
    }
  };
}

async function countTicks(): Promise<number> {
  try {
    return (await readFile(work(stopTask, "ticks.txt"), "utf8")).split(/\r?\n/).filter(Boolean).length;
  } catch {
    return 0;
  }
}

const checks: readonly Check[] = [
  {
    name: "Start the hands",
    run: async () => {
      const started = performance.now();
      hello = await helper.start();
      console.log(`      started in ${((performance.now() - started) / 1000).toFixed(1)}s`);
      console.log(`      apps it can open: ${hello.apps.length} (from your Start menu, plus File Explorer and Chrome)`);
      console.log(`      scripts: ${hello.scripts.join(", ")}`);
      console.log(`      screen: ${hello.screen ? "yes" : "no"}, sandbox: ${hello.sandbox ? "ready" : "not ready"}`);
      console.log(`      work folder: ${hello.work}`);
      return hello.screen && hello.sandbox ? "passed" : "failed";
    },
  },
  {
    name: "Open Notepad and wait until it is ready",
    run: async () => {
      const result = await helper.send({ op: "open_app", app: "Notepad", open: null, task });
      say(result);
      notepad = windowOf(result);
      return result.ok && notepad !== null ? "passed" : "failed";
    },
  },
  {
    name: "Type a shopping list into Notepad",
    run: async () => {
      if (notepad === null) {
        return "skipped";
      }
      const result = await helper.send({ op: "type_text", window: notepad, title: null, text: "Milk\nBread\nEggs\nGet-ChildItem $HOME\\Desktop | Sort-Object Length -Descending\n100% @ #1 & (a+b)=c; \"quotes\" 'single' ~`^ {x} [y] <z> é\nTyped by the VENOM hands check\n" });
      say(result);
      console.log(`      read back: ${String(result.data["verified"])}`);
      if (result.data["verified"] === "different") {
        console.log(`      what arrived (the end of it): ${JSON.stringify(String(result.data["arrived"] ?? ""))}`);
      }
      return result.ok && result.data["verified"] === "match" ? "passed" : "failed";
    },
  },
  {
    name: "Look at Notepad like VENOM does (picture and numbered marks)",
    run: async () => {
      if (notepad === null) {
        return "skipped";
      }
      const started = performance.now();
      const result = await helper.send({ op: "observe", window: notepad });
      say(result);
      const seen = Observed.safeParse(result.data["observation"]);
      if (!result.ok || !seen.success) {
        return "failed";
      }
      const { width, height, marks, focused, picture } = seen.data;
      const box = marks.find((mark) => mark.editable);
      console.log(`      looked in ${((performance.now() - started) / 1000).toFixed(1)}s: picture ${width}x${height} (${Math.round((picture.length * 3) / 4 / 1024)} KB), ${marks.length} marks`);
      console.log(`      the place to type: ${box === undefined ? "not found" : `mark ${box.id}`}, focused mark: ${focused ?? "none"}`);
      return width <= 1280 && marks.length > 0 && marks.length <= 60 && box !== undefined ? "passed" : "failed";
    },
  },
  {
    name: "Click the place to type by its number, then type and press keys",
    run: async () => {
      if (notepad === null) {
        return "skipped";
      }
      const looked = await helper.send({ op: "observe", window: notepad });
      const seen = Observed.safeParse(looked.data["observation"]);
      const box = seen.success ? seen.data.marks.find((mark) => mark.editable) : undefined;
      if (!looked.ok || box === undefined) {
        say(looked);
        return "failed";
      }
      const clicked = await helper.send({ op: "move", move: { kind: "click", mark: box.id, point: null, double: false } });
      say(clicked);
      const ended = await helper.send({ op: "move", move: { kind: "key", key: "end" } });
      say(ended);
      const typed = await helper.send({ op: "move", move: { kind: "type", text: " typed by mark", mark: null, enter: true } });
      say(typed);
      const refused = await helper.send({ op: "move", move: { kind: "key", key: "ctrl+alt+delete" } });
      say(refused);
      return clicked.ok && ended.ok && typed.ok && typed.data["verified"] === "match" && !refused.ok ? "passed" : "failed";
    },
  },
  {
    name: "Take a screenshot of Notepad",
    run: async () => {
      if (notepad === null) {
        return "skipped";
      }
      const result = await helper.send({ op: "screenshot", window: notepad, task });
      say(result);
      console.log(`      saved: ${String(result.data["path"])}`);
      return result.ok ? "passed" : "failed";
    },
  },
  {
    name: "Run a PowerShell script in the sandbox (output shows live)",
    run: async () => {
      const result = await helper.send({ op: "run_script", language: "powershell", code: sandboxScript, task, timeout_seconds: 60 }, { onOutput: live(performance.now()) });
      say(result);
      const output = String(result.data["output"] ?? "");
      const inside = await readFile(work(task, "allowed.txt"), "utf8").then(() => true, () => false);
      const kept = output.includes("Wrote allowed.txt") && inside;
      const refused = output.includes("Windows refused the write outside") && !output.includes("WROTE OUTSIDE");
      console.log(`      wrote inside the work folder: ${kept ? "yes" : "no"}, refused outside: ${refused ? "yes" : "no"}`);
      return !result.ok && result.data["refused_outside"] === true && kept && refused ? "passed" : "failed";
    },
  },
  {
    name: "Report an error the script tried to hide as not done",
    run: async () => {
      const outside = join(work(), "..", "outside-check.txt");
      await writeFile(outside, "VENOM hands check\n", "utf8");
      const code = [`Remove-Item -LiteralPath '${outside}' -Force -ErrorAction SilentlyContinue`, '"AFTER THE HIDDEN ERROR"'].join("\r\n");
      const result = await helper.send({ op: "run_script", language: "powershell", code, task, timeout_seconds: 60 }, { onOutput: live(performance.now()) });
      say(result);
      const kept = await readFile(outside, "utf8").then(() => true, () => false);
      await rm(outside, { force: true });
      console.log(`      reported as not done: ${result.ok ? "no" : "yes"}, the file outside is still there: ${kept ? "yes" : "no"}`);
      return !result.ok && kept ? "passed" : "failed";
    },
  },
  {
    name: "Try to delete a file on your real Desktop from the sandbox",
    run: async () => {
      const desktop = execFileSync("powershell.exe", ["-NoProfile", "-Command", "[Environment]::GetFolderPath('Desktop')"], { encoding: "utf8" }).trim();
      const target = join(desktop, "venom-hands-check-delete.txt");
      await writeFile(target, "VENOM hands check\n", "utf8");
      const code = [
        "$path = Join-Path ([Environment]::GetFolderPath('Desktop')) 'venom-hands-check-delete.txt'",
        "if (Test-Path -LiteralPath $path -PathType Leaf) { Remove-Item -LiteralPath $path -Force; 'DELETED' } else { 'NOT FOUND' }",
      ].join("\r\n");
      const started = performance.now();
      const result = await helper.send({ op: "run_script", language: "powershell", code, task, timeout_seconds: 30 }, { onOutput: live(started) });
      const seconds = (performance.now() - started) / 1000;
      say(result);
      const kept = await readFile(target, "utf8").then(() => true, () => false);
      await rm(target, { force: true });
      console.log(`      answered in ${seconds.toFixed(1)}s, reported as not done: ${result.ok ? "no" : "yes"}, the Desktop file is still there: ${kept ? "yes" : "no"}`);
      return !result.ok && kept && seconds < 20 ? "passed" : "failed";
    },
  },
  {
    name: "Run a Python script in the sandbox",
    run: async () => {
      if (hello?.scripts.includes("python") !== true) {
        console.log("      Python was not found on this computer.");
        return "skipped";
      }
      const code = 'import pathlib, sys\nprint("Python", sys.version.split()[0], "in", pathlib.Path.cwd())\n';
      const result = await helper.send({ op: "run_script", language: "python", code, task, timeout_seconds: 60 }, { onOutput: live(performance.now()) });
      say(result);
      return result.ok ? "passed" : "failed";
    },
  },
  {
    name: "Report a PowerShell script that hits an error as failed",
    run: async () => {
      const code = ['Remove-Item -Path (Join-Path $PWD "venom-missing-file.txt")', '"AFTER THE ERROR"'].join("\r\n");
      const result = await helper.send({ op: "run_script", language: "powershell", code, task, timeout_seconds: 60 }, { onOutput: live(performance.now()) });
      say(result);
      const output = String(result.data["output"] ?? "");
      const halted = output.includes("venom-missing-file.txt") && !output.includes("AFTER THE ERROR");
      console.log(`      reported as failed: ${result.ok ? "no" : "yes"}, stopped at the error: ${halted ? "yes" : "no"}`);
      return !result.ok && halted ? "passed" : "failed";
    },
  },
  {
    name: "Open the work folder in File Explorer",
    run: async () => {
      const result = await helper.send({ op: "open_app", app: "File Explorer", open: work(task), task });
      say(result);
      return result.ok ? "passed" : "failed";
    },
  },
  {
    name: "Open Calculator from the Start menu and press Seven",
    run: async () => {
      if (hello?.apps.includes("Calculator") !== true) {
        console.log("      Calculator is not in this computer's Start menu.");
        return "skipped";
      }
      const opened = await helper.send({ op: "open_app", app: "Calculator", open: null, task });
      say(opened);
      const calculator = windowOf(opened);
      if (!opened.ok || calculator === null) {
        return "failed";
      }
      const pressed = await helper.send({ op: "click", window: calculator, title: null, on: "Seven" });
      say(pressed);
      return pressed.ok ? "passed" : "failed";
    },
  },
  {
    name: "Open Chrome on a test page and click Say hello",
    run: async () => {
      if (hello?.apps.includes("Chrome") !== true) {
        console.log("      Chrome was not found on this computer.");
        return "skipped";
      }
      const file = work(task, "page.html");
      await writeFile(file, page, "utf8");
      const opened = await helper.send({ op: "open_app", app: "Chrome", open: file, task });
      say(opened);
      const chrome = windowOf(opened);
      if (!opened.ok || chrome === null) {
        return "failed";
      }
      const clicked = await helper.send({ op: "click", window: chrome, title: null, on: "the Say hello button" });
      say(clicked);
      for (let attempt = 0; attempt < 20; attempt++) {
        const described = await helper.send({ op: "describe", window: chrome });
        if (described.detail.includes("Hello from VENOM")) {
          console.log(`      the page title changed to: ${described.detail}`);
          return clicked.ok ? "passed" : "failed";
        }
        await sleep(250);
      }
      console.log("      the page title never changed, so the click did not reach the page");
      return "failed";
    },
  },
  {
    name: "Stop a long script at once",
    run: async () => {
      const controller = new AbortController();
      const started = performance.now();
      let stopAt = 0;
      setTimeout(() => {
        stopAt = performance.now();
        controller.abort();
      }, 3500);
      const result = await helper.send({ op: "run_script", language: "powershell", code: tickScript, task: stopTask, timeout_seconds: 120 }, { signal: controller.signal, onOutput: live(started) });
      const stoppedIn = performance.now() - stopAt;
      say(result);
      const before = await countTicks();
      await sleep(3000);
      const after = await countTicks();
      console.log(`      stopped in ${Math.round(stoppedIn)} ms; ticks right after the stop: ${before}, three seconds later: ${after}`);
      const again = await helper.send({ op: "ping" });
      console.log(`      hands restarted after the stop: ${again.ok ? "yes" : "no"}`);
      return result.stopped && stoppedIn < 2000 && before === after && again.ok ? "passed" : "failed";
    },
  },
];

async function main(): Promise<void> {
  if (process.platform !== "win32") {
    console.log("The hands check runs on Windows only.");
    process.exitCode = 1;
    return;
  }
  console.log("VENOM hands check. Please do not touch the mouse or keyboard until it finishes.\n");
  const verdicts: Verdict[] = [];
  for (const [index, check] of checks.entries()) {
    console.log(`${index + 1}. ${check.name}`);
    let verdict: Verdict;
    try {
      verdict = await check.run();
    } catch (error) {
      console.log(`      problem: ${error instanceof Error ? error.message : String(error)}`);
      verdict = "failed";
    }
    verdicts.push(verdict);
    console.log(`   ${verdict.toUpperCase()}\n`);
    if (index === 0 && verdict === "failed") {
      break;
    }
  }
  helper.stop();
  const passed = verdicts.filter((verdict) => verdict === "passed").length;
  const skipped = verdicts.filter((verdict) => verdict === "skipped").length;
  console.log(`Hands check: ${passed} of ${checks.length} passed${skipped > 0 ? `, ${skipped} skipped` : ""}.`);
  console.log("Close Notepad without saving, and close the File Explorer, Calculator and Chrome windows it opened.");
  process.exitCode = passed + skipped === checks.length ? 0 : 1;
}

await main();
