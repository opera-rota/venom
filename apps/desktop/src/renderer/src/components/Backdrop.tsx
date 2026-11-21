const smoke =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='900' height='900'%3E%3Cfilter id='s'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.006 0.011' numOctaves='5' seed='7'/%3E%3CfeColorMatrix values='0 0 0 0 0.12 0 0 0 0 0.95 0 0 0 0 0.36 0 0 0 1.25 -0.52'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23s)'/%3E%3C/svg%3E\")";

const grain =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E%3Cfilter id='g'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.09 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23g)'/%3E%3C/svg%3E\")";

const lattice =
  "linear-gradient(rgba(120,255,160,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(120,255,160,0.045) 1px, transparent 1px)";

export function Backdrop() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-base" aria-hidden="true">
      <div className="absolute -top-[30%] -left-[20%] h-[85vmax] w-[85vmax] rounded-full bg-[radial-gradient(circle,rgba(31,242,92,0.22),transparent_62%)] blur-3xl animate-drift will-change-transform" />
      <div className="absolute -right-[25%] -bottom-[35%] h-[90vmax] w-[90vmax] rounded-full bg-[radial-gradient(circle,rgba(10,122,44,0.32),transparent_60%)] blur-3xl animate-drift-slow will-change-transform" />
      <div className="absolute top-[20%] right-[18%] h-[38vmax] w-[38vmax] rounded-full bg-[radial-gradient(circle,rgba(194,255,219,0.07),transparent_65%)] blur-2xl animate-breathe" />
      <div className="absolute -inset-[20%] opacity-55 mix-blend-screen animate-drift-slow will-change-transform" style={{ backgroundImage: smoke, backgroundSize: "900px 900px" }} />
      <div
        className="absolute inset-0 opacity-60"
        style={{
          backgroundImage: lattice,
          backgroundSize: "56px 56px",
          maskImage: "radial-gradient(ellipse 70% 60% at 50% 40%, black 10%, transparent 75%)",
        }}
      />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_120%_90%_at_50%_50%,transparent_40%,rgba(1,3,2,0.85))]" />
      <div className="absolute inset-0 opacity-70 mix-blend-overlay" style={{ backgroundImage: grain }} />
    </div>
  );
}
