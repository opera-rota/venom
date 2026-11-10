import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import { HandHelper } from "../src/main/hand-helper.ts";

const Mark = z.object({
  id: z.number().int(),
  kind: z.string(),
  name: z.string(),
  editable: z.boolean(),
  password: z.boolean(),
  box: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }),
});

const Observation = z.object({
  picture: z.string().min(1),
  width: z.number().int(),
  height: z.number().int(),
  window: z.string(),
  app: z.string(),
  marks: z.array(Mark),
  focused: z.number().int().nullable(),
});

const waitSeconds = 5;

function stamp(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
}

function describe(mark: z.infer<typeof Mark>, focused: number | null): string {
  const notes = [
    mark.editable ? "can type here" : null,
    mark.password ? "password box, VENOM never types here" : null,
    mark.id === focused ? "has the keyboard" : null,
  ].filter((note) => note !== null);
  const name = mark.name.length > 0 ? `"${mark.name}"` : "(no name)";
  return `  ${String(mark.id).padStart(3)}  ${mark.kind.padEnd(7)} ${name}${notes.length > 0 ? `  [${notes.join(", ")}]` : ""}`;
}

async function main(): Promise<void> {
  if (process.platform !== "win32") {
    console.log("VENOM's eyes work on Windows only.");
    process.exitCode = 1;
    return;
  }
  const helper = new HandHelper({
    script: fileURLToPath(new URL("../hands/venom-hands.ps1", import.meta.url)),
    log: (line) => console.log(`  helper said: ${line}`),
  });
  try {
    console.log("VENOM's eyes.");
    console.log("Click the window you want VENOM to look at (Chrome, Notepad, anything), then leave the mouse alone.\n");
    const hello = await helper.start();
    for (let left = waitSeconds; left > 0; left--) {
      console.log(`  looking in ${left}...`);
      await sleep(1000);
    }
    const started = performance.now();
    const result = await helper.send({ op: "observe", window: null }, { timeoutMs: 60_000 });
    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    if (!result.ok) {
      console.log(`\n  ${result.detail}`);
      process.exitCode = 1;
      return;
    }
    const seen = Observation.parse(result.data["observation"]);
    const folder = join(hello.work, "hands-look");
    await mkdir(folder, { recursive: true });
    const file = join(folder, `look-${stamp()}.jpg`);
    await writeFile(file, Buffer.from(seen.picture, "base64"));

    console.log(`\n  ${result.detail}`);
    console.log(`  window: ${seen.window.length > 0 ? `"${seen.window}"` : "(the desktop)"}${seen.app.length > 0 ? ` from ${seen.app}` : ""}`);
    console.log(`  picture: ${seen.width}x${seen.height}, ${Math.round((seen.picture.length * 3) / 4 / 1024)} KB, looked in ${seconds}s`);
    console.log(`  marks: ${seen.marks.length} of at most 60\n`);
    for (const mark of seen.marks) {
      console.log(describe(mark, seen.focused));
    }
    console.log(`\n  saved: ${file}`);
    console.log("  The picture opens now. The red numbers are what VENOM will point at when it clicks or types.");
    spawn("explorer.exe", [file], { detached: true, stdio: "ignore" }).unref();
  } finally {
    helper.stop();
  }
}

await main();
