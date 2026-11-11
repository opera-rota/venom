import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { z } from "zod";

const HelloLine = z.object({
  type: z.literal("hello"),
  version: z.number().int(),
  apps: z.array(z.string()),
  scripts: z.array(z.string()),
  sandbox: z.boolean(),
  screen: z.boolean(),
  work: z.string(),
});

const OutputLine = z.object({
  type: z.literal("output"),
  id: z.string(),
  text: z.string(),
});

const ResultLine = z.object({
  type: z.literal("result"),
  id: z.string().nullable(),
  ok: z.boolean(),
  detail: z.string(),
  data: z.record(z.string(), z.unknown()).nullable().transform((data) => data ?? {}),
});

const FatalLine = z.object({
  type: z.literal("fatal"),
  detail: z.string(),
});

const HelperLine = z.discriminatedUnion("type", [HelloLine, OutputLine, ResultLine, FatalLine]);

export type HandHello = Omit<z.infer<typeof HelloLine>, "type">;

export type ScriptLanguage = "powershell" | "python";

export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

export type HandMove =
  | { readonly kind: "click"; readonly mark: number | null; readonly point: ScreenPoint | null; readonly double: boolean }
  | { readonly kind: "type"; readonly text: string; readonly mark: number | null; readonly enter: boolean }
  | { readonly kind: "key"; readonly key: string }
  | { readonly kind: "scroll"; readonly direction: "up" | "down"; readonly steps: number; readonly mark: number | null };

export type HandRequest =
  | { readonly op: "ping" }
  | { readonly op: "open_app"; readonly app: string; readonly open: string | null; readonly task: string }
  | { readonly op: "type_text"; readonly window: number | null; readonly title: string | null; readonly text: string }
  | { readonly op: "click"; readonly window: number | null; readonly title: string | null; readonly on: string }
  | { readonly op: "screenshot"; readonly window: number | null; readonly task: string }
  | { readonly op: "run_script"; readonly language: ScriptLanguage; readonly code: string; readonly task: string; readonly timeout_seconds: number }
  | { readonly op: "describe"; readonly window: number }
  | { readonly op: "front" }
  | { readonly op: "spot"; readonly x: number; readonly y: number }
  | { readonly op: "observe"; readonly window: number | null; readonly desktop?: boolean }
  | { readonly op: "move"; readonly move: HandMove };

export interface HandResult {
  readonly ok: boolean;
  readonly stopped: boolean;
  readonly detail: string;
  readonly data: Readonly<Record<string, unknown>>;
}

export interface SendOptions {
  readonly signal?: AbortSignal;
  readonly onOutput?: (text: string) => void;
  readonly timeoutMs?: number;
}

export interface HandHelperOptions {
  readonly script: string;
  readonly powershell?: string;
  readonly startTimeoutMs?: number;
  readonly log?: (line: string) => void;
}

interface Pending {
  readonly id: string;
  readonly settle: (result: HandResult) => void;
  readonly onOutput: ((text: string) => void) | undefined;
}

interface Live {
  readonly child: ChildProcessWithoutNullStreams;
  readonly hello: Promise<HandHello>;
  pending: Pending | null;
  stderr: string;
}

const stderrLimit = 2000;

function windowsPowerShell(): string {
  return join(process.env["SystemRoot"] ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

function failed(detail: string): HandResult {
  return { ok: false, stopped: false, detail, data: {} };
}

const stoppedResult: HandResult = { ok: false, stopped: true, detail: "Stopped.", data: {} };

export class HandHelper {
  readonly #options: HandHelperOptions;
  #live: Live | null = null;
  #queue: Promise<unknown> = Promise.resolve();
  #counter = 0;

  constructor(options: HandHelperOptions) {
    this.#options = options;
  }

  get running(): boolean {
    return this.#live !== null;
  }

  start(): Promise<HandHello> {
    return this.#ensure().hello;
  }

  send(request: HandRequest, options: SendOptions = {}): Promise<HandResult> {
    const work = this.#queue.then(() => this.#exchange(request, options));
    this.#queue = work.catch(() => undefined);
    return work;
  }

  stop(): void {
    if (this.#live !== null) {
      this.#kill(this.#live);
    }
  }

  async #exchange(request: HandRequest, options: SendOptions): Promise<HandResult> {
    if (options.signal?.aborted === true) {
      return stoppedResult;
    }
    const live = this.#ensure();
    try {
      await live.hello;
    } catch (error) {
      return failed(error instanceof Error ? error.message : String(error));
    }
    if (this.#live !== live) {
      return failed("The hands stopped before they could start this action.");
    }
    const id = String(++this.#counter);
    return new Promise<HandResult>((resolve) => {
      let timer: NodeJS.Timeout | undefined;
      const settle = (result: HandResult) => {
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", onAbort);
        if (live.pending?.id === id) {
          live.pending = null;
        }
        resolve(result);
      };
      const onAbort = () => {
        this.#kill(live);
        settle(stoppedResult);
      };
      live.pending = { id, settle, onOutput: options.onOutput };
      options.signal?.addEventListener("abort", onAbort, { once: true });
      if (options.timeoutMs !== undefined) {
        timer = setTimeout(() => {
          this.#kill(live);
          settle(failed("The hands did not answer in time, so I stopped them."));
        }, options.timeoutMs);
      }
      live.child.stdin.write(`${JSON.stringify({ id, ...request })}\n`);
    });
  }

  #ensure(): Live {
    if (this.#live !== null) {
      return this.#live;
    }
    const child = spawn(
      this.#options.powershell ?? windowsPowerShell(),
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", this.#options.script],
      { stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
    );
    let greet: (hello: HandHello) => void = () => {};
    let refuse: (error: Error) => void = () => {};
    const hello = new Promise<HandHello>((resolve, reject) => {
      greet = resolve;
      refuse = reject;
    });
    hello.catch(() => {});
    const live: Live = { child, hello, pending: null, stderr: "" };
    this.#live = live;

    const startTimer = setTimeout(() => {
      refuse(new Error("The hands did not start within the time limit."));
      this.#kill(live);
    }, this.#options.startTimeoutMs ?? 60_000);

    child.stdin.on("error", () => {});
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      live.stderr = `${live.stderr}${chunk}`.slice(-stderrLimit);
    });

    createInterface({ input: child.stdout }).on("line", (raw) => {
      const line = this.#parse(raw);
      if (line === null) {
        return;
      }
      switch (line.type) {
        case "hello": {
          clearTimeout(startTimer);
          const { type: _type, ...rest } = line;
          greet(rest);
          return;
        }
        case "fatal":
          clearTimeout(startTimer);
          refuse(new Error(line.detail));
          return;
        case "output":
          if (live.pending?.id === line.id) {
            live.pending.onOutput?.(line.text);
          }
          return;
        case "result":
          if (live.pending !== null && live.pending.id === line.id) {
            live.pending.settle({ ok: line.ok, stopped: false, detail: line.detail, data: line.data });
          }
          return;
      }
    });

    child.on("error", (error) => {
      clearTimeout(startTimer);
      refuse(new Error(`The hands could not start: ${error.message}`));
      this.#closed(live);
    });
    child.on("exit", () => {
      clearTimeout(startTimer);
      const reason = live.stderr.trim().split(/\r?\n/).filter(Boolean).at(-1);
      refuse(new Error(reason === undefined ? "The hands stopped before they were ready." : `The hands stopped: ${reason}`));
      this.#closed(live);
    });
    return live;
  }

  #parse(raw: string): z.infer<typeof HelperLine> | null {
    const text = raw.trim();
    if (text.length === 0) {
      return null;
    }
    try {
      const parsed = HelperLine.safeParse(JSON.parse(text));
      if (parsed.success) {
        return parsed.data;
      }
    } catch {
      this.#options.log?.(text);
      return null;
    }
    this.#options.log?.(text);
    return null;
  }

  #closed(live: Live): void {
    if (this.#live === live) {
      this.#live = null;
    }
    const pending = live.pending;
    if (pending !== null) {
      const reason = live.stderr.trim().split(/\r?\n/).filter(Boolean).at(-1);
      pending.settle(failed(reason === undefined ? "The hands stopped unexpectedly." : `The hands stopped unexpectedly: ${reason}`));
    }
  }

  #kill(live: Live): void {
    if (this.#live === live) {
      this.#live = null;
    }
    if (live.child.exitCode === null && live.child.signalCode === null) {
      live.child.kill();
    }
  }
}
