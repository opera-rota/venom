import type { TaskMove } from "@venom/contracts";
import { useState } from "react";
import { moveLook } from "../move-words.ts";
import { button, text } from "../ui.ts";
import { Icon } from "./Icon.tsx";

const shownAtFirst = 5;

function MoveRow({ move }: { readonly move: TaskMove }) {
  const look = moveLook[move.status];
  return (
    <li className="flex items-start gap-2.5">
      <span className={`tabular w-5 shrink-0 pt-px text-right ${text.detail} text-ink-faint`}>{move.number}</span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="break-words text-[13px] leading-normal text-ink">{move.intent}</span>
        <span className={`flex flex-wrap items-center gap-x-1.5 ${text.detail}`}>
          <span className={`flex items-center gap-1 ${look.tone}`}>
            <Icon name={look.icon} className="h-3 w-3" />
            {look.word}
          </span>
          {move.detail !== null && <span className="break-words text-ink-faint">· {move.detail}</span>}
        </span>
      </div>
    </li>
  );
}

export function MoveList({ moves }: { readonly moves: readonly TaskMove[] }) {
  const [all, setAll] = useState(false);
  const hidden = all ? 0 : Math.max(0, moves.length - shownAtFirst);
  return (
    <div className="flex flex-col gap-2">
      {hidden > 0 && (
        <button type="button" onClick={() => setAll(true)} className={`${button.mini} self-start`}>
          <Icon name="chevron" className="h-3 w-3" />
          Show {hidden} earlier {hidden === 1 ? "move" : "moves"}
        </button>
      )}
      <ol className="flex flex-col gap-2.5" aria-label="VENOM's moves">
        {moves.slice(hidden).map((move) => (
          <MoveRow key={move.id} move={move} />
        ))}
      </ol>
    </div>
  );
}
