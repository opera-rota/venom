const paths = {
  check: "M3.5 8.5l3 3 6-7",
  hourglass: "M4.5 2.5h7M4.5 13.5h7M5.5 2.5c0 3 5 3.5 5 5.5s-5 2.5-5 5.5M10.5 2.5c0 3-5 3.5-5 5.5s5 2.5 5 5.5",
  cross: "M4.5 4.5l7 7M11.5 4.5l-7 7",
  dash: "M4 8h8",
  send: "M2.5 8h9M8 4.5L11.5 8 8 11.5",
  back: "M13.5 8h-9M8 4.5L4.5 8 8 11.5",
  devices: "M2 3.5h9v6.5H2zM4.5 13h4M6.5 10v3M12.5 6h2v7h-2z",
  lock: "M4 7.5h8v6H4zM5.5 7.5V5.5a2.5 2.5 0 0 1 5 0v2",
  mail: "M2 4h12v8H2zM2 4.5l6 4.5 6-4.5",
  plus: "M8 3.5v9M3.5 8h9",
  warning: "M8 2.5l6 11H2zM8 6.5v3M8 11.5v.01",
  copy: "M5.5 5.5h7v7h-7zM3.5 10.5v-7h7",
  retry: "M12.5 8a4.5 4.5 0 1 1-1.3-3.2M12.5 2.5v3h-3",
  down: "M8 3.5v9M4.5 9L8 12.5 11.5 9",
  bolt: "M9 1.5L3.5 9H8l-1 5.5L12.5 7H8z",
  memory: "M4 2.5h8v11L8 10.5l-4 3zM6.5 6h3",
  search: "M7 11.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM10.5 10.5l3 3",
  stop: "M4.5 4.5h7v7h-7z",
  shield: "M8 1.5l5 2v4c0 3.2-2.2 5.6-5 7-2.8-1.4-5-3.8-5-7v-4z",
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, className = "h-3.5 w-3.5" }: { readonly name: IconName; readonly className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={paths[name]} />
    </svg>
  );
}
