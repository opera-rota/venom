import { troubleWords } from "../../../shared/trouble.ts";
import { button, text } from "../ui.ts";
import { Icon, type IconName } from "./Icon.tsx";

interface TroubleLook {
  readonly title: string;
  readonly icon: IconName;
  readonly glow: string;
  readonly ring: string;
  readonly tone: string;
}

const calm: TroubleLook = {
  title: "A fresh VENOM is ready",
  icon: "sparkle",
  glow: "from-green-400/[0.14]",
  ring: "border-green-400/40 bg-green-400/10 shadow-[0_0_24px_-6px_rgba(31,242,92,0.8)]",
  tone: "text-green-300",
};

const slipped: TroubleLook = {
  title: "Ooh, the connection slipped",
  icon: "wave",
  glow: "from-status-wait/[0.12]",
  ring: "border-status-wait/40 bg-status-wait/[0.08] shadow-[0_0_24px_-6px_rgba(242,196,109,0.6)]",
  tone: "text-status-wait",
};

const hiccup: TroubleLook = { ...slipped, title: "Ooh, a small hiccup", icon: "pulse" };

function lookOf(reason: string): TroubleLook {
  if (reason === troubleWords.outdated) {
    return calm;
  }
  return reason === troubleWords.unreachable ? slipped : hiccup;
}

export interface TroubleProps {
  readonly reason: string;
  readonly onRetry?: () => void;
}

export function Trouble({ reason, onRetry }: TroubleProps) {
  const look = lookOf(reason);
  const outdated = reason === troubleWords.outdated;

  return (
    <div role="alert" className={`glass relative flex animate-rise items-start gap-3.5 overflow-hidden rounded-overlay bg-linear-to-br ${look.glow} to-transparent px-4 py-4`}>
      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full border ${look.ring}`}>
        <Icon name={look.icon} className={`h-[18px] w-[18px] ${look.tone}`} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="font-medium text-ink">{look.title}</p>
        <p className={`break-words ${text.support}`}>{reason}</p>
        {outdated && (
          <div className="mt-2 flex">
            <button type="button" className={button.gateApprove} onClick={() => window.location.reload()}>
              <Icon name="retry" className="h-3.5 w-3.5" />
              Refresh
            </button>
          </div>
        )}
        {!outdated && onRetry !== undefined && (
          <div className="mt-2 flex">
            <button type="button" className={button.compact} onClick={onRetry}>
              <Icon name="retry" className="h-3.5 w-3.5" />
              Try again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
