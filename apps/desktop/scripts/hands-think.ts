import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { EngineId, MessageText, MoveReply, MoveRequest, Observation, type NextMove, type ScreenMove } from "@venom/contracts";
import { HandHelper } from "../src/main/hand-helper.ts";

const brainUrl = process.env["VENOM_BRAIN_URL"] ?? "http://127.0.0.1:4200";
const waitSeconds = 5;

function stamp(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
}

function described(move: ScreenMove, seen: Observation): string {
  const named = (mark: number | null) => {
    if (mark === null) {
      return "where the keyboard is";
    }
    const found = seen.marks[mark - 1];
    return found === undefined ? `mark ${mark}` : `mark ${mark} (${found.kind} "${found.name}")`;
  };
  switch (move.name) {
    case "click":
      return `${move.double ? "double click" : "click"} ${move.mark !== null ? named(move.mark) : `the point ${move.point?.x},${move.point?.y}`}`;
    case "type":
      return `type ${JSON.stringify(move.text)} into ${named(move.mark)}${move.enter ? ", then press Enter" : ""}`;
    case "key":
      return `press ${move.key}`;
    case "scroll":
      return `scroll ${move.direction} ${move.steps} steps${move.mark !== null ? ` over ${named(move.mark)}` : ""}`;
    case "open":
      return `open ${move.app}${move.open !== null ? ` with ${move.open}` : ""}`;
    case "pause":
      return `wait ${move.seconds} seconds`;
  }
}

function report(chosen: NextMove, seen: Observation): string[] {
  const lines = [`  VENOM sees:  ${chosen.seen}`];
  switch (chosen.next.kind) {
    case "move":
      lines.push(`  next move:   ${described(chosen.next.move, seen)}`);
      lines.push(`  because:     ${chosen.next.intent}`);
      lines.push(`  effects:     ${chosen.next.effects.length > 0 ? chosen.next.effects.join(", ") : "none"}`);
      break;
    case "ask":
      lines.push(`  VENOM would ask you: ${chosen.next.question}`);
      break;
    case "done":
      lines.push(`  VENOM thinks the goal is reached: ${chosen.next.answer}`);
      break;
    case "cannot":
      lines.push(`  VENOM says it cannot: ${chosen.next.reason}`);
      break;
  }
  return lines;
}

async function brainIsUp(): Promise<boolean> {
  try {
    return (await fetch(`${brainUrl}/healthz`, { signal: AbortSignal.timeout(3000) })).ok;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { engine: { type: "string", default: "turbo" } } });
  const goal = MessageText.safeParse(positionals.join(" "));
  const engine = EngineId.safeParse(values.engine);
  if (!goal.success || !engine.success) {
    console.log('Say the goal in quotes, for example:  pnpm hands:think "Open Notepad and write hello"');
    console.log(`Engines: ${EngineId.options.join(", ")} (default turbo).`);
    process.exitCode = 1;
    return;
  }
  if (process.platform !== "win32") {
    console.log("VENOM's eyes work on Windows only.");
    process.exitCode = 1;
    return;
  }
  if (!(await brainIsUp())) {
    console.log(`VENOM's brain is not running at ${brainUrl}. Start it in another terminal with: pnpm brain`);
    process.exitCode = 1;
    return;
  }

  const helper = new HandHelper({
    script: fileURLToPath(new URL("../hands/venom-hands.ps1", import.meta.url)),
    log: (line) => console.log(`  helper said: ${line}`),
  });
  try {
    console.log("VENOM thinks about one move.");
    console.log(`Goal: ${goal.data}`);
    console.log("Click the window VENOM should work in, then leave the mouse alone.\n");
    const hello = await helper.start();
    for (let left = waitSeconds; left > 0; left--) {
      console.log(`  looking in ${left}...`);
      await sleep(1000);
    }
    const looked = await helper.send({ op: "observe", window: null }, { timeoutMs: 60_000 });
    if (!looked.ok) {
      console.log(`\n  ${looked.detail}`);
      process.exitCode = 1;
      return;
    }
    const seen = Observation.parse(looked.data["observation"]);
    const folder = join(hello.work, "hands-think");
    await mkdir(folder, { recursive: true });
    const file = join(folder, `look-${stamp()}.jpg`);
    await writeFile(file, Buffer.from(seen.picture, "base64"));
    console.log(`\n  ${looked.detail}`);
    console.log(`  Asking the brain (engine ${engine.data})...\n`);

    const asked = MoveRequest.parse({
      request_id: randomUUID(),
      account_id: randomUUID(),
      engine: engine.data,
      goal: goal.data,
      moves: [],
      guidance: [],
      memories: [],
      observation: seen,
    });
    const started = performance.now();
    const response = await fetch(`${brainUrl}/v1/moves`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(asked),
      signal: AbortSignal.timeout(150_000),
    });
    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    if (!response.ok) {
      console.log(`  The brain refused the request (HTTP ${response.status}): ${await response.text()}`);
      process.exitCode = 1;
      return;
    }
    const reply = MoveReply.parse(await response.json());
    if (reply.type === "failed") {
      console.log(`  The brain could not choose a move (${reply.reason}): ${reply.detail}`);
      process.exitCode = 1;
      return;
    }
    for (const line of report(reply.next, seen)) {
      console.log(line);
    }
    console.log(`\n  model: ${reply.model}, thought for ${seconds}s, ${reply.usage.input_tokens} tokens in, ${reply.usage.output_tokens} out, cost ${(reply.usage.cost_micro_usd / 1_000_000).toFixed(6)} dollars`);
    console.log("  Nothing was clicked or typed. VENOM only said what it would do.");
    console.log(`  saved what VENOM saw: ${file}`);
    spawn("explorer.exe", [file], { detached: true, stdio: "ignore" }).unref();
  } finally {
    helper.stop();
  }
}

await main();
