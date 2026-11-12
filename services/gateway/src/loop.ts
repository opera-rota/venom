import {
  MoveRequest,
  screenLimits,
  type CommandBody,
  type CommandOutcome,
  type CommandReport,
  type Device,
  type EngineId,
  type MakeMove,
  type MemoryContext,
  type MoveOutcome,
  type MoveReply,
  type Observation,
  type ObservationReport,
  type PowerStatus,
  type ScreenMove,
  type ScreenPoint,
  type ScreenSpot,
  type SpotReport,
  type Task,
  type TaskMove,
  type Thumbnail,
  type TokenUsage,
} from "@venom/contracts";
import type { DeviceRef } from "@venom/db";
import type { Identity } from "@venom/identity";
import { addUsage, nothingUsed, type Memory } from "@venom/memory";
import { PowerError, type Availability, type Power } from "@venom/power";
import { judgeMove, type CommandSigner } from "@venom/safety";
import type { Goals, Tasks } from "@venom/tasks";
import type { FastifyBaseLogger } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { BrainError, type Brain } from "./brain.ts";
import type { LiveHub } from "./live-hub.ts";
import type { SaidKind } from "./runner.ts";
import { thumbnailOf } from "./thumbnail.ts";
import {
  carryOnWords,
  goalCannotWords,
  goalDoneWords,
  goalFailedWords,
  guidedWords,
  keepGoingWords,
  moveQuestionWords,
  refusedMoveWords,
  stopHereWords,
  timeUpWords,
} from "./words.ts";

export interface LoopLimits {
  readonly moves: number;
  readonly totalMs: number;
  readonly failuresInARow: number;
  readonly retryMs: number;
  readonly graceMs: number;
}

export interface LoopOptions {
  readonly goals: Goals;
  readonly tasks: Tasks;
  readonly brain: Brain;
  readonly power: Power;
  readonly memory: Memory;
  readonly identity: Pick<Identity, "devices">;
  readonly signer: CommandSigner;
  readonly hub: LiveHub;
  readonly log: FastifyBaseLogger;
  readonly closing: AbortSignal;
  readonly limits?: Partial<LoopLimits>;
  track(work: Promise<unknown>): void;
  availableEngines(): Promise<Availability>;
  publishTask(accountId: string, requestId: string, task: Task): void;
  publishMove(accountId: string, requestId: string, move: TaskMove, picture: Thumbnail | null): void;
  publishPower(accountId: string, requestId: string, status: PowerStatus): void;
  tell(task: Task, kind: SaidKind, text: string, moveId: string | null): Promise<void>;
}

export type Word = "yes" | "no" | null;

type Answer =
  | { readonly kind: "report"; readonly outcome: CommandOutcome; readonly detail: string }
  | { readonly kind: "observation"; readonly observation: Observation }
  | { readonly kind: "spot"; readonly spot: ScreenSpot | null }
  | { readonly kind: "lost"; readonly detail: string };

interface Awaiting {
  readonly deviceId: string;
  settle(answer: Answer): void;
}

interface Heard {
  readonly word: Word;
  readonly text: string;
}

interface Driving {
  readonly accountId: string;
  readonly taskId: string;
  readonly goal: string;
  readonly abort: AbortController;
  readonly guidance: string[];
  listening: boolean;
  heard: Heard | null;
  wake: (() => void) | null;
}

interface Turn {
  task: Task;
  readonly target: Device;
  readonly memories: readonly MemoryContext[];
  readonly deadline: number;
  spent: TokenUsage;
  budget: number;
  failures: number;
}

type Looked = { readonly kind: "seen"; readonly observation: Observation } | { readonly kind: "unseen"; readonly outcome: CommandOutcome; readonly detail: string };

const defaults: LoopLimits = {
  moves: screenLimits.moves,
  totalMs: 20 * 60_000,
  failuresInARow: 3,
  retryMs: 3000,
  graceMs: 15_000,
};

const finishedAs: Record<CommandOutcome, MoveOutcome> = {
  done: "done",
  failed: "failed",
  refused: "refused",
  stopped: "stopped",
};

export const observeMs = 60_000;
export const spotMs = 15_000;

export function moveMs(move: ScreenMove): number {
  switch (move.name) {
    case "type":
      return 30_000 + move.text.length * 150;
    case "open":
      return 45_000;
    case "pause":
      return move.seconds * 1000 + 5000;
    case "click":
    case "key":
    case "scroll":
      return 30_000;
  }
}

function isComputer(device: Device): boolean {
  return device.type === "computer" && device.status !== "revoked" && device.capabilities.screen_control;
}

function recent(left: Device, right: Device): number {
  return (right.last_seen_at ?? "").localeCompare(left.last_seen_at ?? "");
}

export class GoalLoop {
  readonly #options: LoopOptions;
  readonly #limits: LoopLimits;
  readonly #awaiting = new Map<string, Awaiting>();
  readonly #driving = new Map<string, Driving>();

  constructor(options: LoopOptions) {
    this.#options = options;
    this.#limits = { ...defaults, ...options.limits };
    options.closing.addEventListener("abort", () => this.#shutdown(), { once: true });
  }

  async target(device: DeviceRef): Promise<Device | null> {
    const { identity, hub } = this.#options;
    const able = (await identity.devices(device.account_id)).filter((candidate) => isComputer(candidate) && hub.canAct(candidate.id));
    return able.find((candidate) => candidate.id === device.id) ?? able.sort(recent)[0] ?? null;
  }

  begin(device: DeviceRef, goal: string, target: Device, requestId: string): Promise<Task> {
    return this.#options.goals.begin(device, target.id, goal, requestId);
  }

  run(task: Task, target: Device, requestId: string): void {
    if (this.#driving.has(task.id)) {
      return;
    }
    const driving: Driving = { accountId: task.account_id, taskId: task.id, goal: task.request_text, abort: new AbortController(), guidance: [], listening: false, heard: null, wake: null };
    this.#driving.set(task.id, driving);
    const work = this.#drive(driving, task, target, requestId)
      .catch((error: unknown) => this.#crashed(driving, error, requestId))
      .finally(() => this.#driving.delete(task.id));
    this.#options.track(work);
  }

  hear(taskId: string, text: string, word: Word): string {
    const driving = this.#driving.get(taskId);
    if (driving === undefined) {
      return "I am not working on that any more. Tell me what you would like done.";
    }
    if (driving.listening) {
      driving.heard = { word, text };
      this.#wake(driving);
      return word === "no" ? stopHereWords(driving.goal) : carryOnWords;
    }
    this.#guide(driving, text);
    return guidedWords;
  }

  answered(taskId: string): void {
    const driving = this.#driving.get(taskId);
    if (driving !== undefined) {
      this.#wake(driving);
    }
  }

  halted(taskIds: readonly string[]): void {
    for (const taskId of taskIds) {
      const driving = this.#driving.get(taskId);
      if (driving !== undefined) {
        driving.abort.abort();
        this.#wake(driving);
      }
    }
  }

  report(device: DeviceRef, report: CommandReport): boolean {
    return this.#settle(device, report.command_id, { kind: "report", outcome: report.outcome, detail: report.detail ?? report.outcome });
  }

  observed(device: DeviceRef, report: ObservationReport): boolean {
    return this.#settle(device, report.command_id, { kind: "observation", observation: report.observation });
  }

  spotted(device: DeviceRef, report: SpotReport): boolean {
    return this.#settle(device, report.command_id, { kind: "spot", spot: report.spot });
  }

  deviceLost(deviceId: string): void {
    for (const awaiting of [...this.#awaiting.values()]) {
      if (awaiting.deviceId === deviceId) {
        awaiting.settle({ kind: "lost", detail: "The computer went offline before it answered." });
      }
    }
  }

  async #drive(driving: Driving, task: Task, target: Device, requestId: string): Promise<void> {
    const { memory } = this.#options;
    const recalled = await memory.recall(task.account_id, task.request_text, requestId).catch(() => ({ memories: [], usage: nothingUsed }));
    const turn: Turn = {
      task,
      target,
      memories: recalled.memories.slice(0, 40),
      deadline: Date.now() + this.#limits.totalMs,
      spent: recalled.usage,
      budget: this.#limits.moves,
      failures: 0,
    };
    while (await this.#open(driving, turn)) {
      if (Date.now() > turn.deadline) {
        await this.#end(driving, turn, "failed", timeUpWords(turn.task, Math.round(this.#limits.totalMs / 60_000)));
        return;
      }
      if (turn.task.moves >= turn.budget) {
        if (!(await this.#keepGoing(driving, turn))) {
          return;
        }
        continue;
      }
      if (!(await this.#step(driving, turn))) {
        return;
      }
    }
  }

  async #step(driving: Driving, turn: Turn): Promise<boolean> {
    const { brain, goals, log } = this.#options;
    const looked = await this.#look(driving, turn);
    if (looked.kind === "unseen") {
      return looked.outcome === "stopped" ? false : this.#failed(driving, turn, `I could not look at the screen: ${looked.detail}`);
    }
    const { observation } = looked;
    const picture = thumbnailOf(observation.picture);
    const engine = await this.#admit(driving, turn);
    if (engine === null) {
      return false;
    }
    const turnId = uuidv7();
    const guidance = [...driving.guidance];
    let reply: MoveReply;
    try {
      reply = await brain.move(
        MoveRequest.parse({
          request_id: turnId,
          account_id: driving.accountId,
          engine,
          goal: turn.task.request_text,
          moves: await goals.history(driving.accountId, driving.taskId),
          guidance,
          memories: turn.memories,
          observation,
        }),
        AbortSignal.any([driving.abort.signal, this.#options.closing]),
      );
    } catch (error) {
      if (driving.abort.signal.aborted || this.#options.closing.aborted) {
        return false;
      }
      log.warn({ err: error, task_id: driving.taskId }, "the brain could not choose a move");
      return this.#failed(driving, turn, error instanceof BrainError ? error.message : "VENOM's brain could not choose the next move.");
    }
    await this.#charge(turn, turnId, engine, reply.type === "chosen" ? reply.model : null, reply.usage);
    if (reply.type === "failed") {
      log.warn({ task_id: driving.taskId, reason: reply.reason, detail: reply.detail }, "the brain did not choose a move");
      return this.#failed(driving, turn, reply.detail);
    }
    driving.guidance.splice(0, guidance.length);
    const { seen, next } = reply.next;
    switch (next.kind) {
      case "done":
        await this.#end(driving, turn, "completed", goalDoneWords(turn.task, next.answer), `Done. ${next.answer}`);
        return false;
      case "cannot":
        await this.#end(driving, turn, "failed", goalCannotWords(turn.task, next.reason), next.reason);
        return false;
      case "ask":
        return this.#listen(driving, turn, next.question);
      case "move":
        return this.#move(driving, turn, observation, picture, seen, next);
    }
  }

  async #move(driving: Driving, turn: Turn, observation: Observation, picture: Thumbnail | null, seen: string, choice: MakeMove): Promise<boolean> {
    const { goals, tasks } = this.#options;
    const point = choice.move.name === "click" ? choice.move.point : null;
    const spot = point === null ? null : await this.#spot(driving, turn, point);
    const { confirmation_strictness, skip_asking } = await tasks.settings(driving.accountId);
    const judgement = judgeMove(choice, observation, confirmation_strictness, skip_asking, spot);
    const proposed = await goals.propose(
      driving.accountId,
      driving.taskId,
      {
        intent: choice.intent,
        seen,
        move: choice.move,
        effects: judgement.effects,
        verdict: judgement.verdict,
        detail: judgement.verdict === "refuse" ? (judgement.because[0] ?? null) : null,
      },
      uuidv7(),
    );
    if (proposed === null) {
      return false;
    }
    this.#publish(turn, proposed.task, proposed.move, picture);
    if (judgement.verdict === "refuse") {
      return this.#listen(driving, turn, refusedMoveWords(proposed.move.detail ?? "VENOM will not make that move."));
    }
    if (judgement.verdict === "ask") {
      await this.#tell(proposed.task, "question", moveQuestionWords(proposed.move, judgement.because, turn.target.name), proposed.move.id);
      if (!(await this.#approved(driving, turn, proposed.move.id))) {
        return false;
      }
    }
    const answer = await this.#command(driving, turn, { kind: "move", task_id: driving.taskId, move_id: proposed.move.id, move: choice.move, confirmed: judgement.verdict === "ask" }, moveMs(choice.move));
    const outcome: MoveOutcome = answer.kind === "report" ? finishedAs[answer.outcome] : "failed";
    const detail = answer.kind === "report" || answer.kind === "lost" ? answer.detail : "The computer sent the wrong kind of answer.";
    const finished = await goals.finish(driving.accountId, proposed.move.id, outcome, detail, uuidv7());
    if (finished === null) {
      return false;
    }
    this.#publish(turn, finished.task, finished.move, null);
    if (outcome === "stopped") {
      return false;
    }
    turn.failures = outcome === "done" ? 0 : turn.failures + 1;
    if (turn.failures >= this.#limits.failuresInARow) {
      await this.#end(driving, turn, "failed", goalFailedWords(finished.task, `${this.#limits.failuresInARow} moves in a row did not work.`));
      return false;
    }
    return true;
  }

  async #approved(driving: Driving, turn: Turn, moveId: string): Promise<boolean> {
    const { goals } = this.#options;
    for (;;) {
      const move = await goals.move(driving.accountId, moveId);
      if (move === null || move.status !== "asking") {
        return move?.status === "running";
      }
      if (!(await this.#open(driving, turn))) {
        return false;
      }
      if (!(await this.#pause(driving, turn.deadline - Date.now()))) {
        await this.#end(driving, turn, "failed", timeUpWords(turn.task, Math.round(this.#limits.totalMs / 60_000)));
        return false;
      }
    }
  }

  async #listen(driving: Driving, turn: Turn, words: string): Promise<boolean> {
    const { goals } = this.#options;
    const held = await goals.hold(driving.accountId, driving.taskId, uuidv7());
    if (held === null) {
      return false;
    }
    this.#options.publishTask(driving.accountId, uuidv7(), held);
    driving.heard = null;
    driving.listening = true;
    await this.#tell(held, "report", words, null);
    try {
      while (driving.heard === null) {
        if (!(await this.#open(driving, turn))) {
          return false;
        }
        if (!(await this.#pause(driving, turn.deadline - Date.now()))) {
          await this.#end(driving, turn, "failed", timeUpWords(turn.task, Math.round(this.#limits.totalMs / 60_000)));
          return false;
        }
      }
    } finally {
      driving.listening = false;
    }
    const { word, text } = driving.heard;
    driving.heard = null;
    if (word === "no") {
      await this.#end(driving, turn, "cancelled", null, "Cancelled because you said to stop.");
      return false;
    }
    if (word === null) {
      this.#guide(driving, text);
    }
    const resumed = await goals.carryOn(driving.accountId, driving.taskId, uuidv7());
    if (resumed !== null) {
      this.#options.publishTask(driving.accountId, uuidv7(), resumed);
    }
    return resumed !== null;
  }

  async #keepGoing(driving: Driving, turn: Turn): Promise<boolean> {
    const more = this.#limits.moves;
    const carry = await this.#listen(driving, turn, keepGoingWords(turn.task, turn.task.moves, more));
    if (carry) {
      turn.budget = turn.task.moves + more;
    }
    return carry;
  }

  async #look(driving: Driving, turn: Turn): Promise<Looked> {
    const answer = await this.#command(driving, turn, { kind: "observe", task_id: driving.taskId }, observeMs);
    switch (answer.kind) {
      case "observation":
        return { kind: "seen", observation: answer.observation };
      case "report":
        return { kind: "unseen", outcome: answer.outcome, detail: answer.detail };
      case "lost":
        return { kind: "unseen", outcome: "failed", detail: answer.detail };
      case "spot":
        return { kind: "unseen", outcome: "failed", detail: "The computer sent the wrong kind of answer." };
    }
  }

  async #spot(driving: Driving, turn: Turn, point: ScreenPoint): Promise<ScreenSpot | null> {
    const answer = await this.#command(driving, turn, { kind: "spot", task_id: driving.taskId, point }, spotMs);
    return answer.kind === "spot" ? answer.spot : null;
  }

  #command(driving: Driving, turn: Turn, body: Exclude<CommandBody, { kind: "run_step" | "stop" }>, timeMs: number): Promise<Answer> {
    const { signer, hub } = this.#options;
    const deviceId = turn.target.id;
    const offline: Answer = { kind: "lost", detail: `${turn.target.name} is not connected.` };
    if (!hub.canAct(deviceId)) {
      return Promise.resolve(offline);
    }
    const { commandId, frame } = signer.issue({ id: deviceId, account_id: driving.accountId }, body);
    return new Promise<Answer>((resolve) => {
      const timer = setTimeout(() => settle({ kind: "lost", detail: `${turn.target.name} did not answer in time.` }), timeMs + this.#limits.graceMs);
      const settle = (answer: Answer) => {
        clearTimeout(timer);
        this.#awaiting.delete(commandId);
        resolve(answer);
      };
      this.#awaiting.set(commandId, { deviceId, settle });
      if (hub.sendCommand(deviceId, frame) === 0) {
        settle(offline);
      }
    });
  }

  #settle(device: DeviceRef, commandId: string, answer: Answer): boolean {
    const awaiting = this.#awaiting.get(commandId);
    if (awaiting === undefined || awaiting.deviceId !== device.id) {
      return false;
    }
    awaiting.settle(answer);
    return true;
  }

  async #admit(driving: Driving, turn: Turn): Promise<EngineId | null> {
    const { power, availableEngines } = this.#options;
    try {
      return await power.admit(driving.accountId, await availableEngines());
    } catch (error) {
      if (!(error instanceof PowerError)) {
        throw error;
      }
      await this.#end(driving, turn, "failed", goalFailedWords(turn.task, error.message), error.message);
      return null;
    }
  }

  async #charge(turn: Turn, requestId: string, engine: EngineId, model: string | null, usage: TokenUsage): Promise<void> {
    const { power, log, publishPower } = this.#options;
    const total = addUsage(usage, turn.spent);
    turn.spent = nothingUsed;
    if (model === null && total.cost_micro_usd === 0 && total.input_tokens === 0) {
      return;
    }
    try {
      const status = await power.charge({ device: { id: turn.task.origin_device_id, account_id: turn.task.account_id }, requestId, engine, model, usage: total });
      publishPower(turn.task.account_id, uuidv7(), status);
    } catch (error) {
      log.error({ err: error, engine }, "could not record the power this move used");
    }
  }

  async #failed(driving: Driving, turn: Turn, detail: string): Promise<boolean> {
    turn.failures += 1;
    if (turn.failures >= this.#limits.failuresInARow) {
      await this.#end(driving, turn, "failed", goalFailedWords(turn.task, detail), detail);
      return false;
    }
    return this.#pause(driving, this.#limits.retryMs).then(() => !driving.abort.signal.aborted);
  }

  async #open(driving: Driving, turn: Turn): Promise<boolean> {
    if (driving.abort.signal.aborted || this.#options.closing.aborted) {
      return false;
    }
    const task = await this.#options.goals.state(driving.accountId, driving.taskId);
    if (task === null || (task.status !== "running" && task.status !== "awaiting_confirmation")) {
      return false;
    }
    turn.task = task;
    return true;
  }

  async #end(driving: Driving, turn: Turn, status: "completed" | "failed" | "cancelled", words: string | null, result: string = words ?? ""): Promise<void> {
    const ended = await this.#options.goals.end(driving.accountId, driving.taskId, status, result.length > 0 ? result : status, uuidv7());
    if (ended === null) {
      return;
    }
    turn.task = ended;
    this.#options.publishTask(driving.accountId, uuidv7(), ended);
    if (words !== null) {
      await this.#tell(ended, "report", words, null);
    }
  }

  #pause(driving: Driving, ms: number): Promise<boolean> {
    if (driving.abort.signal.aborted || this.#options.closing.aborted) {
      return Promise.resolve(true);
    }
    if (ms <= 0) {
      return Promise.resolve(false);
    }
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => done(false), ms);
      const done = (woken: boolean) => {
        clearTimeout(timer);
        if (driving.wake === wake) {
          driving.wake = null;
        }
        resolve(woken);
      };
      const wake = () => done(true);
      driving.wake = wake;
    });
  }

  #guide(driving: Driving, text: string): void {
    driving.guidance.push(text);
    driving.guidance.splice(0, Math.max(0, driving.guidance.length - screenLimits.guidance));
  }

  #wake(driving: Driving): void {
    driving.wake?.();
  }

  #publish(turn: Turn, task: Task, move: TaskMove, picture: Thumbnail | null): void {
    turn.task = task;
    const requestId = uuidv7();
    this.#options.publishTask(task.account_id, requestId, task);
    this.#options.publishMove(task.account_id, requestId, move, picture);
  }

  async #tell(task: Task, kind: SaidKind, text: string, moveId: string | null): Promise<void> {
    try {
      await this.#options.tell(task, kind, text, moveId);
    } catch (error) {
      this.#options.log.error({ err: error, task_id: task.id }, "could not tell the chat about this goal");
    }
  }

  async #crashed(driving: Driving, error: unknown, requestId: string): Promise<void> {
    this.#options.log.error({ err: error, task_id: driving.taskId }, "the goal loop failed");
    const ended = await this.#options.goals.end(driving.accountId, driving.taskId, "failed", "VENOM hit a problem and stopped working on this goal.", requestId).catch(() => null);
    if (ended !== null) {
      this.#options.publishTask(driving.accountId, uuidv7(), ended);
      await this.#tell(ended, "report", goalFailedWords(ended, "VENOM hit a problem."), null);
    }
  }

  #shutdown(): void {
    for (const driving of this.#driving.values()) {
      driving.abort.abort();
      this.#wake(driving);
    }
    for (const awaiting of [...this.#awaiting.values()]) {
      awaiting.settle({ kind: "lost", detail: "VENOM's gateway stopped before the computer answered." });
    }
  }
}
