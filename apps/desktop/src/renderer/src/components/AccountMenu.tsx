import type { Account, DrillKind, SkippableEffect } from "@venom/contracts";
import { useEffect, useRef, useState } from "react";
import { button, field, surface, text } from "../ui.ts";
import { Icon } from "./Icon.tsx";

const skippedWords: Record<SkippableEffect, string> = {
  deletes: "Deleting things",
  posts: "Posting or sending things",
  reaches_outside: "Reaching outside this device",
};

const drillsOffered: readonly { readonly kind: DrillKind; readonly label: string }[] = [
  { kind: "wait", label: "Run the 30 second drill" },
  { kind: "sensitive", label: "Run the confirmation drill" },
];

export interface AccountMenuProps {
  readonly account: Account;
  readonly skipped: readonly SkippableEffect[];
  readonly saving: boolean;
  readonly failure: string | null;
  readonly developer: boolean;
  readonly onAskAgain: (effect: SkippableEffect) => void;
  readonly onDrill: (kind: DrillKind) => Promise<boolean>;
  readonly onSignOut: () => Promise<boolean>;
}

export function AccountMenu({ account, skipped, saving, failure, developer, onAskAgain, onDrill, onSignOut }: AccountMenuProps) {
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    function outside(event: PointerEvent) {
      if (root.current !== null && !root.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        toggle.current?.focus();
      }
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      setLeaving(false);
    }
  }, [open]);

  async function run(work: () => Promise<boolean>) {
    setBusy(true);
    await work();
    setBusy(false);
    setOpen(false);
  }

  return (
    <div ref={root} className="relative min-w-0">
      <button
        ref={toggle}
        type="button"
        onClick={() => setOpen((shown) => !shown)}
        aria-expanded={open}
        aria-haspopup="true"
        className={`${button.ghost} min-w-0 px-2`}
      >
        <Icon name="user" className="h-4 w-4 shrink-0" />
        <span className="truncate">{account.name}</span>
        <Icon name="chevron" className="h-3 w-3 shrink-0" />
      </button>
      {open && (
        <div role="dialog" aria-label="Your account" className={`absolute top-full left-0 z-20 mt-2 flex w-[320px] max-w-[calc(100vw-2.5rem)] flex-col gap-4 p-4 ${surface.overlay}`}>
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate font-medium text-ink">{account.name}</span>
            <span className={`truncate ${text.support}`}>{account.email}</span>
          </div>
          <section aria-label="Don't ask me before" className="flex flex-col gap-2">
            <h3 className={field.label}>Don't ask me before</h3>
            {skipped.length === 0 ? (
              <p className={text.support}>VENOM asks before deleting, posting and reaching outside this device. Say "don't ask me before posting" in the chat to change that.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {skipped.map((effect) => (
                  <li key={effect} className="flex items-center justify-between gap-3">
                    <span className="min-w-0 text-sm text-ink">{skippedWords[effect]}</span>
                    <button type="button" disabled={saving} onClick={() => onAskAgain(effect)} className={button.compact}>
                      Ask again
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className={`${text.detail} text-ink-faint`}>Paying and passwords always ask.</p>
            {failure !== null && (
              <p role="alert" className={field.error}>
                <Icon name="cross" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{failure}</span>
              </p>
            )}
          </section>
          {developer && (
            <section aria-label="Developer drills" className="flex flex-col gap-2">
              <h3 className={field.label}>Developer drills</h3>
              {drillsOffered.map((drill) => (
                <button key={drill.kind} type="button" disabled={busy} onClick={() => void run(() => onDrill(drill.kind))} className={button.compact}>
                  {drill.label}
                </button>
              ))}
            </section>
          )}
          <div className="border-t border-line-subtle pt-3">
            {leaving ? (
              <div role="alertdialog" aria-label="Sign out" className="flex flex-col gap-3">
                <p className={text.support}>Sign this computer out of VENOM? To use it again you will need your email, your secret word and an emailed code.</p>
                <div className="flex gap-2">
                  <button type="button" autoFocus onClick={() => setLeaving(false)} className={button.gateCancel}>
                    Cancel
                  </button>
                  <button type="button" disabled={busy} onClick={() => void run(onSignOut)} className={button.gateApprove}>
                    <Icon name="warning" className="h-3.5 w-3.5 text-status-wait" />
                    <span>Sign out</span>
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" onClick={() => setLeaving(true)} className={`${button.ghost} -ml-3`}>
                Sign out of this device
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
