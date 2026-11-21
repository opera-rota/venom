import { useId } from "react";

export interface EmblemProps {
  readonly size: number;
  readonly alive?: boolean;
  readonly className?: string;
}

export function Emblem({ size, alive = true, className = "" }: EmblemProps) {
  const id = useId().replace(/:/g, "");
  const core = `${id}-core`;
  const strand = `${id}-strand`;
  const halo = `${id}-halo`;
  return (
    <span className={`relative inline-grid shrink-0 place-items-center ${className}`} style={{ width: size, height: size }} aria-hidden="true">
      <span className={`absolute inset-0 rounded-full bg-green-500/25 blur-md ${alive ? "animate-breathe" : ""}`} />
      <svg viewBox="0 0 64 64" width={size} height={size} className="relative">
        <defs>
          <radialGradient id={core} cx="50%" cy="38%" r="62%">
            <stop offset="0%" stopColor="#1c4a2a" />
            <stop offset="55%" stopColor="#07150c" />
            <stop offset="100%" stopColor="#020503" />
          </radialGradient>
          <linearGradient id={strand} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#c2ffdb" />
            <stop offset="45%" stopColor="#4dff7c" />
            <stop offset="100%" stopColor="#0fc443" />
          </linearGradient>
          <radialGradient id={halo} cx="50%" cy="50%" r="50%">
            <stop offset="70%" stopColor="#4dff7c" stopOpacity="0" />
            <stop offset="100%" stopColor="#4dff7c" stopOpacity="0.55" />
          </radialGradient>
        </defs>
        <circle cx="32" cy="32" r="30" fill={`url(#${core})`} />
        <circle cx="32" cy="32" r="30" fill={`url(#${halo})`} />
        <circle cx="32" cy="32" r="29.5" fill="none" stroke="#4dff7c" strokeOpacity="0.55" strokeWidth="1" />
        <g className={alive ? "origin-center animate-orbit" : ""} style={{ transformBox: "view-box" }}>
          <path d="M8 26a25 25 0 0 1 17-19" fill="none" stroke="#8bffa8" strokeOpacity="0.85" strokeWidth="1.4" strokeLinecap="round" />
          <path d="M56 38a25 25 0 0 1-17 19" fill="none" stroke="#8bffa8" strokeOpacity="0.55" strokeWidth="1.4" strokeLinecap="round" />
          <circle cx="25" cy="7" r="1.6" fill="#c2ffdb" />
        </g>
        <path
          d="M17.5 19c4.2-.6 7.4 2.2 9.2 6.6l5.3 13.2 5.3-13.2c1.8-4.4 5-7.2 9.2-6.6-3.6 2.4-5.4 5.8-7 10l-7.5 19.5L24.5 29c-1.6-4.2-3.4-7.6-7-10z"
          fill={`url(#${strand})`}
        />
        <path d="M22 21.5c2 1.2 3.4 3.3 4.6 6.4l5.4 13.6" fill="none" stroke="#020503" strokeOpacity="0.35" strokeWidth="1.1" strokeLinecap="round" />
        <circle cx="32" cy="53.5" r="1.8" fill="#4dff7c" />
        <circle cx="27.5" cy="57" r="1" fill="#4dff7c" fillOpacity="0.7" />
      </svg>
    </span>
  );
}
