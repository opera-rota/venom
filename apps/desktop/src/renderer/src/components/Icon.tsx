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
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, className = "h-3.5 w-3.5" }: { readonly name: IconName; readonly className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={paths[name]} />
    </svg>
  );
}
