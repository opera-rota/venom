export const button = {
  primary:
    "inline-flex items-center gap-2 rounded-control bg-green-500 px-5 py-2.5 text-sm font-semibold text-on-accent shadow-accent transition-colors duration-140 ease-ui hover:bg-green-400 active:bg-green-600 disabled:bg-surface-2 disabled:text-ink-faint disabled:shadow-none",
  ghost:
    "inline-flex items-center gap-2 rounded-control px-3 py-2 text-sm font-medium text-ink-muted transition-colors duration-140 ease-ui hover:text-ink",
} as const;

export const surface = {
  card: "rounded-control border border-line bg-surface-1 shadow-card",
  bubble: "rounded-control border border-line bg-surface-2",
} as const;

export const field = {
  input:
    "w-full resize-none rounded-control border border-line bg-surface-2 px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-faint transition-colors duration-140 ease-ui field-sizing-content focus:border-green-500",
} as const;

export const mark = {
  dot: "inline-block h-2 w-2 shrink-0 rounded-full",
  logo: "grid shrink-0 place-items-center rounded-full bg-green-500 font-bold text-on-accent ring-2 ring-mint-200 shadow-mark",
} as const;

export const text = {
  display: "text-[32px] leading-[1.15] font-bold",
  section: "text-lg leading-[1.3] font-semibold",
  support: "text-[13px] leading-normal text-ink-muted",
  detail: "text-[11.5px] leading-[1.45] font-medium",
} as const;
