import { CommandReport, ConfirmAnswer, Id, ObservationReport, SpotReport, StepOutputChunk, TaskControl, TaskDrill } from "@venom/contracts";
import { refuseTasks } from "@venom/tasks";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireSignedIn } from "../auth.ts";
import type { GatewayContext } from "../context.ts";
import { notFound } from "../errors.ts";

const TaskParams = z.strictObject({ task_id: Id });

const StepParams = z.strictObject({ task_id: Id, step_id: Id });

const MoveParams = z.strictObject({ task_id: Id, move_id: Id });

const lookBodyLimit = 3 * 1024 * 1024;

const notWaiting = "That command is not waiting for an answer.";

export function taskRoutes(app: FastifyInstance, context: GatewayContext): void {
  const { tasks, runner, loop, acting, broadcastTask } = context;

  app.get("/v1/tasks", async (request) => {
    return tasks.list(requireSignedIn(request).account_id);
  });

  app.post("/v1/tasks/drill", async (request, reply) => {
    const device = requireSignedIn(request);
    const { kind } = TaskDrill.parse(request.body);
    await acting.ensureCanAct(device);
    const task = await tasks.drill(device, kind, request.id);
    broadcastTask(device.account_id, request.id, task);
    runner.run(device.account_id, task.id, request.id);
    return reply.code(201).send(task);
  });

  app.post("/v1/tasks/:task_id/control", async (request) => {
    const device = requireSignedIn(request);
    const { task_id } = TaskParams.parse(request.params);
    const control = TaskControl.parse(request.body);
    if (control.kind === "run") {
      return acting.run(device, task_id, request.id);
    }
    if (control.kind === "resume" || control.kind === "retry") {
      const current = await tasks.get(device.account_id, task_id);
      if (current === null) {
        throw refuseTasks.taskNotFound();
      }
      await acting.ensureTaskCanAct(device, current);
    }
    const { task, run } = await tasks.control(device, task_id, control, request.id);
    broadcastTask(device.account_id, request.id, task);
    if (run) {
      runner.run(device.account_id, task.id, request.id);
    }
    return task;
  });

  app.post("/v1/tasks/:task_id/steps/:step_id/confirmation", async (request) => {
    const device = requireSignedIn(request);
    const { task_id, step_id } = StepParams.parse(request.params);
    const { decision } = ConfirmAnswer.parse(request.body);
    return (await acting.answer(device, task_id, step_id, decision, request.id)).answered;
  });

  app.post("/v1/tasks/:task_id/moves/:move_id/confirmation", async (request) => {
    const device = requireSignedIn(request);
    const { task_id, move_id } = MoveParams.parse(request.params);
    const { decision } = ConfirmAnswer.parse(request.body);
    return (await acting.answerMove(device, task_id, move_id, decision, request.id)).move;
  });

  app.post("/v1/commands/report", async (request, reply) => {
    const device = requireSignedIn(request);
    const report = CommandReport.parse(request.body);
    if (!runner.report(device, report) && !loop.report(device, report)) {
      throw notFound(notWaiting);
    }
    return reply.code(204).send();
  });

  app.post("/v1/commands/observation", { bodyLimit: lookBodyLimit }, async (request, reply) => {
    const device = requireSignedIn(request);
    if (!loop.observed(device, ObservationReport.parse(request.body))) {
      throw notFound(notWaiting);
    }
    return reply.code(204).send();
  });

  app.post("/v1/commands/spot", async (request, reply) => {
    const device = requireSignedIn(request);
    if (!loop.spotted(device, SpotReport.parse(request.body))) {
      throw notFound(notWaiting);
    }
    return reply.code(204).send();
  });

  app.post("/v1/commands/output", async (request, reply) => {
    const device = requireSignedIn(request);
    const chunk = StepOutputChunk.parse(request.body);
    if (!runner.output(device, chunk)) {
      throw notFound("That command is not running any more.");
    }
    return reply.code(204).send();
  });
}
