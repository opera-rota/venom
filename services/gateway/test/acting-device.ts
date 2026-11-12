import {
  CommandFrame,
  DeviceKeyEnrolled,
  GatewayEvent,
  LiveChallenge,
  type CommandOutcome,
  type DeviceAction,
  type DeviceSession,
  type MoveCommand,
  type Observation,
  type ObserveCommand,
  type RunStepCommand,
  type ScreenPoint,
  type ScreenSpot,
  type SpotCommand,
} from "@venom/contracts";
import { CommandGuard, liveChallengeText, newKeyPair, signText, type KeyPair } from "@venom/safety";
import { refusesMove, refusesUnconfirmed, unconfirmedScriptWords, type Seen } from "@venom/safety/device";
import { call } from "./harness.ts";

export interface Screen {
  look(count: number): Observation | null;
  spot?(point: ScreenPoint): ScreenSpot | null;
  move?(command: MoveCommand): { readonly outcome: CommandOutcome; readonly detail: string };
}

export interface Report {
  readonly stepId: string;
  readonly outcome: CommandOutcome;
  readonly at: number;
}

export interface ActingDevice {
  readonly events: GatewayEvent[];
  readonly reports: Report[];
  readonly stops: string[];
  readonly commands: RunStepCommand[];
  readonly looks: ObserveCommand[];
  readonly spots: SpotCommand[];
  readonly moves: MoveCommand[];
  readonly closed: Promise<number>;
  until(match: (event: GatewayEvent) => boolean): Promise<GatewayEvent>;
  reported(stepId: string): Promise<Report>;
  close(): void;
}

export async function enrollKey(base: string, session: DeviceSession, pair: KeyPair = newKeyPair()): Promise<{ readonly pair: KeyPair; readonly serverKey: string }> {
  const response = await call(base, "POST", "/v1/devices/current/key", { token: session.device_token, body: { public_key: pair.publicKey } });
  if (response.status !== 200) {
    throw new Error(`key enrollment failed with ${response.status}`);
  }
  return { pair, serverKey: DeviceKeyEnrolled.parse(await response.json()).server_key };
}

export async function liveHeaders(base: string, session: DeviceSession, pair: KeyPair): Promise<Record<string, string>> {
  const response = await call(base, "POST", "/v1/live/challenge", { token: session.device_token });
  const challenge = LiveChallenge.parse(await response.json());
  return {
    authorization: `Bearer ${session.device_token}`,
    "x-venom-challenge": challenge.challenge_id,
    "x-venom-signature": signText(pair, liveChallengeText(session.device.id, challenge.challenge_id, challenge.nonce)),
  };
}

export async function actingDevice(base: string, session: DeviceSession, { speed = 1, screen }: { readonly speed?: number; readonly screen?: Screen } = {}): Promise<ActingDevice> {
  const { pair, serverKey } = await enrollKey(base, session);
  const socket = new WebSocket(`${base.replace("http", "ws")}/v1/live`, { headers: await liveHeaders(base, session, pair) });
  const guard = new CommandGuard(serverKey, session.device.id);
  const events: GatewayEvent[] = [];
  const reports: Report[] = [];
  const stops: string[] = [];
  const commands: RunStepCommand[] = [];
  const looks: ObserveCommand[] = [];
  const spots: SpotCommand[] = [];
  const moves: MoveCommand[] = [];
  const waiters = new Set<() => void>();
  let seen: Seen = { marks: [], focused: null };
  let spotted: { readonly point: ScreenPoint; readonly spot: ScreenSpot | null } | null = null;
  let running: { readonly abort: AbortController; readonly taskId: string; readonly timer: NodeJS.Timeout } | null = null;
  let shut = false;

  const wake = () => {
    for (const check of [...waiters]) check();
  };

  async function report(commandId: string, stepId: string, outcome: CommandOutcome, detail: string, output: string | null = null): Promise<void> {
    if (shut) {
      return;
    }
    reports.push({ stepId, outcome, at: Date.now() });
    wake();
    await call(base, "POST", "/v1/commands/report", { token: session.device_token, body: { command_id: commandId, outcome, detail, output } });
  }

  async function chunk(commandId: string, sequence: number, text: string): Promise<void> {
    if (!shut) {
      await call(base, "POST", "/v1/commands/output", { token: session.device_token, body: { command_id: commandId, sequence, text } });
    }
  }

  function lasting(action: DeviceAction): number {
    return action.name === "wait" ? action.seconds * 1000 : 200;
  }

  function finished(action: DeviceAction): string {
    switch (action.name) {
      case "wait":
        return `Waited ${action.seconds} seconds.`;
      case "run_script":
        return "The script finished with exit code 0.";
      default:
        return `Did ${action.name.replace("_", " ")}.`;
    }
  }

  function observe(commandId: string, body: ObserveCommand): void {
    looks.push(body);
    wake();
    const observation = screen?.look(looks.length) ?? null;
    if (observation === null) {
      void report(commandId, body.task_id, "failed", "The screen could not be read.");
      return;
    }
    seen = { marks: observation.marks, focused: observation.focused };
    spotted = null;
    if (!shut) {
      void call(base, "POST", "/v1/commands/observation", { token: session.device_token, body: { command_id: commandId, observation } });
    }
  }

  function spot(commandId: string, body: SpotCommand): void {
    spots.push(body);
    wake();
    const read = screen?.spot?.(body.point) ?? null;
    spotted = { point: body.point, spot: read };
    if (!shut) {
      void call(base, "POST", "/v1/commands/spot", { token: session.device_token, body: { command_id: commandId, spot: read } });
    }
  }

  function move(commandId: string, body: MoveCommand): void {
    moves.push(body);
    wake();
    const { move: chosen } = body;
    const read = chosen.name === "click" && chosen.point !== null && spotted?.point.x === chosen.point.x && spotted.point.y === chosen.point.y ? spotted.spot : null;
    const refusal = refusesMove(chosen, seen, read, body.confirmed);
    if (refusal !== null) {
      void report(commandId, body.move_id, "refused", refusal);
      return;
    }
    const result = screen?.move?.(body) ?? { outcome: "done" as const, detail: `Did ${chosen.name}.` };
    const abort = new AbortController();
    const timer = setTimeout(() => {
      running = null;
      void report(commandId, body.move_id, result.outcome, result.detail);
    }, (chosen.name === "pause" ? chosen.seconds * 1000 : 100) / speed);
    running = { abort, taskId: body.task_id, timer };
    abort.signal.addEventListener("abort", () => {
      clearTimeout(timer);
      running = null;
      void report(commandId, body.move_id, "stopped", "Stopped before it finished.");
    });
  }

  function execute(frame: CommandFrame): void {
    const checked = guard.check(frame.command);
    if (!checked.ok) {
      return;
    }
    const { command_id, body } = checked.payload;
    if (body.kind === "stop") {
      stops.push(body.stop_id);
      if (body.task_id === null || body.task_id === running?.taskId) {
        running?.abort.abort();
      }
      wake();
      return;
    }
    switch (body.kind) {
      case "observe":
        observe(command_id, body);
        return;
      case "spot":
        spot(command_id, body);
        return;
      case "move":
        move(command_id, body);
        return;
      case "run_step":
        break;
    }
    commands.push(body);
    wake();
    if (refusesUnconfirmed(body)) {
      void report(command_id, body.step_id, "refused", unconfirmedScriptWords);
      return;
    }
    const { action } = body;
    const output = action.name === "run_script" ? `Running: ${action.purpose}\nAll good.` : null;
    if (action.name === "run_script") {
      void chunk(command_id, 0, `Running: ${action.purpose}\n`).then(() => chunk(command_id, 1, "All good."));
    }
    const abort = new AbortController();
    const started = Date.now();
    const timer = setTimeout(() => {
      running = null;
      void report(command_id, body.step_id, "done", finished(action), output);
    }, lasting(action) / speed);
    running = { abort, taskId: body.task_id, timer };
    abort.signal.addEventListener("abort", () => {
      clearTimeout(timer);
      running = null;
      const elapsed = Math.floor((Date.now() - started) / 1000);
      void report(command_id, body.step_id, "stopped", action.name === "wait" ? `Stopped after ${elapsed} of ${action.seconds} seconds.` : "Stopped before it finished.");
    });
  }

  socket.addEventListener("message", ({ data }) => {
    const raw: unknown = JSON.parse(String(data));
    const command = CommandFrame.safeParse(raw);
    if (command.success) {
      execute(command.data);
      return;
    }
    events.push(GatewayEvent.parse(raw));
    wake();
  });

  const closed = new Promise<number>((resolve) => socket.addEventListener("close", ({ code }) => resolve(code), { once: true }));
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("close", ({ code }) => reject(new Error(`live link closed with ${code}`)), { once: true });
  });

  function waitFor<T>(find: () => T | undefined): Promise<T> {
    return new Promise((resolve) => {
      const check = () => {
        const found = find();
        if (found !== undefined) {
          waiters.delete(check);
          resolve(found);
        }
      };
      waiters.add(check);
      check();
    });
  }

  return {
    events,
    reports,
    stops,
    commands,
    looks,
    spots,
    moves,
    closed,
    until: (match) => waitFor(() => events.find(match)),
    reported: (stepId) => waitFor(() => reports.find((entry) => entry.stepId === stepId)),
    close: () => {
      shut = true;
      if (running !== null) {
        clearTimeout(running.timer);
        running = null;
      }
      socket.close();
    },
  };
}
