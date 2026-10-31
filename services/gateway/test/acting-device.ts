import { CommandFrame, DeviceKeyEnrolled, GatewayEvent, LiveChallenge, type CommandOutcome, type DeviceSession } from "@venom/contracts";
import { CommandGuard, liveChallengeText, newKeyPair, signText, type KeyPair } from "@venom/safety";
import { call } from "./harness.ts";

export interface Report {
  readonly stepId: string;
  readonly outcome: CommandOutcome;
  readonly at: number;
}

export interface ActingDevice {
  readonly events: GatewayEvent[];
  readonly reports: Report[];
  readonly stops: string[];
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

export async function actingDevice(base: string, session: DeviceSession): Promise<ActingDevice> {
  const { pair, serverKey } = await enrollKey(base, session);
  const socket = new WebSocket(`${base.replace("http", "ws")}/v1/live`, { headers: await liveHeaders(base, session, pair) });
  const guard = new CommandGuard(serverKey, session.device.id);
  const events: GatewayEvent[] = [];
  const reports: Report[] = [];
  const stops: string[] = [];
  const waiters = new Set<() => void>();
  let running: { readonly abort: AbortController; readonly started: number } | null = null;

  const wake = () => {
    for (const check of [...waiters]) check();
  };

  async function report(commandId: string, stepId: string, outcome: CommandOutcome, detail: string): Promise<void> {
    reports.push({ stepId, outcome, at: Date.now() });
    wake();
    await call(base, "POST", "/v1/commands/report", { token: session.device_token, body: { command_id: commandId, outcome, detail } });
  }

  function execute(frame: CommandFrame): void {
    const checked = guard.check(frame.command);
    if (!checked.ok) {
      return;
    }
    const { command_id, body } = checked.payload;
    if (body.kind === "stop") {
      stops.push(body.stop_id);
      running?.abort.abort();
      wake();
      return;
    }
    const abort = new AbortController();
    const started = Date.now();
    running = { abort, started };
    const timer = setTimeout(() => {
      running = null;
      void report(command_id, body.step_id, "done", `Waited ${body.action.seconds} seconds.`);
    }, body.action.seconds * 1000);
    abort.signal.addEventListener("abort", () => {
      clearTimeout(timer);
      running = null;
      const elapsed = Math.floor((Date.now() - started) / 1000);
      void report(command_id, body.step_id, "stopped", `Stopped after ${elapsed} of ${body.action.seconds} seconds.`);
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
    closed,
    until: (match) => waitFor(() => events.find(match)),
    reported: (stepId) => waitFor(() => reports.find((entry) => entry.stepId === stepId)),
    close: () => socket.close(),
  };
}
