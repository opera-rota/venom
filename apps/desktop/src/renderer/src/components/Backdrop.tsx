const smoke = (seed: number, tone: string, density = "1.35 -0.62") =>
  `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1600' height='1000'%3E%3Cfilter id='s'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.0035 0.008' numOctaves='5' seed='${seed}'/%3E%3CfeColorMatrix values='0 0 0 0 ${tone} 0 0 0 0 0.72 0 0 0 0 0.32 0 0 0 ${density}'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23s)'/%3E%3C/svg%3E")`;

const grain =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E%3Cfilter id='g'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.08 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23g)'/%3E%3C/svg%3E\")";

const wisps = [
  { left: "2%", size: "26vmax", delay: "0s", duration: "22s" },
  { left: "18%", size: "22vmax", delay: "-9s", duration: "27s" },
  { left: "34%", size: "18vmax", delay: "-17s", duration: "25s" },
];

const clouds = [
  { place: { top: "-9vmax", right: "-8vmax" }, size: "26vmax", delay: "0s", duration: "13s", seed: 31 },
  { place: { top: "34%", right: "-12vmax" }, size: "22vmax", delay: "-5s", duration: "16s", seed: 47 },
  { place: { bottom: "-10vmax", right: "8%" }, size: "24vmax", delay: "-9s", duration: "15s", seed: 59 },
  { place: { top: "-11vmax", left: "42%" }, size: "20vmax", delay: "-3s", duration: "17s", seed: 71 },
];

export function Backdrop() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-black" aria-hidden="true">
      <div className="absolute -bottom-[25%] -left-[15%] h-[75vmax] w-[75vmax] rounded-full bg-[radial-gradient(circle,rgba(31,242,92,0.11),transparent_58%)] blur-3xl animate-drift will-change-transform" />
      <div
        className="absolute inset-0 animate-smoke opacity-55 mix-blend-screen will-change-transform"
        style={{ backgroundImage: smoke(7, "0.1"), backgroundSize: "cover", maskImage: "radial-gradient(ellipse 62% 85% at 22% 60%, black 20%, transparent 75%)" }}
      />
      <div
        className="absolute inset-0 animate-smoke-back opacity-40 mix-blend-screen will-change-transform"
        style={{ backgroundImage: smoke(23, "0.16"), backgroundSize: "cover", maskImage: "radial-gradient(ellipse 80% 45% at 35% 100%, black 15%, transparent 72%)" }}
      />
      {wisps.map((wisp) => (
        <span
          key={wisp.left}
          className="absolute -bottom-[24vmax] animate-wisp rounded-full bg-[radial-gradient(circle,rgba(46,255,110,0.12),transparent_60%)] blur-2xl"
          style={{ left: wisp.left, width: wisp.size, height: wisp.size, animationDelay: wisp.delay, animationDuration: wisp.duration }}
        />
      ))}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_90%_100%_at_30%_55%,transparent_45%,rgba(0,0,0,0.55)_78%,rgba(0,0,0,0.85))]" />
      {clouds.map((cloud) => (
        <span
          key={cloud.seed}
          className="absolute animate-cloud mix-blend-screen will-change-transform"
          style={{
            ...cloud.place,
            width: cloud.size,
            height: cloud.size,
            animationDelay: cloud.delay,
            animationDuration: cloud.duration,
            backgroundImage: `${smoke(cloud.seed, "0.16", "1.9 -0.68")}, radial-gradient(circle, rgba(31,242,92,0.1), transparent 60%)`,
            backgroundSize: "cover, cover",
            maskImage: "radial-gradient(circle, black 10%, transparent 62%)",
            filter: "blur(6px)",
          }}
        />
      ))}
      <div className="absolute inset-0 opacity-60 mix-blend-overlay" style={{ backgroundImage: grain }} />
    </div>
  );
}
