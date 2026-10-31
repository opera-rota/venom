export const button = {
  primary:
    "inline-flex items-center justify-center gap-2 rounded-control bg-green-500 px-5 py-2.5 text-sm font-semibold text-on-accent shadow-accent transition-colors duration-140 ease-ui hover:bg-green-400 active:bg-green-600 disabled:bg-surface-2 disabled:text-ink-faint disabled:shadow-none",
  secondary:
    "inline-flex items-center justify-center gap-2 rounded-control border border-line bg-surface-2 px-5 py-2.5 text-sm font-medium text-ink transition-colors duration-140 ease-ui hover:border-line-strong disabled:text-ink-faint",
  ghost:
    "inline-flex items-center gap-2 rounded-control px-3 py-2 text-sm font-medium text-ink-muted transition-colors duration-140 ease-ui hover:text-ink disabled:text-ink-faint",
  destructive:
    "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-control border border-red-700 bg-surface-2 px-3.5 py-2 text-[13px] font-medium text-red-400 transition-colors duration-140 ease-ui hover:bg-surface-3 disabled:text-ink-faint",
  gateApprove:
    "inline-flex items-center justify-center gap-2 rounded-control border border-line border-l-4 border-l-status-wait bg-surface-2 px-3.5 py-2 text-[13px] font-medium text-ink transition-colors duration-140 ease-ui hover:border-line-strong disabled:text-ink-faint",
  compact:
    "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-control border border-line bg-surface-2 px-3.5 py-2 text-[13px] font-medium text-ink transition-colors duration-140 ease-ui hover:border-line-strong disabled:text-ink-faint",
  halt:
    "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-full bg-red-500 px-4 py-1.5 text-sm font-semibold text-white shadow-accent transition-colors duration-140 ease-ui hover:bg-red-400 disabled:opacity-80",
  mini:
    "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-control px-2 py-1 text-[12px] font-medium text-ink-muted transition-colors duration-140 ease-ui hover:bg-surface-2 hover:text-ink disabled:text-ink-faint disabled:hover:bg-transparent",
  gateCancel:
    "inline-flex items-center justify-center gap-2 rounded-control border border-line bg-surface-2 px-3.5 py-2 text-[13px] font-medium text-ink transition-colors duration-140 ease-ui hover:border-line-strong",
} as const;

export const surface = {
  card: "rounded-control border border-line bg-surface-1 shadow-card",
  cardActive: "rounded-control border border-(--line-accent) bg-surface-1 shadow-card",
  bubble: "rounded-control border border-line bg-surface-2",
  panel: "border-l border-line-subtle bg-surface-1",
  overlay: "rounded-overlay border border-line bg-surface-3 shadow-overlay",
} as const;

export const field = {
  input:
    "w-full resize-none rounded-control border border-line bg-surface-2 px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-faint transition-colors duration-140 ease-ui field-sizing-content focus:border-green-500",
  text:
    "w-full rounded-control border border-line bg-surface-2 px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-faint transition-colors duration-140 ease-ui focus:border-green-500 aria-invalid:border-red-700",
  code:
    "tabular w-full rounded-control border border-line bg-surface-2 px-3.5 py-3 text-center text-xl tracking-[0.5em] text-ink placeholder:text-ink-faint transition-colors duration-140 ease-ui focus:border-green-500 aria-invalid:border-red-700",
  label: "text-[13px] font-medium text-ink",
  hint: "text-[13px] text-ink-muted",
  error: "flex items-start gap-1.5 text-[13px] text-red-400",
} as const;

export const mark = {
  dot: "inline-block h-2 w-2 shrink-0 rounded-full",
  logo: "grid shrink-0 place-items-center rounded-full bg-green-500 font-bold text-on-accent ring-2 ring-mint-200 shadow-mark",
  tag: "inline-flex shrink-0 items-center whitespace-nowrap rounded-tag bg-(--tint-accent) px-2 py-0.5 text-[11.5px] font-medium text-green-300",
  divider: "h-px w-full bg-line-subtle",
  badge: "inline-grid min-w-4 shrink-0 place-items-center rounded-full px-1 text-[10.5px] leading-4 font-semibold tabular-nums",
  track: "h-1.5 w-full overflow-hidden rounded-full bg-surface-2",
  caution: "inline-flex shrink-0 items-center whitespace-nowrap rounded-tag border border-status-wait/40 px-2 py-0.5 text-[11.5px] font-medium text-status-wait",
} as const;

export const text = {
  display: "text-[32px] leading-[1.15] font-bold",
  title: "text-2xl leading-[1.25] font-bold",
  section: "text-lg leading-[1.3] font-semibold",
  support: "text-[13px] leading-normal text-ink-muted",
  detail: "text-[11.5px] leading-[1.45] font-medium",
} as const;
