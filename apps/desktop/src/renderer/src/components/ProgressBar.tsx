import type { TaskProgress } from "@venom/contracts";
import { useEffect, useRef } from "react";
import { mark, text } from "../ui.ts";

function extras(progress: TaskProgress): string {
  return [progress.skipped > 0 ? `${progress.skipped} skipped` : "", progress.ignored > 0 ? `${progress.ignored} ignored` : ""].filter((part) => part !== "").join(" · ");
}

export function ProgressBar({ progress }: { readonly progress: TaskProgress }) {
  const previous = useRef(progress.percent);
  const rising = progress.percent >= previous.current;
  const aside = extras(progress);

  useEffect(() => {
    previous.current = progress.percent;
  }, [progress.percent]);

  return (
    <div className="flex flex-col gap-1.5">
      <div className={`flex items-center justify-between gap-3 ${text.detail}`}>
        <span className="text-ink-muted">
          <span className="tabular-nums">
            {progress.done} of {progress.counted} {progress.counted === 1 ? "step" : "steps"} done
          </span>
          {aside !== "" && <span className="text-ink-faint"> · {aside}</span>}
        </span>
        <span className="tabular-nums text-ink">{progress.percent}%</span>
      </div>
      <div
        role="progressbar"
        aria-label="Task progress, counted from finished steps"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress.percent}
        className={mark.track}
      >
        <div className={`h-full rounded-full bg-status-ok ${rising ? "transition-[width] duration-200 ease-ui" : ""}`} style={{ width: `${progress.percent}%` }} />
      </div>
    </div>
  );
}
