import { describe, expect, it } from "vitest";
import { CommandGuard, commandText, createCommandSigner, newKeyPair, signText, verifyText, assess, drills, plainLanguage } from "../src/index.ts";

const device = { id: "0199d2a0-7c1e-7a3b-9f2d-1a2b3c4d5e02", account_id: "0199d2a0-7c1e-7a3b-9f2d-1a2b3c4d5e01" };

describe("fixed rules decide what needs confirmation", () => {
  it("lets a plain wait run without asking", () => {
    expect(assess({ action: "wait", effects: [], reversible: true }, "standard")).toEqual({ requiresConfirmation: false, risk: "low", reasons: [] });
  });

  it.each([
    ["deletes", "high"],
    ["pays", "high"],
    ["uses_credential", "high"],
    ["posts", "medium"],
    ["reaches_outside", "medium"],
  ] as const)("pauses on a step that %s, with %s risk", (effect, risk) => {
    expect(assess({ action: "wait", effects: [effect], reversible: true }, "standard")).toEqual({ requiresConfirmation: true, risk, reasons: [effect] });
  });

  it("treats every connector call as reaching outside, whatever the plan claims", () => {
    expect(assess({ action: "call_connector", effects: [], reversible: true }, "standard").reasons).toEqual(["reaches_outside"]);
  });

  it("pauses on anything that cannot be undone only when strict", () => {
    const step = { action: "wait", effects: [], reversible: false } as const;
    expect(assess(step, "standard").requiresConfirmation).toBe(false);
    expect(assess(step, "strict").requiresConfirmation).toBe(true);
  });

  it("marks exactly one step of the sensitive drill for confirmation", () => {
    const marked = drills.sensitive.steps.map((step) => assess(step, "standard").requiresConfirmation);
    expect(marked).toEqual([false, true, false]);
    expect(drills.wait.steps.map((step) => step.seconds)).toEqual([3, 30, 3]);
    expect(drills.progress.steps.map((step) => assess(step, "strict").requiresConfirmation)).toEqual([false, false, false, false, false]);
  });

  it("says the action, the target and whether it can be undone", () => {
    expect(plainLanguage("Pretend to delete a file", "Work laptop", false)).toBe("Pretend to delete a file on Work laptop. This cannot be undone.");
  });
});

describe("signed commands", () => {
  const server = newKeyPair();
  const signer = createCommandSigner(server);

  it("verifies a signature made with the matching key only", () => {
    const signature = signText(server, "hello");
    expect(verifyText(server.publicKey, "hello", signature)).toBe(true);
    expect(verifyText(server.publicKey, "hellO", signature)).toBe(false);
    expect(verifyText(newKeyPair().publicKey, "hello", signature)).toBe(false);
  });

  it("accepts a fresh command once and refuses it when repeated", () => {
    const guard = new CommandGuard(server.publicKey, device.id);
    const { frame } = signer.issue(device, { kind: "stop", stop_id: device.id, task_id: null });
    expect(guard.check(frame.command)).toMatchObject({ ok: true });
    expect(guard.check(frame.command)).toMatchObject({ ok: false, refusal: "repeated" });
  });

  it("refuses unsigned, wrongly signed, misaddressed and expired commands", () => {
    const { frame } = signer.issue(device, { kind: "stop", stop_id: device.id, task_id: null });
    const forger = newKeyPair();
    const forged = { payload: frame.command.payload, signature: signText(forger, commandText(frame.command.payload)) };
    expect(new CommandGuard(server.publicKey, device.id).check({ payload: frame.command.payload })).toMatchObject({ refusal: "unsigned" });
    expect(new CommandGuard(server.publicKey, device.id).check(forged)).toMatchObject({ refusal: "wrong_signature" });
    expect(new CommandGuard(server.publicKey, device.account_id).check(frame.command)).toMatchObject({ refusal: "not_for_this_device" });
    const later = new CommandGuard(server.publicKey, device.id, () => Date.now() + 120_000);
    expect(later.check(frame.command)).toMatchObject({ refusal: "expired" });
  });

  it("refuses a command whose payload was changed after signing", () => {
    const { frame } = signer.issue(device, { kind: "run_step", task_id: device.id, step_id: device.id, action: { name: "wait", seconds: 3 } });
    const changed = { ...frame.command, payload: frame.command.payload.replace('"seconds":3', '"seconds":300') };
    expect(new CommandGuard(server.publicKey, device.id).check(changed)).toMatchObject({ refusal: "wrong_signature" });
  });
});
