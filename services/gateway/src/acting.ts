import type { ConfirmDecision, StopReceipt, StopRequest, Task } from "@venom/contracts";
import type { DeviceRef } from "@venom/db";
import { refuseSafety } from "@venom/safety";
import { refuseTasks, type Answered } from "@venom/tasks";
import type { GatewayContext } from "./context.ts";
import { declinedWords, stoppedWords } from "./words.ts";

const rememberedStops = 500;

export interface Acting {
  ensureCanAct(device: DeviceRef): Promise<void>;
  ensureTaskCanAct(device: DeviceRef, task: Task): Promise<void>;
  run(device: DeviceRef, taskId: string, requestId: string): Promise<Task>;
  answer(device: DeviceRef, taskId: string, stepId: string, decision: ConfirmDecision, requestId: string, tell?: boolean): Promise<Answered>;
  halt(device: DeviceRef, stop: StopRequest, requestId: string): Promise<StopReceipt>;
}

export type ActingNeeds = Pick<GatewayContext, "hub" | "identity" | "tasks" | "trust" | "signer" | "runner" | "broadcastTask" | "broadcastConfirmation" | "broadcastHalt" | "say">;

export function createActing(context: ActingNeeds): Acting {
  const { hub, identity, tasks, trust, signer, runner, broadcastTask, broadcastConfirmation, broadcastHalt, say } = context;
  const reportedStops = new Set<string>();

  async function ensureCanAct(device: DeviceRef): Promise<void> {
    if (!(await trust.hasKey(device))) {
      throw refuseSafety.keyMissing();
    }
    if (!hub.canAct(device.id)) {
      throw refuseSafety.deviceOffline((await identity.session(device)).device.name);
    }
  }

  async function ensureTaskCanAct(device: DeviceRef, task: Task): Promise<void> {
    if (task.target_device_id !== null) {
      await ensureCanAct({ id: task.target_device_id, account_id: device.account_id });
    }
  }

  function firstReport(stopId: string): boolean {
    if (reportedStops.has(stopId)) {
      return false;
    }
    reportedStops.add(stopId);
    if (reportedStops.size > rememberedStops) {
      const [oldest] = reportedStops;
      if (oldest !== undefined) {
        reportedStops.delete(oldest);
      }
    }
    return true;
  }

  return {
    ensureCanAct,
    ensureTaskCanAct,

    async run(device, taskId, requestId) {
      const current = await tasks.get(device.account_id, taskId);
      if (current === null) {
        throw refuseTasks.taskNotFound();
      }
      await ensureTaskCanAct(device, current);
      const { task, run } = await tasks.control(device, taskId, { kind: "run" }, requestId);
      broadcastTask(device.account_id, requestId, task);
      if (run) {
        runner.run(device.account_id, task.id, requestId);
      }
      return task;
    },

    async answer(device, taskId, stepId, decision, requestId, tell = true) {
      const answered = await tasks.answer(device, taskId, stepId, decision, requestId);
      broadcastTask(device.account_id, requestId, answered.task);
      broadcastConfirmation(device.account_id, requestId, answered.request, answered.answered);
      runner.answered(stepId);
      if (tell && answered.answered.outcome === "declined") {
        await say(answered.task, "report", declinedWords(answered.task), null);
      }
      return answered;
    },

    async halt(device, stop, requestId) {
      const { scope } = stop;
      const reached = hub.devicesOf(device.account_id).filter((deviceId) => scope.kind !== "device" || deviceId === scope.device_id);
      const taskId = scope.kind === "task" ? scope.task_id : null;
      for (const deviceId of reached) {
        hub.sendCommand(deviceId, signer.issue({ id: deviceId, account_id: device.account_id }, { kind: "stop", stop_id: stop.stop_id, task_id: taskId }).frame);
      }
      const { receipt, closed } = await tasks.stop(device, stop, requestId);
      runner.wakeAll();
      broadcastHalt(device.account_id, requestId, receipt);
      for (const task of receipt.tasks) {
        broadcastTask(device.account_id, requestId, task);
      }
      for (const confirmation of closed) {
        broadcastConfirmation(device.account_id, requestId, confirmation, {
          outcome: "stopped",
          device_id: device.id,
          device_name: null,
          answered_at: receipt.stopped_at,
        });
      }
      if (firstReport(stop.stop_id)) {
        for (const task of receipt.tasks) {
          await say(task, "report", stoppedWords(task), null);
        }
      }
      return receipt;
    },
  };
}
