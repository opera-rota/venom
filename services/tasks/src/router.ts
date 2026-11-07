import type { ActionSpec, ConnectorService, Device, Effect, PlanDraft, StepAction } from "@venom/contracts";
import { effectsOfSpec, undoable } from "@venom/safety";

export interface RoutedStep {
  readonly summary: string;
  readonly spec: ActionSpec;
  readonly effects: readonly Effect[];
  readonly reversible: boolean;
}

export interface RoutedPlan {
  readonly title: string;
  readonly target: Device;
  readonly elsewhere: boolean;
  readonly missing: string | null;
  readonly steps: readonly RoutedStep[];
}

export type Routing =
  | { readonly kind: "routed"; readonly plan: RoutedPlan }
  | { readonly kind: "refused"; readonly reason: string };

export interface Fleet {
  readonly origin: Device;
  readonly devices: readonly Device[];
  readonly connectors: readonly ConnectorService[];
}

const serviceNames: Record<ConnectorService, string> = {
  mail: "Mail",
  calendar: "Calendar",
};

const needsHands: ReadonlySet<StepAction> = new Set(["open_app", "type_text", "click", "run_script", "take_screenshot"]);

function isComputer(device: Device): boolean {
  return device.type === "computer" && device.status !== "revoked";
}

function canCarry(device: Device, actions: ReadonlySet<StepAction>): boolean {
  return isComputer(device) && (device.capabilities.screen_control || !Array.from(actions).some((action) => needsHands.has(action)));
}

function mostRecentlySeen(left: Device, right: Device): number {
  return (right.last_seen_at ?? "").localeCompare(left.last_seen_at ?? "");
}

function best(devices: readonly Device[]): Device | null {
  const active = devices.filter((device) => device.status === "active").sort(mostRecentlySeen);
  return active[0] ?? [...devices].sort(mostRecentlySeen)[0] ?? null;
}

function chooseTarget({ origin, devices }: Fleet, actions: ReadonlySet<StepAction>): Device | null {
  const others = devices.filter((device) => device.id !== origin.id);
  if (canCarry(origin, actions)) {
    return origin;
  }
  return best(others.filter((device) => canCarry(device, actions))) ?? (isComputer(origin) ? origin : best(others.filter(isComputer)));
}

export function route(draft: PlanDraft, fleet: Fleet): Routing {
  if (draft.cannot !== null || draft.steps.length === 0) {
    return { kind: "refused", reason: draft.cannot ?? "I could not find any step that reaches this goal." };
  }
  const missing = draft.steps
    .map((step) => (step.spec.name === "call_connector" ? step.spec.service : null))
    .find((service): service is ConnectorService => service !== null && !fleet.connectors.includes(service));
  if (missing !== undefined) {
    return {
      kind: "refused",
      reason: `This needs ${serviceNames[missing]} connected to VENOM, and connecting services is not possible yet. Nothing was done.`,
    };
  }
  const actions = new Set(draft.steps.map((step) => step.spec.name));
  const target = chooseTarget(fleet, actions);
  if (target === null) {
    return {
      kind: "refused",
      reason: "None of your computers can do this. Open VENOM on a computer and ask me again. Nothing was done.",
    };
  }
  return {
    kind: "routed",
    plan: {
      title: draft.title,
      target,
      elsewhere: target.id !== fleet.origin.id,
      missing: canCarry(target, actions) ? null : `${target.name} has no working hands right now, so this plan cannot run there yet.`,
      steps: draft.steps.map((step) => ({
        summary: step.summary,
        spec: step.spec,
        effects: effectsOfSpec(step.spec, step.effects),
        reversible: undoable(step.spec.name, step.reversible),
      })),
    },
  };
}
