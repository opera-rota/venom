import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "./Icon.tsx";

export interface ChoiceOption<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly hint?: string;
  readonly icon?: IconName;
}

export interface ChoiceProps<T extends string> {
  readonly label: string;
  readonly value: T;
  readonly options: readonly ChoiceOption<T>[];
  readonly onChange: (value: T) => void;
}

export function Choice<T extends string>({ label, value, options, onChange }: ChoiceProps<T>) {
  const [open, setOpen] = useState(false);
  const [spot, setSpot] = useState<{ readonly top: number; readonly left: number; readonly width: number } | null>(null);
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
      const width = Math.max(box.width, 264);
      setSpot({ top: box.bottom + 6, left: Math.min(box.left, window.innerWidth - width - 12), width });
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
        className={`group flex h-10 min-w-[168px] items-center gap-2.5 rounded-[12px] border bg-black/45 pr-2.5 pl-1.5 text-left backdrop-blur transition-[border-color,box-shadow] duration-200 ease-ui ${
          open ? "border-green-400/55 shadow-[0_0_0_3px_rgba(31,242,92,0.12)]" : "border-line-strong hover:border-green-400/35"
        }`}
      >
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-[8px] border border-green-400/25 bg-green-400/[0.08] text-green-300">
          <Icon name={current?.icon ?? "sparkle"} className="h-3.5 w-3.5" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="hud text-[8.5px] text-ink-faint">{label}</span>
          <span className="truncate text-[13px] font-semibold text-ink">{current?.label}</span>
        </span>
        <Icon name="chevron" className={`h-3.5 w-3.5 shrink-0 text-ink-faint transition-transform duration-300 ease-ui group-hover:text-green-300 ${open ? "rotate-180 text-green-300" : ""}`} />
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
            style={{ top: spot.top, left: spot.left, width: spot.width }}
            className="glass-strong fixed z-50 flex animate-rise flex-col gap-0.5 rounded-[14px] p-1.5 outline-none"
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
                  className={`relative flex cursor-pointer items-center gap-3 rounded-[10px] px-2.5 py-2 transition-colors duration-150 ${lit ? "bg-white/[0.06]" : ""}`}
                >
                  {chosen && <span className="absolute top-2 bottom-2 left-0 w-[3px] rounded-full bg-green-400 shadow-[0_0_10px_rgba(31,242,92,0.9)]" />}
                  <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-[9px] border ${chosen ? "border-green-400/45 bg-green-400/[0.12] text-green-300" : "border-line bg-black/40 text-ink-muted"}`}>
                    <Icon name={option.icon ?? "sparkle"} className="h-3.5 w-3.5" />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className={`text-[13px] font-semibold ${chosen ? "text-ink" : "text-ink-muted"}`}>{option.label}</span>
                    {option.hint !== undefined && <span className="truncate text-[11.5px] text-ink-faint">{option.hint}</span>}
                  </span>
                  {chosen && <Icon name="check" className="h-3.5 w-3.5 shrink-0 text-green-400" />}
                </li>
              );
            })}
          </ul>,
          document.body,
        )}
    </div>
  );
}
