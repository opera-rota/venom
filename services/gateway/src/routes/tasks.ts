import { CommandReport, ConfirmAnswer, Id, TaskControl, TaskDrill } from "@venom/contracts";
import type { DeviceRef } from "@venom/db";
import { refuseSafety } from "@venom/safety";
import { refuseTasks } from "@venom/tasks";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireSignedIn } from "../auth.ts";
import type { GatewayContext } from "../context.ts";
import { notFound } from "../errors.ts";

const TaskParams = z.strictObject({ task_id: Id });

const StepParams = z.strictObject({ task_id: Id, step_id: Id });

export function taskRoutes(app: FastifyInstance, context: GatewayContext): void {
  const { hub, identity, tasks, trust, runner, broadcastTask, broadcastConfirmation } = context;

  async function ensureCanAct(device: DeviceRef): Promise<void> {
    if (!(await trust.hasKey(device))) {
      throw refuseSafety.keyMissing();
    }
    if (!hub.canAct(device.id)) {
      throw refuseSafety.deviceOffline((await identity.session(device)).device.name);
    }
  }

  app.get("/v1/tasks", async (request) => {
    return tasks.list(requireSignedIn(request).account_id);
  });

  app.post("/v1/tasks/drill", async (request, reply) => {
    const device = requireSignedIn(request);
    const { kind } = TaskDrill.parse(request.body);
    await ensureCanAct(device);
    const task = await tasks.drill(device, kind, request.id);
    broadcastTask(device.account_id, request.id, task);
    runner.run(device.account_id, task.id, request.id);
    return reply.code(201).send(task);
  });

  app.post("/v1/tasks/:task_id/control", async (request) => {
    const device = requireSignedIn(request);
    const { task_id } = TaskParams.parse(request.params);
    const control = TaskControl.parse(request.body);
    if (control.kind === "resume" || control.kind === "retry") {
      const current = await tasks.get(device.account_id, task_id);
      if (current === null) {
        throw refuseTasks.taskNotFound();
      }
      if (current.target_device_id !== null) {
        await ensureCanAct({ id: current.target_device_id, account_id: device.account_id });
      }
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
