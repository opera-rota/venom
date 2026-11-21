import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon.tsx";

export interface ChoiceOption<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly hint?: string;
}

export interface ChoiceProps<T extends string> {
  readonly label: string;
  readonly value: T;
  readonly options: readonly ChoiceOption<T>[];
  readonly onChange: (value: T) => void;
}

export function Choice<T extends string>({ label, value, options, onChange }: ChoiceProps<T>) {
  const [open, setOpen] = useState(false);
  const [spot, setSpot] = useState<{ readonly top: number; readonly left: number } | null>(null);
  const [active, setActive] = useState(() => Math.max(0, options.findIndex((option) => option.value === value)));
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const listId = useId();
  const current = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    if (!open) {
      return;
    }
    setActive(Math.max(0, options.findIndex((option) => option.value === value)));
    list.current?.focus();
    function outside(event: PointerEvent) {
      const target = event.target as Node;
      if (!(root.current?.contains(target) ?? false) && !(list.current?.contains(target) ?? false)) {
        setOpen(false);
      }
    }
    function away() {
      setOpen(false);
    }
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", away);
    document.addEventListener("scroll", away, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", away);
      document.removeEventListener("scroll", away, true);
    };
  }, [open, options, value]);

  function toggle() {
    const box = trigger.current?.getBoundingClientRect();
    if (box !== undefined) {
      setSpot({ top: box.bottom + 8, left: box.left });
    }
    setOpen((shown) => !shown);
  }

  function pick(index: number) {
    const option = options[index];
    if (option !== undefined) {
      onChange(option.value);
    }
    setOpen(false);
    trigger.current?.focus();
  }

  function onListKey(event: KeyboardEvent<HTMLUListElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => (index + 1) % options.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => (index - 1 + options.length) % options.length);
    } else if (event.key === "Home") {
      event.preventDefault();
      setActive(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActive(options.length - 1);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      pick(active);
    } else if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      setOpen(false);
      trigger.current?.focus();
    }
  }

  function onTriggerKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        toggle();
      }
    }
  }

  return (
    <div ref={root} className="relative">
      <button
        ref={trigger}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={`${label}: ${current?.label ?? ""}`}
        onClick={toggle}
        onKeyDown={onTriggerKey}
        className={`flex min-w-[132px] items-center justify-between gap-3 rounded-full border bg-black/40 py-2 pr-3 pl-4 text-[13px] font-medium text-ink transition-colors duration-200 ease-ui ${
          open ? "border-green-400/40" : "border-line hover:border-line-strong"
        }`}
      >
        <span className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-green-400/80" />
          {current?.label}
        </span>
        <Icon name="chevron" className={`h-3.5 w-3.5 text-ink-faint transition-transform duration-300 ease-ui ${open ? "rotate-180" : ""}`} />
      </button>
      {open &&
        spot !== null &&
        createPortal(
          <ul
            ref={list}
            id={listId}
            role="listbox"
            tabIndex={-1}
            aria-label={label}
            aria-activedescendant={`${listId}-${active}`}
            onKeyDown={onListKey}
            style={{ top: spot.top, left: spot.left }}
            className="glass-strong fixed z-50 flex w-[240px] animate-rise flex-col gap-0.5 rounded-control p-1.5 outline-none"
          >
            {options.map((option, index) => {
              const chosen = option.value === value;
              const lit = index === active;
              return (
                <li
                  key={option.value}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={chosen}
                  onPointerEnter={() => setActive(index)}
                  onClick={() => pick(index)}
                  className={`flex cursor-pointer items-start gap-2.5 rounded-[10px] px-3 py-2 transition-colors duration-150 ${lit ? "bg-white/[0.06]" : ""}`}
                >
                  <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center">
                    {chosen && <Icon name="check" className="h-3.5 w-3.5 text-green-400" />}
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className={`text-[13px] font-medium ${chosen ? "text-ink" : "text-ink-muted"}`}>{option.label}</span>
                    {option.hint !== undefined && <span className="text-[11.5px] text-ink-faint">{option.hint}</span>}
                  </span>
                </li>
              );
            })}
          </ul>,
          document.body,
        )}
    </div>
  );
}
