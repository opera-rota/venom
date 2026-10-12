const paths = {
  check: "M3.5 8.5l3 3 6-7",
  hourglass: "M4.5 2.5h7M4.5 13.5h7M5.5 2.5c0 3 5 3.5 5 5.5s-5 2.5-5 5.5M10.5 2.5c0 3-5 3.5-5 5.5s5 2.5 5 5.5",
  cross: "M4.5 4.5l7 7M11.5 4.5l-7 7",
  send: "M2.5 8h9M8 4.5L11.5 8 8 11.5",
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, className = "h-3.5 w-3.5" }: { readonly name: IconName; readonly className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={paths[name]} />
    </svg>
  );
}
