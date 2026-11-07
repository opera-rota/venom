import type { Device, DraftStep, PlanDraft } from "@venom/contracts";
import { describe, expect, it } from "vitest";
import { route, type Fleet } from "../src/index.ts";

const account = "0199d2a0-7c1e-7a3b-9f2d-1a2b3c4d5e01";

function device(n: number, overrides: Partial<Device> = {}): Device {
  return {
    id: `0199d2a0-7c1e-7a3b-9f2d-1a2b3c4d5e1${n}`,
    account_id: account,
    type: "computer",
    name: `Computer ${n}`,
    platform: "windows",
    capabilities: { screen_control: true, microphone: true, speaker: true, shortcuts: false, notifications: true, network: true },
    status: "active",
    last_seen_at: `2026-11-01T08:0${n}:00.000Z`,
    ...overrides,
  };
}

const openNotepad: DraftStep = { summary: "Open Notepad", spec: { name: "open_app", app: "Notepad", open: null }, effects: [], reversible: true };
const saveScript: DraftStep = {
  summary: "Save the list on the desktop",
  spec: { name: "run_script", language: "powershell", purpose: "Save the list as a file", code: "Set-Content list.txt 'Milk'" },
  effects: [],
  reversible: true,
};
const emailAlex: DraftStep = {
  summary: "Email the list to Alex",
  spec: { name: "call_connector", service: "mail", operation: "send an email", details: "To Alex" },
  effects: [],
  reversible: true,
};

function plan(...steps: DraftStep[]): PlanDraft {
  return { title: "Shopping list", steps, cannot: null };
}

const here = device(1);
const fleet: Fleet = { origin: here, devices: [here], connectors: [] };

describe("the router decides where a plan runs and what its steps really do", () => {
  it("keeps a plan on the computer it was asked from", () => {
    const routing = route(plan(openNotepad), fleet);
    expect(routing).toMatchObject({ kind: "routed", plan: { target: { id: here.id }, elsewhere: false, missing: null } });
  });

  it("never lets a script count as undoable, whatever the model claimed", () => {
    const routing = route(plan(openNotepad, saveScript), fleet);
    if (routing.kind !== "routed") {
      throw new Error("expected a routed plan");
    }
    expect(routing.plan.steps.map((step) => step.reversible)).toEqual([true, false]);
  });

  it("moves screen work to another computer and says so when this one cannot control its screen", () => {
    const blind = device(1, { capabilities: { ...here.capabilities, screen_control: false } });
    const older = device(2, { status: "offline" });
    const newer = device(3);
    const routing = route(plan(openNotepad), { origin: blind, devices: [blind, older, newer], connectors: [] });
    expect(routing).toMatchObject({ kind: "routed", plan: { target: { id: newer.id }, elsewhere: true, missing: null } });
  });

  it("keeps the plan on this computer and says what it cannot do yet when no computer has working hands", () => {
    const blind = device(1, { capabilities: { ...here.capabilities, screen_control: false } });
    const routing = route(plan(openNotepad), { origin: blind, devices: [blind], connectors: [] });
    expect(routing).toMatchObject({
      kind: "routed",
      plan: { target: { id: blind.id }, elsewhere: false, missing: "Computer 1 has no working hands right now, so this plan cannot run there yet." },
    });
    expect(route(plan(saveScript), { origin: blind, devices: [blind], connectors: [] })).toMatchObject({
      plan: { missing: "Computer 1 has no working hands right now, so this plan cannot run there yet." },
    });
    expect(route(plan({ summary: "Wait", spec: { name: "wait", seconds: 5 }, effects: [], reversible: true }), { origin: blind, devices: [blind], connectors: [] })).toMatchObject({
      plan: { missing: null },
    });
  });

  it("counts opening a web address as reaching outside, and a folder on this computer as not", () => {
    const step = (open: string): DraftStep => ({ summary: "Open it", spec: { name: "open_app", app: "Chrome", open }, effects: [], reversible: true });
    const routing = route(plan(step("wikipedia.org"), step("https://example.com"), step("Downloads"), step("C:\\Users\\me\\list.txt")), fleet);
    if (routing.kind !== "routed") {
      throw new Error("expected a routed plan");
    }
    expect(routing.plan.steps.map((routed) => routed.effects)).toEqual([["reaches_outside"], ["reaches_outside"], [], []]);
  });

  it("plans on a computer when asked from a phone", () => {
    const phone = device(1, { type: "phone", platform: "android" });
    const laptop = device(2, { capabilities: { ...here.capabilities, screen_control: false } });
    expect(route(plan(openNotepad), { origin: phone, devices: [phone, laptop], connectors: [] })).toMatchObject({
      plan: { target: { id: laptop.id }, elsewhere: true },
    });
  });

  it("refuses plainly when no computer can do it", () => {
    const phone = device(1, { type: "phone", platform: "android" });
    const routing = route(plan(openNotepad), { origin: phone, devices: [phone, device(2, { status: "revoked" })], connectors: [] });
    expect(routing).toEqual({ kind: "refused", reason: expect.stringContaining("None of your computers can do this") });
  });

  it("refuses a plan that needs a service VENOM is not connected to", () => {
    const routing = route(plan(openNotepad, emailAlex), fleet);
    expect(routing).toEqual({ kind: "refused", reason: expect.stringContaining("This needs Mail connected to VENOM") });
    expect(route(plan(emailAlex), { ...fleet, connectors: ["mail"] })).toMatchObject({
      kind: "routed",
      plan: { steps: [{ effects: ["reaches_outside"], reversible: false }] },
    });
  });

  it("passes on the model's own reason when it could not plan", () => {
    const cannot: PlanDraft = { title: "Book a flight", steps: [], cannot: "Booking a flight needs a payment I cannot make." };
    expect(route(cannot, fleet)).toEqual({ kind: "refused", reason: "Booking a flight needs a payment I cannot make." });
  });
});
