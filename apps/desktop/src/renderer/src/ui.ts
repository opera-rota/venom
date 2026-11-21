export const button = {
  primary:
    "inline-flex items-center justify-center gap-2 rounded-full bg-linear-to-b from-green-400 to-green-600 px-5 py-2.5 text-sm font-semibold text-on-accent shadow-accent transition-[transform,box-shadow,filter] duration-200 ease-ui hover:brightness-110 active:scale-[0.97] disabled:bg-none disabled:bg-surface-2 disabled:text-ink-faint disabled:shadow-none",
  secondary:
    "inline-flex items-center justify-center gap-2 rounded-full border border-line bg-white/[0.03] px-5 py-2.5 text-sm font-medium text-ink backdrop-blur transition-colors duration-200 ease-ui hover:border-green-400/50 hover:bg-green-400/[0.06] disabled:text-ink-faint",
  ghost:
    "inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm font-medium text-ink-muted transition-colors duration-200 ease-ui hover:bg-white/[0.04] hover:text-ink disabled:text-ink-faint",
  destructive:
    "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-full border border-red-500/40 bg-red-500/[0.08] px-3.5 py-1.5 text-[13px] font-medium text-red-400 transition-colors duration-200 ease-ui hover:bg-red-500/[0.16] disabled:text-ink-faint",
  gateApprove:
    "inline-flex items-center justify-center gap-2 rounded-full border border-green-400/45 bg-green-400/[0.1] px-4 py-2 text-[13px] font-semibold text-green-300 shadow-[0_0_18px_-6px_rgba(31,242,92,0.6)] transition-colors duration-200 ease-ui hover:bg-green-400/[0.18] disabled:text-ink-faint",
  compact:
    "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-full border border-line bg-white/[0.03] px-3.5 py-1.5 text-[13px] font-medium text-ink transition-colors duration-200 ease-ui hover:border-green-400/50 hover:text-green-300 disabled:text-ink-faint",
  halt:
    "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-full bg-linear-to-b from-red-400 to-red-500 px-4 py-1.5 text-sm font-semibold text-white shadow-[0_0_0_1px_rgba(255,90,108,0.6),0_0_22px_-4px_rgba(240,48,74,0.8)] transition-[filter,transform] duration-200 ease-ui hover:brightness-110 active:scale-[0.97] disabled:opacity-80",
  mini:
    "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-[12px] font-medium text-ink-muted transition-colors duration-200 ease-ui hover:bg-white/[0.05] hover:text-ink disabled:text-ink-faint disabled:hover:bg-transparent",
  gateCancel:
    "inline-flex items-center justify-center gap-2 rounded-full border border-line bg-white/[0.03] px-4 py-2 text-[13px] font-medium text-ink transition-colors duration-200 ease-ui hover:border-line-strong hover:bg-white/[0.06]",
  icon:
    "relative grid h-10 w-10 shrink-0 place-items-center rounded-full border border-line bg-white/[0.03] text-ink-muted backdrop-blur transition-colors duration-200 ease-ui hover:border-green-400/50 hover:text-green-300",
} as const;

export const surface = {
  card: "glass rounded-control",
  cardActive: "glass-glow rounded-control",
  bubble: "rounded-[18px] rounded-tr-md border border-green-400/25 bg-linear-to-br from-green-400/[0.16] to-green-700/[0.08] shadow-[0_10px_30px_-18px_rgba(31,242,92,0.7)] backdrop-blur",
  panel: "glass rounded-panel",
  overlay: "glass-strong rounded-overlay",
  venom: "glass rounded-[18px] rounded-tl-md",
} as const;

export const field = {
  input:
    "w-full resize-none rounded-control border border-line bg-black/30 px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-faint transition-colors duration-200 ease-ui field-sizing-content focus:border-green-400/70",
  text:
    "w-full rounded-control border border-line bg-black/30 px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-faint transition-colors duration-200 ease-ui focus:border-green-400/70 aria-invalid:border-red-700",
  code:
    "tabular w-full rounded-control border border-line bg-black/30 px-3.5 py-3 text-center text-xl tracking-[0.5em] text-ink placeholder:text-ink-faint transition-colors duration-200 ease-ui focus:border-green-400/70 aria-invalid:border-red-700",
  label: "text-[13px] font-medium text-ink",
  hint: "text-[13px] text-ink-muted",
  error: "flex items-start gap-1.5 text-[13px] text-red-400",
} as const;

export const mark = {
  dot: "inline-block h-2 w-2 shrink-0 rounded-full",
  logo: "grid shrink-0 place-items-center rounded-full bg-green-500 font-bold text-on-accent ring-2 ring-mint-200 shadow-mark",
  tag: "inline-flex shrink-0 items-center whitespace-nowrap rounded-full border border-green-400/25 bg-green-400/[0.08] px-2.5 py-0.5 text-[11.5px] font-medium text-green-300",
  divider: "h-px w-full bg-linear-to-r from-transparent via-line-strong to-transparent",
  badge: "inline-grid min-w-4 shrink-0 place-items-center rounded-full px-1 text-[10.5px] leading-4 font-semibold tabular-nums",
  track: "h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]",
  caution: "inline-flex shrink-0 items-center whitespace-nowrap rounded-full border border-status-wait/40 bg-status-wait/[0.06] px-2.5 py-0.5 text-[11.5px] font-medium text-status-wait",
  reason: "inline-block max-w-full rounded-full border border-status-wait/40 bg-status-wait/[0.06] px-2.5 py-0.5 text-[11.5px] font-medium text-status-wait",
} as const;

export const text = {
  display: "text-[32px] leading-[1.15] font-bold tracking-[-0.02em]",
  title: "text-2xl leading-[1.25] font-bold tracking-[-0.015em]",
  section: "text-lg leading-[1.3] font-semibold",
  support: "text-[13px] leading-normal text-ink-muted",
  detail: "text-[11.5px] leading-[1.45] font-medium",
  eyebrow: "hud text-green-300/80",
} as const;
