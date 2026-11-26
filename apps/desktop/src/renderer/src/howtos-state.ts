import type { GatewayEvent, HowTo } from "@venom/contracts";

function pinnedThenNewest(left: HowTo, right: HowTo): number {
  return Number(right.pinned) - Number(left.pinned) || right.updated_at.localeCompare(left.updated_at) || right.id.localeCompare(left.id);
}

export function withHowTo(howtos: readonly HowTo[], howto: HowTo): readonly HowTo[] {
  return [...howtos.filter((existing) => existing.id !== howto.id), howto].sort(pinnedThenNewest);
}

export function withoutHowTo(howtos: readonly HowTo[], howtoId: string): readonly HowTo[] {
  return howtos.some((howto) => howto.id === howtoId) ? howtos.filter((howto) => howto.id !== howtoId) : howtos;
}

export function applyHowToEvent(howtos: readonly HowTo[], event: GatewayEvent): readonly HowTo[] {
  switch (event.type) {
    case "howto":
      return withHowTo(howtos, event.howto);
    case "howto_removed":
      return withoutHowTo(howtos, event.howto_id);
    default:
      return howtos;
  }
}

export function findHowTos(howtos: readonly HowTo[], query: string): readonly HowTo[] {
  const words = query.toLocaleLowerCase().split(/\s+/u).filter((word) => word.length > 0);
  if (words.length === 0) {
    return howtos;
  }
  return howtos.filter((howto) => {
    const text = `${howto.name} ${howto.app ?? ""} ${howto.steps.map((step) => `${step.label} ${step.said} ${step.note ?? ""}`).join(" ")}`.toLocaleLowerCase();
    return words.every((word) => text.includes(word));
  });
}

export function savedFrom(howtos: readonly HowTo[], taskId: string): HowTo | null {
  return howtos.find((howto) => howto.task_id === taskId) ?? null;
}
