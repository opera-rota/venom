import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon.tsx";

export interface PlaceProps {
  readonly title: string;
  readonly icon: IconName;
  readonly eyebrow?: string;
  readonly count?: number | undefined;
  readonly width?: "narrow" | "wide" | "full";
  readonly children: ReactNode;
}

const placeWidth = { narrow: "max-w-[760px]", wide: "max-w-[1100px]", full: "max-w-[1480px]" } as const;

export function Place({ title, icon, eyebrow = "VENOM", count, width = "narrow", children }: PlaceProps) {
  return (
    <section aria-label={title} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
      <div className={`mx-auto flex w-full flex-col gap-5 px-4 py-6 sm:px-6 ${placeWidth[width]}`}>
        <header className="flex items-center gap-3.5">
          <span className="relative grid h-11 w-11 shrink-0 place-items-center rounded-control border border-green-400/35 bg-linear-to-br from-green-400/20 to-green-700/5 shadow-mark">
            <Icon name={icon} className="h-5 w-5 text-green-300" />
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="hud text-[9.5px] text-green-300/70">{eyebrow}</span>
            <h2 className="flex items-baseline gap-2 text-2xl font-semibold tracking-tight text-ink">
              <span>{title}</span>
              {count !== undefined && <span className="tabular neon-text text-lg">{count}</span>}
            </h2>
          </div>
          <span className="ml-2 h-px flex-1 bg-linear-to-r from-green-400/40 to-transparent" aria-hidden="true" />
        </header>
        {children}
      </div>
    </section>
  );
}
