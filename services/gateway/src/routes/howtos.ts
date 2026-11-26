import { ApplyHowTo, ChangeHowTo, HowTo, HowToApplied, HowToList, HowToNote, howToApp, howToLimits, howToName, howToSteps, Id, SaveHowTo, type TaskStatus } from "@venom/contracts";
import { refusePower, spec } from "@venom/power";
import type { FastifyInstance } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { requireSignedIn } from "../auth.ts";
import type { GatewayContext } from "../context.ts";
import { conflict, notFound } from "../errors.ts";
import { howToStartWords } from "../words.ts";

const HowToParams = z.strictObject({ howto_id: Id });

const StepParams = z.strictObject({ howto_id: Id, number: z.coerce.number().int().min(1).max(howToLimits.steps) });

const finishedStatuses: ReadonlySet<TaskStatus> = new Set(["completed", "failed", "cancelled", "stopped"]);

export const howToWords = {
  gone: "That how-to is no longer kept.",
  jobGone: "VENOM cannot find that job any more.",
  notFinished: "That job is still going. Save it as a how-to once it is finished.",
  nothingLearned: "That job has no finished moves to learn from yet.",
  exists: "That job is already saved as a how-to.",
  full: "VENOM keeps up to 200 how-tos. Forget one to make room.",
  noStep: "That step is not part of this how-to.",
  noComputer: "No computer is ready for this right now, buddy. Open VENOM on your computer, or choose one with Use this device on Devices.",
} as const;

export function howToRoutes(app: FastifyInstance, { store, tasks, goals, loop, power, broadcastTask, broadcastHowTo, broadcastHowToRemoved, say }: GatewayContext): void {
  app.get("/v1/howtos", async (request) => {
    return HowToList.parse({ howtos: await store.howtos(requireSignedIn(request).account_id), limit: howToLimits.items });
  });

  app.post("/v1/howtos", async (request, reply) => {
    const device = requireSignedIn(request);
    const { task_id, name } = SaveHowTo.parse(request.body);
    const task = await tasks.get(device.account_id, task_id);
    if (task === null || task.kind !== "goal") {
      throw notFound(howToWords.jobGone);
    }
    if (!finishedStatuses.has(task.status)) {
      throw conflict(howToWords.notFinished);
    }
    const moves = (await goals.list(device.account_id, task_id)) ?? [];
    const steps = howToSteps(moves);
    if (steps.length === 0) {
      throw conflict(howToWords.nothingLearned);
    }
    const seconds = Math.max(0, Math.round((Date.parse(task.updated_at) - Date.parse(task.created_at)) / 1000));
    const saved = await store.saveHowTo({
      device,
      requestId: request.id,
      taskId: task.id,
      name: name ?? howToName(task.request_text),
      app: howToApp(moves),
      learned: "job",
      seconds,
      steps,
    });
    if (saved.kind === "exists") {
      throw conflict(howToWords.exists);
    }
    if (saved.kind === "full") {
      throw conflict(howToWords.full);
    }
    broadcastHowTo(device.account_id, request.id, saved.howto);
    return reply.code(201).send(HowTo.parse(saved.howto));
  });

  app.patch("/v1/howtos/:howto_id", async (request) => {
    const device = requireSignedIn(request);
    const { howto_id } = HowToParams.parse(request.params);
    const { name, pinned } = ChangeHowTo.parse(request.body);
    const howto = await store.changeHowTo({ device, requestId: request.id, howtoId: howto_id, ...(name === undefined ? {} : { name }), ...(pinned === undefined ? {} : { pinned }) });
    if (howto === null) {
      throw notFound(howToWords.gone);
    }
    broadcastHowTo(device.account_id, request.id, howto);
    return howto;
  });

  app.put("/v1/howtos/:howto_id/steps/:number/note", async (request) => {
    const device = requireSignedIn(request);
    const { howto_id, number } = StepParams.parse(request.params);
    const { note } = HowToNote.parse(request.body);
    const noted = await store.noteHowToStep({ device, requestId: request.id, howtoId: howto_id, number, note });
    if (noted.kind === "gone") {
      throw notFound(howToWords.gone);
    }
    if (noted.kind === "no_step") {
      throw notFound(howToWords.noStep);
    }
    broadcastHowTo(device.account_id, request.id, noted.howto);
    return noted.howto;
  });

  app.post("/v1/howtos/:howto_id/apply", async (request, reply) => {
    const device = requireSignedIn(request);
    const { howto_id } = HowToParams.parse(request.params);
    const { step_by_step } = ApplyHowTo.parse(request.body ?? {});
    const howto = await store.howTo(device.account_id, howto_id);
    if (howto === null) {
      throw notFound(howToWords.gone);
    }
    const left = await power.status(device.account_id);
    if (left.answers_left <= 1) {
      throw left.engine_class === "free" ? refusePower.freeUsedUp(spec(left.engine), left.free_daily_answers) : refusePower.noPower(spec(left.engine));
    }
    const target = await loop.target(device);
    if (target === null) {
      throw conflict(howToWords.noComputer);
    }
    const task = await loop.begin(device, howto.name, target, request.id);
    const applied = (await store.startHowTo({ device, requestId: request.id, howtoId: howto.id, taskId: task.id, stepByStep: step_by_step })) ?? howto;
    broadcastTask(device.account_id, uuidv7(), task);
    broadcastHowTo(device.account_id, uuidv7(), applied);
    await say(task, "report", howToStartWords(applied.name, target.name, step_by_step), null);
    loop.run(task, target, request.id);
    return reply.code(201).send(HowToApplied.parse({ task, howto: applied }));
  });

  app.delete("/v1/howtos/:howto_id", async (request, reply) => {
    const device = requireSignedIn(request);
    const { howto_id } = HowToParams.parse(request.params);
    if (!(await store.forgetHowTo({ device, requestId: request.id, howtoId: howto_id }))) {
      throw notFound(howToWords.gone);
    }
    broadcastHowToRemoved(device.account_id, request.id, howto_id);
    return reply.code(204).send();
  });
}
