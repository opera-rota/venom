import type { HaltView } from "../../../shared/bridge.ts";
import { button } from "../ui.ts";
import { Icon } from "./Icon.tsx";

const label: Record<HaltView["kind"], string> = {
  idle: "Stop",
  stopping: "Stopping…",
  waiting: "Stop sent, waiting for the cloud",
  local: "Stopped on this computer",
  stopped: "Stopped",
  failed: "Stop",
};

const explanation: Record<HaltView["kind"], string> = {
  idle: "Stop everything VENOM is doing, on every device. Shortcut: Ctrl+Shift+Backspace.",
  stopping: "Stopping everything now.",
  waiting: "The stop was sent. VENOM keeps sending it until the cloud confirms.",
  local: "Stopped on this computer. The cloud will be told when you reconnect.",
  stopped: "Everything was stopped. Finished work stays finished.",
  failed: "The stop could not reach the cloud.",
};

export function HaltSwitch({ view, onStop }: { readonly view: HaltView; readonly onStop: () => void }) {
  const sentence = view.kind === "failed" ? view.reason : explanation[view.kind];

  return (
    <div className="flex items-center gap-2">
      <span role="status" aria-live="assertive" className="sr-only">
        {view.kind === "idle" ? "" : sentence}
      </span>
      <button type="button" onClick={onStop} title={sentence} aria-label={`${label[view.kind]}. ${sentence}`} className={button.halt}>
        <Icon name="stop" className="h-3.5 w-3.5" />
        <span>{label[view.kind]}</span>
      </button>
    </div>
  );
}
