import { describe, expect, it } from "vitest";
import { LiveEvent, StopSignal, type StopScope } from "@venom/contracts";

const accountId = "0199d2a0-7c1e-7a3b-9f2d-1a2b3c4d5e01";
const deviceId = "0199d2a0-7c1e-7a3b-9f2d-1a2b3c4d5e02";

function describeScope(scope: StopScope): string {
  switch (scope.kind) {
    case "all":
      return "every running task";
    case "task":
      return `task ${scope.task_id}`;
    case "device":
      return `device ${scope.device_id}`;
  }
}

describe("gateway speaks the shared contracts", () => {
  it("decodes a stop signal and narrows its scope", () => {
    const signal = StopSignal.parse({
      account_id: accountId,
      scope: { kind: "device", device_id: deviceId },
      issued_at: "2026-10-11T09:31:00Z",
    });

    expect(describeScope(signal.scope)).toBe(`device ${deviceId}`);
  });

  it("refuses a live event that is missing its request id", () => {
    const event = LiveEvent.safeParse({
      task_id: null,
      step_id: null,
      kind: "started",
      text: "",
      emitted_at: "2026-10-11T09:31:00Z",
    });

    expect(event.success).toBe(false);
  });
});
