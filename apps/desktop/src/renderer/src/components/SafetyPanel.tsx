import type { ConfirmationStrictness, DrillKind } from "@venom/contracts";
import { useState } from "react";
import type { TasksHandle } from "../use-tasks.ts";
import { button, field, surface, text } from "../ui.ts";
import { Icon } from "./Icon.tsx";

const levels: readonly { readonly value: ConfirmationStrictness; readonly title: string; readonly example: string }[] = [
  {
    value: "standard",
    title: "Standard",
    example: "Pauses on anything that deletes, pays, posts, uses a password or reaches outside this device.",
  },
  {
    value: "strict",
    title: "Strict",
    example: "Also pauses on anything that cannot be undone, even when nothing is deleted or sent.",
  },
];

const drillsOffered: readonly { readonly kind: DrillKind; readonly label: string; readonly blurb: string }[] = [
  { kind: "wait", label: "Run the 30 second drill", blurb: "Three waiting steps on this computer. Press Stop during the long one." },
  { kind: "sensitive", label: "Run the confirmation drill", blurb: "One step pretends to delete a file and pauses for you. Nothing is deleted." },
];

export function SafetyPanel({ handle, onClose }: { readonly handle: TasksHandle; readonly onClose: () => void }) {
  const [starting, setStarting] = useState<DrillKind | null>(null);

  async function start(kind: DrillKind) {
    setStarting(kind);
    await handle.drill(kind);
    setStarting(null);
  }

  return (
    <aside aria-label="Safety" className={`flex w-[340px] max-w-full shrink-0 flex-col ${surface.panel}`}>
      <div className="flex items-center justify-between gap-3 border-b border-line-subtle px-5 py-3.5">
        <h2 className={text.section}>Safety</h2>
        <button type="button" onClick={onClose} className={button.ghost} aria-label="Close safety">
          <Icon name="cross" />
        </button>
      </div>
      <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-4">
        <p className={text.support}>
          Fixed rules decide what needs your confirmation, never a model. Stop works from every screen, and the shortcut Ctrl+Shift+Backspace works even when this window is hidden.
        </p>
        {handle.failure !== null && (
          <p role="alert" className={field.error}>
            <Icon name="cross" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{handle.failure}</span>
          </p>
        )}
        <fieldset className="flex flex-col gap-2" disabled={handle.saving || handle.strictness === null}>
          <legend className={`mb-2 ${field.label}`}>Confirmation strictness {handle.saving && <span className="text-ink-faint">· saving</span>}</legend>
          {levels.map((level) => (
            <label key={level.value} className={`flex cursor-pointer items-start gap-3 p-3 ${handle.strictness === level.value ? surface.cardActive : surface.card}`}>
              <input
                type="radio"
                name="strictness"
                value={level.value}
                checked={handle.strictness === level.value}
                onChange={() => void handle.choose(level.value)}
                className="mt-1 accent-green-500"
              />
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-medium text-ink">{level.title}</span>
                <span className={text.support}>{level.example}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <section className="flex flex-col gap-3">
          <h3 className={field.label}>Safety drills</h3>
          {drillsOffered.map((drill) => (
            <div key={drill.kind} className="flex flex-col gap-1.5">
              <button type="button" disabled={starting !== null} onClick={() => void start(drill.kind)} className={button.compact}>
                {starting === drill.kind ? "Starting…" : drill.label}
              </button>
              <span className={text.support}>{drill.blurb}</span>
            </div>
          ))}
        </section>
      </div>
    </aside>
  );
}
