import type { StepStatus, TaskProgress } from "./records.ts";

export function progressOf(statuses: readonly StepStatus[]): TaskProgress {
  const total = statuses.length;
  const done = statuses.filter((status) => status === "done").length;
  const skipped = statuses.filter((status) => status === "skipped").length;
  const ignored = statuses.filter((status) => status === "ignored").length;
  const counted = total - ignored;
  return {
    done,
    counted,
    skipped,
    ignored,
    total,
    percent: counted === 0 ? 0 : Math.floor((done * 100) / counted),
  };
}

export function sameProgress(left: TaskProgress, right: TaskProgress): boolean {
  return (
    left.done === right.done &&
    left.counted === right.counted &&
    left.skipped === right.skipped &&
    left.ignored === right.ignored &&
    left.total === right.total &&
    left.percent === right.percent
  );
}
