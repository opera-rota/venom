import type { ConfirmationStrictness, DrillKind, SafetySettings, SkippableEffect } from "@venom/contracts";
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

const skippable: readonly { readonly effect: SkippableEffect; readonly title: string; readonly example: string }[] = [
  { effect: "deletes", title: "Deleting things", example: "Removing files, notes or messages." },
  { effect: "posts", title: "Posting or sending things", example: "Sending a message to your team, sharing a file, publishing a post." },
  { effect: "reaches_outside", title: "Reaching services outside this device", example: "Opening a website or using a connected service." },
];

const alwaysAsks: readonly { readonly title: string; readonly example: string }[] = [
  { title: "Paying or buying", example: "Spending money or sending it to anyone." },
  { title: "Passwords and keys", example: "Anything that needs a password. You always type it yourself." },
];

const drillsOffered: readonly { readonly kind: DrillKind; readonly label: string; readonly blurb: string }[] = [
  { kind: "wait", label: "Run the 30 second drill", blurb: "Three waiting steps on this computer. Press Stop during the long one." },
  { kind: "sensitive", label: "Run the confirmation drill", blurb: "One step pretends to delete a file and pauses for you. Nothing is deleted." },
];

function toggled(settings: SafetySettings, effect: SkippableEffect, skip: boolean): SafetySettings {
  const others = settings.skip_asking.filter((listed) => listed !== effect);
  return { ...settings, skip_asking: skip ? [...others, effect] : others };
}

export function SafetyPanel({ handle, onClose }: { readonly handle: TasksHandle; readonly onClose: () => void }) {
  const [starting, setStarting] = useState<DrillKind | null>(null);
  const { settings } = handle;

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
        <fieldset className="flex flex-col gap-2" disabled={handle.saving || settings === null}>
          <legend className={`mb-2 ${field.label}`}>Confirmation strictness {handle.saving && <span className="text-ink-faint">· saving</span>}</legend>
          {levels.map((level) => (
            <label key={level.value} className={`flex cursor-pointer items-start gap-3 p-3 ${settings?.confirmation_strictness === level.value ? surface.cardActive : surface.card}`}>
              <input
                type="radio"
                name="strictness"
                value={level.value}
                checked={settings?.confirmation_strictness === level.value}
                onChange={() => settings !== null && void handle.save({ ...settings, confirmation_strictness: level.value })}
                className="mt-1 accent-green-500"
              />
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-medium text-ink">{level.title}</span>
                <span className={text.support}>{level.example}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <fieldset className="flex flex-col gap-2" disabled={handle.saving || settings === null}>
          <legend className={`mb-1 ${field.label}`}>Don't ask me before</legend>
          <p className={`mb-1 ${text.support}`}>Tick a kind of action and VENOM stops asking before it. Paying and passwords always ask.</p>
          {skippable.map((kind) => {
            const skipped = settings?.skip_asking.includes(kind.effect) ?? false;
            return (
              <label key={kind.effect} className={`flex cursor-pointer items-start gap-3 p-3 ${surface.card}`}>
                <input
                  type="checkbox"
                  checked={skipped}
                  onChange={(event) => settings !== null && void handle.save(toggled(settings, kind.effect, event.target.checked))}
                  className="mt-1 accent-green-500"
                />
                <span className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium text-ink">{kind.title}</span>
                  <span className={text.support}>{skipped ? "VENOM does this without asking." : kind.example}</span>
                </span>
              </label>
            );
          })}
          {alwaysAsks.map((kind) => (
            <div key={kind.title} className={`flex items-start gap-3 p-3 ${surface.card}`}>
              <Icon name="lock" className="mt-1 h-3.5 w-3.5 shrink-0 text-status-wait" />
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-medium text-ink">{kind.title}</span>
                <span className={text.support}>Always asks. {kind.example}</span>
              </span>
            </div>
          ))}
        </fieldset>
        {handle.developer && (
          <section className="flex flex-col gap-3">
            <h3 className={field.label}>Developer drills</h3>
            {drillsOffered.map((drill) => (
              <div key={drill.kind} className="flex flex-col gap-1.5">
                <button type="button" disabled={starting !== null} onClick={() => void start(drill.kind)} className={button.compact}>
                  {starting === drill.kind ? "Starting…" : drill.label}
                </button>
                <span className={text.support}>{drill.blurb}</span>
              </div>
            ))}
          </section>
        )}
      </div>
    </aside>
  );
}
