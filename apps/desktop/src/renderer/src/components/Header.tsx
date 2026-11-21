import { useState, type FormEvent } from "react";
import type { ConnectionState, HaltView } from "../../../shared/bridge.ts";
import { button, mark, text } from "../ui.ts";
import { AccountMenu, type AccountMenuProps } from "./AccountMenu.tsx";
import { Emblem } from "./Emblem.tsx";
import { HaltSwitch } from "./HaltSwitch.tsx";
import { Icon, type IconName } from "./Icon.tsx";

const connectionView: Record<ConnectionState, { readonly label: string; readonly icon: IconName; readonly tone: string; readonly dot: string }> = {
  online: { label: "Connected", icon: "check", tone: "text-green-300", dot: "bg-green-400 shadow-[0_0_10px_2px_rgba(31,242,92,0.7)]" },
  connecting: { label: "Connecting", icon: "hourglass", tone: "text-status-wait", dot: "bg-status-wait animate-pulse" },
  offline: { label: "Ooh, lost the network. Reconnecting by myself", icon: "hourglass", tone: "text-status-wait", dot: "bg-status-wait animate-pulse" },
};

export function LogoMark({ size }: { readonly size: number }) {
  return <Emblem size={size} />;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter((part) => part.length > 0);
  const letters = parts.length > 1 ? `${parts[0]?.[0] ?? ""}${parts.at(-1)?.[0] ?? ""}` : name.trim().slice(0, 2);
  return letters.toUpperCase() || "V";
}

export interface HeaderProps {
  readonly connection: ConnectionState;
  readonly deviceCount: number;
  readonly menu: AccountMenuProps;
  readonly halt: HaltView;
  readonly waiting: number;
  readonly onStop: () => void;
  readonly onAsk: (text: string) => Promise<boolean>;
  readonly onWaiting: () => void;
}

function Ask({ onAsk, online }: { readonly onAsk: (text: string) => Promise<boolean>; readonly online: boolean }) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const asked = draft.trim();
    if (asked.length === 0 || !online || sending) {
      return;
    }
    setSending(true);
    if (await onAsk(asked)) {
      setDraft("");
    }
    setSending(false);
  }

  return (
    <form onSubmit={(event) => void submit(event)} role="search" className="hidden min-w-0 flex-1 md:flex md:max-w-[560px]">
      <label className="glass group flex w-full items-center gap-3 rounded-full px-4 py-2.5 transition-[border-color,box-shadow] duration-200 ease-ui focus-within:border-green-400/50 focus-within:shadow-glow">
        <Icon name="search" className="h-4 w-4 shrink-0 text-ink-faint transition-colors group-focus-within:text-green-300" />
        <span className="sr-only">Ask VENOM anything</span>
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Search or ask anything…"
          className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint focus-visible:shadow-none"
        />
        <kbd className="hud hidden rounded-md border border-line px-1.5 py-0.5 text-[9.5px] text-ink-faint lg:inline">Enter</kbd>
      </label>
    </form>
  );
}

export function Header({ connection, deviceCount, menu, halt, waiting, onStop, onAsk, onWaiting }: HeaderProps) {
  const view = connectionView[connection];

  return (
    <header className="relative z-20 flex items-center gap-3 px-4 pt-3 pb-2 sm:gap-4 sm:px-5 sm:pt-4">
      <div className="flex shrink-0 items-center gap-3">
        <Emblem size={38} />
        <div className="flex flex-col leading-none">
          <h1 className="bg-linear-to-r from-mint-200 via-green-300 to-green-500 bg-clip-text text-[19px] font-extrabold tracking-[0.18em] text-transparent">VENOM</h1>
          <span className={`${text.eyebrow} mt-1 hidden text-[8.5px] sm:block`}>Symbiote online</span>
        </div>
      </div>
      <div className="flex min-w-0 flex-1 justify-center">
        <Ask onAsk={onAsk} online={connection === "online"} />
      </div>
      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        <div role="status" aria-live="polite" title={view.label} className={`glass flex items-center gap-2 rounded-full px-3 py-2 ${text.detail} ${view.tone}`}>
          <span className={`${mark.dot} ${view.dot}`} />
          <span className="hidden max-w-[240px] truncate lg:inline">{view.label}</span>
          {deviceCount > 0 && (
            <span className="hidden tabular-nums text-ink-muted sm:inline">
              · {deviceCount} {deviceCount === 1 ? "device" : "devices"}
            </span>
          )}
        </div>
        <HaltSwitch view={halt} onStop={onStop} />
        <button type="button" onClick={onWaiting} className={`${button.icon} hidden sm:grid`} aria-label={waiting > 0 ? `${waiting} things wait for you` : "Nothing waits for you"} title={waiting > 0 ? "Something waits for you" : "All quiet"}>
          <Icon name="bell" className="h-[18px] w-[18px]" />
          {waiting > 0 && <span className={`${mark.badge} absolute -top-1 -right-1 bg-green-400 text-on-accent shadow-mark`}>{waiting}</span>}
        </button>
        <AccountMenu {...menu} />
        <span
          className="hidden h-10 w-10 shrink-0 place-items-center rounded-full bg-linear-to-br from-green-400/30 via-surface-2 to-surface-1 text-[13px] font-bold tracking-wide text-green-300 shadow-[0_0_0_1.5px_rgba(77,255,124,0.55),0_0_20px_-4px_rgba(31,242,92,0.7)] sm:grid"
          title={menu.account.name}
          aria-label={`Signed in as ${menu.account.name}`}
        >
          {initials(menu.account.name)}
        </span>
      </div>
    </header>
  );
}
