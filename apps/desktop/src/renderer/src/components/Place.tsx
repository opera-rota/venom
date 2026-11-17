import type { ReactNode } from "react";
import { text } from "../ui.ts";
import { Icon, type IconName } from "./Icon.tsx";

export interface PlaceProps {
  readonly title: string;
  readonly icon: IconName;
  readonly count?: number;
  readonly width?: "narrow" | "wide";
  readonly children: ReactNode;
}

export function Place({ title, icon, count, width = "narrow", children }: PlaceProps) {
  return (
    <section aria-label={title} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
      <div className={`mx-auto flex w-full flex-col gap-4 px-5 py-6 ${width === "wide" ? "max-w-[1100px]" : "max-w-[720px]"}`}>
        <h2 className={`flex items-center gap-2 ${text.title}`}>
          <Icon name={icon} className="h-5 w-5 shrink-0 text-green-400" />
          <span>{title}</span>
          {count !== undefined && <span className="tabular text-green-400">{count}</span>}
        </h2>
        {children}
      </div>
    </section>
  );
}
