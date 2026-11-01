import type { ActionSpec, ConnectorService, Effect, ScriptLanguage, Step } from "@venom/contracts";

const quoteLimit = 60;

const serviceNames: Record<ConnectorService, string> = {
  mail: "Mail",
  calendar: "Calendar",
};

const languageNames: Record<ScriptLanguage, string> = {
  powershell: "PowerShell",
  python: "Python",
};

const effectReasons: Record<Effect, string> = {
  deletes: "it deletes something",
  pays: "it spends money",
  uses_credential: "it needs a password",
  posts: "it sends or posts something",
  reaches_outside: "it reaches outside this computer",
};

function quoted(value: string): string {
  const line = value.replace(/\s+/g, " ").trim();
  return `"${line.length > quoteLimit ? `${line.slice(0, quoteLimit - 1).trimEnd()}…` : line}"`;
}

export function howItRuns(spec: ActionSpec): string {
  switch (spec.name) {
    case "wait":
      return `Waits ${spec.seconds} ${spec.seconds === 1 ? "second" : "seconds"}`;
    case "open_app":
      return `Opens ${spec.app}`;
    case "type_text":
      return `Types ${quoted(spec.text)} into ${spec.into}`;
    case "click":
      return `Clicks ${spec.on}`;
    case "run_script":
      return `Runs a ${languageNames[spec.language]} script: ${spec.purpose}`;
    case "take_screenshot":
      return "Takes a screenshot";
    case "call_connector":
      return `Uses ${serviceNames[spec.service]} to ${spec.operation}: ${spec.details}`;
  }
}

export function whyItAsks(step: Pick<Step, "effects" | "reversible">): string {
  const reasons = step.effects.map((effect) => effectReasons[effect]);
  if (reasons.length === 0) {
    return step.reversible ? "Asks you first" : "Asks you first because it cannot be undone";
  }
  const listed = reasons.length === 1 ? reasons[0] : `${reasons.slice(0, -1).join(", ")} and ${reasons.at(-1)}`;
  return `Asks you first because ${listed}`;
}
