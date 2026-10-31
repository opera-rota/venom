import { CommandReport, ConfirmAnswer, Id, TaskDrill } from "@venom/contracts";
import { refuseSafety } from "@venom/safety";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireSignedIn } from "../auth.ts";
import type { GatewayContext } from "../context.ts";
import { notFound } from "../errors.ts";

const StepParams = z.strictObject({ task_id: Id, step_id: Id });

export function taskRoutes(app: FastifyInstance, context: GatewayContext): void {
  const { hub, identity, tasks, trust, runner, broadcastTask, broadcastConfirmation } = context;

  app.get("/v1/tasks", async (request) => {
    return tasks.list(requireSignedIn(request).account_id);
  });

  app.post("/v1/tasks/drill", async (request, reply) => {
    const device = requireSignedIn(request);
    const { kind } = TaskDrill.parse(request.body);
    if (!(await trust.hasKey(device))) {
      throw refuseSafety.keyMissing();
    }
    if (!hub.canAct(device.id)) {
      throw refuseSafety.deviceOffline((await identity.session(device)).device.name);
    }
    const task = await tasks.drill(device, kind, request.id);
    broadcastTask(device.account_id, request.id, task);
    runner.run(device.account_id, task.id, request.id);
    return reply.code(201).send(task);
  });

  app.post("/v1/tasks/:task_id/steps/:step_id/confirmation", async (request) => {
    const device = requireSignedIn(request);
    const { task_id, step_id } = StepParams.parse(request.params);
    const { decision } = ConfirmAnswer.parse(request.body);
    const answered = await tasks.answer(device, task_id, step_id, decision, request.id);
    broadcastTask(device.account_id, request.id, answered.task);
    broadcastConfirmation(device.account_id, request.id, answered.request, answered.answered);
    runner.answered(step_id);
    return answered.answered;
  });

  app.post("/v1/commands/report", async (request, reply) => {
    const device = requireSignedIn(request);
    const report = CommandReport.parse(request.body);
    if (!runner.report(device, report)) {
      throw notFound("That command is not waiting for an answer.");
    }
    return reply.code(204).send();
  });
}
