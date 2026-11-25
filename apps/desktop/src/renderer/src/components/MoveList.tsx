import type { TaskMove } from "@venom/contracts";
import { useState } from "react";
import { moveIcon, moveLabel, moveLook } from "../move-words.ts";
import { Icon } from "./Icon.tsx";

const shownAtFirst = 15;

const chipTone: Record<TaskMove["status"], string> = {
  asking: "border-status-wait/45 bg-status-wait/[0.07] text-status-wait",
  running: "border-green-400/60 bg-green-400/[0.12] text-green-300 shadow-[0_0_16px_-4px_rgba(31,242,92,0.8)]",
  done: "border-line bg-white/[0.035] text-ink hover:border-green-400/35",
  failed: "border-status-wait/40 bg-status-wait/[0.06] text-status-wait",
  refused: "border-status-wait/40 bg-status-wait/[0.06] text-status-wait",
  declined: "border-line-subtle bg-transparent text-ink-faint line-through",
  stopped: "border-line-subtle bg-transparent text-ink-faint",
};

function Chip({ move, chosen, onChoose }: { readonly move: TaskMove; readonly chosen: boolean; readonly onChoose: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onChoose}
        aria-pressed={chosen}
        aria-label={`Move ${move.number}: ${move.intent}`}
        className={`group flex h-8 items-center gap-1.5 rounded-[10px] border pr-2.5 pl-1 text-[12.5px] font-medium transition-[border-color,background-color] duration-200 ease-ui ${chipTone[move.status]} ${chosen ? "ring-1 ring-green-400/70" : ""}`}
      >
        <span className={`grid h-6 w-6 place-items-center rounded-[7px] ${move.status === "running" ? "bg-green-400 text-on-accent" : "bg-black/40 text-green-300/90"}`}>
          <Icon name={moveIcon(move)} className={`h-3.5 w-3.5 ${move.status === "running" ? "animate-pulse" : ""}`} />
        </span>
        <span className="max-w-[150px] truncate">{moveLabel(move)}</span>
      </button>
    </li>
  );
}

function Focus({ move }: { readonly move: TaskMove }) {
  const look = moveLook[move.status];
  return (
    <div className="flex items-start gap-3 rounded-[12px] border border-line-subtle bg-black/35 px-3.5 py-3" aria-live="polite">
      <span className="tabular mt-0.5 text-[11px] font-semibold text-green-300/80">{String(move.number).padStart(2, "0")}</span>
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-[13px] leading-snug text-ink">{move.intent}</p>
        <span className={`flex items-center gap-1 text-[11.5px] font-medium ${look.tone}`}>
          <Icon name={look.icon} className="h-3 w-3" />
          {look.word}
        </span>
      </div>
    </div>
  );
}

export function MoveList({ moves }: { readonly moves: readonly TaskMove[] }) {
  const [all, setAll] = useState(false);
  const [chosenId, setChosenId] = useState<string | null>(null);
  const hidden = all ? 0 : Math.max(0, moves.length - shownAtFirst);
  const chosen = moves.find((move) => move.id === chosenId) ?? moves.at(-1) ?? null;

  return (
    <div className="flex flex-col gap-3">
      <ol className="flex flex-wrap gap-1.5" aria-label="VENOM's moves">
        {hidden > 0 && (
          <li>
            <button type="button" onClick={() => setAll(true)} className="flex h-8 items-center rounded-[10px] border border-dashed border-line-strong px-2.5 text-[12px] font-medium text-ink-muted transition-colors duration-200 ease-ui hover:text-ink">
              +{hidden}
            </button>
          </li>
        )}
        {moves.slice(hidden).map((move) => (
          <Chip key={move.id} move={move} chosen={chosen?.id === move.id} onChoose={() => setChosenId(move.id)} />
        ))}
      </ol>
      {chosen !== null && <Focus move={chosen} />}
    </div>
  );
}
