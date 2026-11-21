const smoke =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1600' height='1000'%3E%3Cfilter id='s'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.004 0.009' numOctaves='5' seed='7'/%3E%3CfeColorMatrix values='0 0 0 0 0.16 0 0 0 0 0.5 0 0 0 0 0.3 0 0 0 1.25 -0.6'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23s)'/%3E%3C/svg%3E\")";

const grain =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E%3Cfilter id='g'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.08 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23g)'/%3E%3C/svg%3E\")";

const lattice =
  "linear-gradient(rgba(200,255,220,0.028) 1px, transparent 1px), linear-gradient(90deg, rgba(200,255,220,0.028) 1px, transparent 1px)";

type Point = readonly [number, number];

interface Strand {
  readonly from: Point;
  readonly curves: readonly (readonly [Point, Point, Point])[];
  readonly width: number;
  readonly tip?: number;
}

const strands: readonly Strand[] = [
  { from: [210, 360], curves: [[[250, 250], [330, 196], [420, 186]], [[500, 178], [548, 126], [526, 52]]], width: 30 },
  { from: [405, 190], curves: [[[452, 168], [488, 128], [472, 84]]], width: 12 },
  { from: [300, 480], curves: [[[410, 446], [500, 476], [560, 536]], [[612, 588], [688, 604], [752, 566]]], width: 28 },
  { from: [118, 440], curves: [[[92, 330], [146, 246], [118, 158]], [[104, 106], [70, 74], [34, 66]]], width: 26 },
  { from: [380, 720], curves: [[[470, 690], [560, 722], [604, 784]], [[630, 820], [672, 834], [712, 810]]], width: 20 },
  { from: [548, 528], curves: [[[572, 490], [626, 478], [664, 498]]], width: 10 },
  { from: [112, 310], curves: [[[66, 290], [40, 248], [26, 206]]], width: 10 },
  { from: [250, 600], curves: [[[300, 640], [320, 700], [300, 760]]], width: 14 },
];

function sample(strand: Strand): readonly { readonly point: Point; readonly normal: Point }[] {
  const samples: { point: Point; normal: Point }[] = [];
  let start = strand.from;
  for (const [c1, c2, end] of strand.curves) {
    for (let step = 0; step < 40; step += 1) {
      const t = step / 40;
      const u = 1 - t;
      const x = u * u * u * start[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * end[0];
      const y = u * u * u * start[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * end[1];
      const dx = 3 * u * u * (c1[0] - start[0]) + 6 * u * t * (c2[0] - c1[0]) + 3 * t * t * (end[0] - c2[0]);
      const dy = 3 * u * u * (c1[1] - start[1]) + 6 * u * t * (c2[1] - c1[1]) + 3 * t * t * (end[1] - c2[1]);
      const length = Math.hypot(dx, dy) || 1;
      samples.push({ point: [x, y], normal: [-dy / length, dx / length] });
    }
    start = end;
  }
  const last = samples.at(-1);
  if (last !== undefined) {
    samples.push({ point: start, normal: last.normal });
  }
  return samples;
}

function tapered(strand: Strand): string {
  const samples = sample(strand);
  const count = samples.length - 1;
  const side = (sign: number) =>
    samples.map(({ point, normal }, index) => {
      const fade = Math.pow(1 - index / count, 0.85);
      const half = (strand.width / 2) * fade + ((strand.tip ?? 0.8) / 2) * (1 - fade);
      return `${(point[0] + normal[0] * half * sign).toFixed(1)} ${(point[1] + normal[1] * half * sign).toFixed(1)}`;
    });
  return `M${side(1).join("L")}L${side(-1).reverse().join("L")}Z`;
}

function sheen(strand: Strand): string {
  const samples = sample(strand);
  const count = samples.length - 1;
  return `M${samples
    .slice(2, Math.round(count * 0.8))
    .map(({ point, normal }, index) => {
      const half = (strand.width / 2) * Math.pow(1 - (index + 2) / count, 0.85) * 0.45;
      return `${(point[0] + normal[0] * half).toFixed(1)} ${(point[1] + normal[1] * half).toFixed(1)}`;
    })
    .join("L")}`;
}

const body =
  "M0 900L0 500C34 452 72 428 122 418C176 406 196 352 238 322C290 284 344 300 370 344C398 392 374 446 334 474C304 496 312 538 352 558C404 584 436 640 414 702C398 752 434 800 484 830C524 856 544 880 566 900Z";

const limbs = strands.map((strand) => ({ shape: tapered(strand), gloss: sheen(strand) }));

function Symbiote({ id, className }: { readonly id: string; readonly className: string }) {
  return (
    <svg viewBox="0 0 800 900" preserveAspectRatio="xMinYMax meet" className={className} aria-hidden="true">
      <defs>
        <filter id={`${id}-ooze`} x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency="0.009" numOctaves="2" seed="4" />
          <feDisplacementMap in="SourceGraphic" scale="14" />
        </filter>
        <filter id={`${id}-rim`} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="7" />
        </filter>
        <radialGradient id={`${id}-skin`} cx="26%" cy="62%" r="85%">
          <stop offset="0%" stopColor="#101513" />
          <stop offset="45%" stopColor="#060807" />
          <stop offset="100%" stopColor="#010101" />
        </radialGradient>
        <linearGradient id={`${id}-gloss`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#e8fff0" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#8bffa8" stopOpacity="0.08" />
        </linearGradient>
      </defs>
      <g filter={`url(#${id}-ooze)`}>
        <g filter={`url(#${id}-rim)`} opacity="0.28">
          <path d={body} fill="none" stroke="#1ff25c" strokeWidth="8" />
          {limbs.map((limb) => (
            <path key={limb.shape} d={limb.shape} fill="none" stroke="#1ff25c" strokeWidth="8" />
          ))}
        </g>
        <path d={body} fill={`url(#${id}-skin)`} />
        {limbs.map((limb) => (
          <path key={limb.shape} d={limb.shape} fill={`url(#${id}-skin)`} />
        ))}
        {limbs.map((limb) => (
          <path key={limb.gloss} d={limb.gloss} fill="none" stroke={`url(#${id}-gloss)`} strokeWidth="1.6" strokeLinecap="round" />
        ))}
        <path d="M60 470C120 440 170 420 210 380" fill="none" stroke={`url(#${id}-gloss)`} strokeWidth="2" strokeLinecap="round" opacity="0.6" />
        <ellipse cx="150" cy="560" rx="70" ry="28" fill="#e8fff0" opacity="0.025" transform="rotate(-30 150 560)" />
      </g>
    </svg>
  );
}

const neck: Strand = {
  from: [70, 940],
  curves: [
    [[70, 770], [246, 708], [252, 566]],
    [[258, 470], [222, 420], [272, 344]],
  ],
  width: 170,
  tip: 74,
};

const tail: Strand = {
  from: [140, 910],
  curves: [
    [[320, 856], [450, 906], [580, 852]],
    [[650, 822], [700, 842], [744, 884]],
  ],
  width: 76,
  tip: 2,
};

const horns: readonly Strand[] = [
  { from: [306, 276], curves: [[[262, 222], [212, 202], [170, 216]], [[138, 228], [116, 206], [120, 172]]], width: 28, tip: 0.6 },
  { from: [284, 296], curves: [[[242, 266], [202, 266], [170, 288]]], width: 17, tip: 0.6 },
  { from: [342, 262], curves: [[[332, 232], [322, 212], [334, 190]]], width: 11, tip: 0.5 },
  { from: [300, 368], curves: [[[278, 386], [256, 392], [232, 388]]], width: 12, tip: 0.5 },
  { from: [330, 376], curves: [[[318, 396], [302, 410], [282, 414]]], width: 9, tip: 0.5 },
];

const spines: readonly Strand[] = [0.42, 0.55, 0.67, 0.78, 0.88].map((place, index) => {
  const samples = sample(neck);
  const { point, normal } = samples[Math.round(place * (samples.length - 1))] ?? { point: [0, 0] as Point, normal: [1, 0] as Point };
  const half = (neck.width / 2) * Math.pow(1 - place, 0.85) + ((neck.tip ?? 0) / 2) * (1 - Math.pow(1 - place, 0.85));
  const base: Point = [point[0] - normal[0] * (half - 6), point[1] - normal[1] * (half - 6)];
  const length = 58 - index * 7;
  const reach: Point = [base[0] - normal[0] * length, base[1] - normal[1] * length + length * 0.55];
  const bend: Point = [base[0] - normal[0] * length * 0.55, base[1] - normal[1] * length * 0.55 - 4];
  return { from: base, curves: [[bend, bend, reach]], width: 24 - index * 2.5, tip: 0.5 };
});

const wrist: Point = [150, 250];

const wingTips: readonly Point[] = [
  [318, 96],
  [214, 28],
  [96, 58],
  [20, 170],
  [10, 330],
];

const wingArm: Strand = { from: [206, 610], curves: [[[176, 500], [150, 380], wrist]], width: 38, tip: 14 };

const fingers: readonly Strand[] = wingTips.map(([x, y]) => ({
  from: wrist,
  curves: [[[wrist[0] + (x - wrist[0]) * 0.35, wrist[1] + (y - wrist[1]) * 0.25], [wrist[0] + (x - wrist[0]) * 0.75, wrist[1] + (y - wrist[1]) * 0.7], [x, y]]],
  width: 11,
  tip: 0.6,
}));

function scallop(from: Point, to: Point): string {
  const middle: Point = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
  const pull: Point = [middle[0] + (wrist[0] - middle[0]) * 0.32, middle[1] + (wrist[1] - middle[1]) * 0.32];
  return `Q${pull[0].toFixed(1)} ${pull[1].toFixed(1)} ${to[0]} ${to[1]}`;
}

const membrane = (() => {
  const first = wingTips[0] ?? wrist;
  const parts = [`M206 610Q170 420 ${wrist[0]} ${wrist[1]}L${first[0]} ${first[1]}`];
  for (let index = 1; index < wingTips.length; index += 1) {
    parts.push(scallop(wingTips[index - 1] ?? wrist, wingTips[index] ?? wrist));
  }
  parts.push("Q70 560 176 700Z");
  return parts.join("");
})();

const fringes: readonly Strand[] = [
  { from: [10, 330], curves: [[[0, 370], [6, 400], [24, 418]]], width: 7, tip: 0.4 },
  { from: [96, 58], curves: [[[80, 40], [80, 20], [94, 4]]], width: 6, tip: 0.4 },
  { from: [318, 96], curves: [[[344, 96], [360, 110], [362, 134]]], width: 6, tip: 0.4 },
];

const skull =
  "M250 330C262 286 300 262 350 256L420 262C452 266 490 282 528 304C540 311 540 320 528 324L470 334C440 338 410 342 386 350C356 360 330 372 300 376C270 378 248 360 250 330Z";

const jaw = "M312 374C352 366 402 358 452 352C472 350 480 358 468 364C432 380 382 392 342 398C320 400 304 388 312 374Z";

const fangs = "M424 339l4 13 4-14ZM448 336l3 11 4-12ZM470 332l3 9 3-10ZM402 343l3 11 4-12Z";

const brow = "M354 284L418 270L446 282L402 286Z";

const dragonLimbs = [tail, neck, wingArm, ...horns, ...spines, ...fingers, ...fringes].map(tapered);

function Dragon({ className }: { readonly className: string }) {
  return (
    <svg viewBox="-40 20 840 900" preserveAspectRatio="xMinYMax meet" className={className} aria-hidden="true">
      <defs>
        <filter id="dragon-ooze" x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency="0.012" numOctaves="2" seed="9" />
          <feDisplacementMap in="SourceGraphic" scale="7" />
        </filter>
        <filter id="dragon-rim" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="6" />
        </filter>
        <filter id="dragon-eye" x="-200%" y="-200%" width="500%" height="500%">
          <feGaussianBlur stdDeviation="5" />
        </filter>
        <radialGradient id="dragon-skin" cx="40%" cy="35%" r="80%">
          <stop offset="0%" stopColor="#33443a" />
          <stop offset="50%" stopColor="#101713" />
          <stop offset="100%" stopColor="#010101" />
        </radialGradient>
        <linearGradient id="dragon-wing" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#1a2620" stopOpacity="0.75" />
          <stop offset="55%" stopColor="#0a100d" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#030404" stopOpacity="0.95" />
        </linearGradient>
        <linearGradient id="dragon-gloss" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#e8fff0" stopOpacity="0.8" />
          <stop offset="100%" stopColor="#8bffa8" stopOpacity="0.15" />
        </linearGradient>
        <radialGradient id="dragon-maw" cx="15%" cy="50%" r="85%">
          <stop offset="0%" stopColor="#1ff25c" stopOpacity="0.42" />
          <stop offset="100%" stopColor="#1ff25c" stopOpacity="0" />
        </radialGradient>
      </defs>
      <g filter="url(#dragon-ooze)">
        <g filter="url(#dragon-rim)" opacity="0.9" fill="none" stroke="#1ff25c" strokeWidth="11">
          <path d={membrane} />
          <path d={skull} />
          <path d={jaw} />
          {dragonLimbs.map((shape) => (
            <path key={shape} d={shape} />
          ))}
        </g>
        <path d={membrane} fill="url(#dragon-wing)" stroke="#22322a" strokeWidth="1.2" />
        {dragonLimbs.map((shape) => (
          <path key={shape} d={shape} fill="url(#dragon-skin)" />
        ))}
        <path d="M330 368C370 356 420 348 470 340C440 360 390 372 344 382Z" fill="url(#dragon-maw)" />
        <path d={jaw} fill="url(#dragon-skin)" />
        <path d={fangs} fill="#2a332d" />
        <path d={skull} fill="url(#dragon-skin)" />
        <path d={brow} fill="#010202" />
        <path d="M276 312C316 278 390 266 470 288" fill="none" stroke="url(#dragon-gloss)" strokeWidth="2" strokeLinecap="round" />
        <path d="M100 900C120 800 236 724 246 604C252 530 238 450 270 384" fill="none" stroke="url(#dragon-gloss)" strokeWidth="2.2" strokeLinecap="round" opacity="0.45" />
        <path d="M110 560C100 440 80 340 60 280" fill="none" stroke="url(#dragon-gloss)" strokeWidth="1.4" strokeLinecap="round" opacity="0.35" />
      </g>
      <g className="animate-glint">
        <ellipse cx="404" cy="292" rx="17" ry="7" fill="#1ff25c" opacity="0.7" filter="url(#dragon-eye)" transform="rotate(-10 404 292)" />
        <ellipse cx="404" cy="292" rx="11" ry="2.8" fill="#a6ffc0" transform="rotate(-10 404 292)" />
      </g>
      <circle cx="518" cy="310" r="1.8" fill="#1ff25c" opacity="0.5" />
    </svg>
  );
}

export function Backdrop() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-base" aria-hidden="true">
      <div className="absolute -top-[30%] -left-[20%] h-[85vmax] w-[85vmax] rounded-full bg-[radial-gradient(circle,rgba(31,242,92,0.09),transparent_62%)] blur-3xl animate-drift will-change-transform" />
      <div className="absolute -right-[25%] -bottom-[35%] h-[90vmax] w-[90vmax] rounded-full bg-[radial-gradient(circle,rgba(10,122,44,0.14),transparent_60%)] blur-3xl animate-drift-slow will-change-transform" />
      <div className="absolute inset-0 animate-smoke opacity-35 mix-blend-screen will-change-transform" style={{ backgroundImage: smoke, backgroundSize: "cover", backgroundRepeat: "no-repeat" }} />
      <div className="absolute -top-[6%] -right-[6%] h-[58vh] opacity-60">
        <div className="h-full origin-top-right animate-writhe-slow will-change-transform">
          <Symbiote id="symbiote-right" className="h-full w-auto -scale-100" />
        </div>
      </div>
      <div
        className="absolute inset-0 opacity-60"
        style={{
          backgroundImage: lattice,
          backgroundSize: "56px 56px",
          maskImage: "radial-gradient(ellipse 70% 60% at 50% 40%, black 10%, transparent 75%)",
        }}
      />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_120%_90%_at_50%_50%,transparent_35%,rgba(0,0,0,0.9))]" />
      <div className="absolute -bottom-[2%] -left-[10%] h-[80vh] origin-bottom-left animate-writhe will-change-transform">
        <Dragon className="h-full w-auto" />
      </div>
      <div className="absolute inset-0 opacity-70 mix-blend-overlay" style={{ backgroundImage: grain }} />
    </div>
  );
}
