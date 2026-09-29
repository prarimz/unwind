/*
 * The pieces /earn, /portfolio and /rewards are built from.
 *
 * These are the venue's ledger pages, and they follow the shape the venues
 * people already trust use for theirs: the page's name and its two or three
 * actions on one line, a row of the figures that matter, a chart where there
 * is a history to draw, and dense tables under tabs. Flat panels, hairline
 * borders, no pictures. An earlier version dressed them as the /list card,
 * with a serif hero and a render beside it, and a page that exists to show
 * numbers read as a brochure.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/motion/tabs";

export const BTN = "press inline-flex h-9 items-center justify-center rounded-[8px] bg-foreground px-4 " +
  "text-[13px] font-medium text-background transition-opacity hover:opacity-90 " +
  "disabled:pointer-events-none disabled:opacity-35";
export const GHOST = "press inline-flex h-9 items-center justify-center rounded-[8px] border border-line " +
  "px-4 text-[13px] font-medium transition-colors hover:border-foreground/40 " +
  "disabled:pointer-events-none disabled:opacity-35";
export const SMALL = "press h-7 rounded-[6px] border border-line px-2.5 text-[12px] font-medium " +
  "transition-colors hover:border-foreground/40 disabled:pointer-events-none disabled:opacity-35";
export const LINK = "underline decoration-line underline-offset-4 transition-colors hover:text-foreground";
export const DASH = <span className="font-normal text-dim">–</span>;

/// A panel's side padding.
export const PAD = "px-4 sm:px-5";
/// A label over a figure or a column: small, spaced, quiet.
export const LABEL = "text-[11px] font-medium uppercase tracking-[.08em] text-dim";

export const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
export const isAddress = (s: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);

/// The page's violet light across the top, fading out before the content, as
/// every page below the front page opens (dark mode only).
export const Field = () => (
  <img src="/waitlist/field.webp" alt="" aria-hidden
    className="pointer-events-none absolute inset-x-0 top-[76px] hidden h-[380px] w-full
               object-cover opacity-50 [mask-image:linear-gradient(to_bottom,black,transparent)]
               dark:block" />
);

/// The page's name, one line under it, and its actions at the far end.
export function PageTop({ title, lede, actions }: {
  title: string; lede?: ReactNode; actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="min-w-0">
        <h1 className="font-serif-display text-[clamp(2.25rem,4vw,3rem)] leading-none tracking-[-.02em]">
          {title}
        </h1>
        {lede && <p className="mt-2.5 max-w-[60ch] text-[13.5px] leading-[1.55] text-muted-foreground">{lede}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/// A row of the page's figures. Each is a label, the number, and one line.
export function Tiles({ items }: {
  items: { k: ReactNode; v: ReactNode; sub?: ReactNode; tone?: string }[];
}) {
  return (
    <div className="mt-6 grid gap-px overflow-hidden rounded-[12px] border border-line bg-line
                    sm:grid-cols-2 lg:grid-cols-4">
      {items.map((x, i) => (
        <div key={i} className={`bg-panel ${PAD} py-4`}>
          <div className={LABEL}>{x.k}</div>
          <div className={`n mt-2 text-[24px] font-semibold leading-none tracking-[-.02em] ${x.tone ?? ""}`}>
            {x.v}
          </div>
          <div className="n mt-2 min-h-[16px] text-[12px] text-muted-foreground">{x.sub}</div>
        </div>
      ))}
    </div>
  );
}

/// A flat bordered panel, with an optional title row.
export function Panel({ title, aside, children, className = "" }: {
  title?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section className={`mt-4 overflow-hidden rounded-[12px] border border-line bg-panel ${className}`}>
      {(title || aside) && (
        <div className={`flex min-h-[48px] flex-wrap items-center justify-between gap-3 ${PAD} py-2.5`}>
          {typeof title === "string" ? <h2 className="text-[14px] font-medium">{title}</h2> : title}
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}

/// The tabs a panel's tables sit under: text on a hairline, no pills.
export function PanelTabs<T extends string>({ tabs, value, onChange, aside }: {
  tabs: [T, ReactNode][]; value: T; onChange: (t: T) => void; aside?: ReactNode;
}) {
  return (
    <div className={`flex flex-wrap items-center justify-between gap-x-3 border-b border-line ${PAD}`}>
      <Tabs value={value} onValueChange={(t) => onChange(t as T)} variant="underline"
        className="min-w-0 max-w-full">
        <TabsList className="-mb-px gap-0 border-0">
          {tabs.map(([k, label]) => (
            <TabsTrigger key={k} value={k}
              className="min-h-[44px] px-3 text-[13px] font-medium first:pl-0"
              indicatorClassName="bg-foreground">
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {aside && <div className="py-2">{aside}</div>}
    </div>
  );
}

/// A count beside a tab's label.
export const Count = ({ n }: { n: number }) =>
  n > 0 ? <span className="n ml-1.5 text-[11.5px] text-dim">{n}</span> : null;

/// A small choice between a few words: the chart's period, the board's.
export function Seg<T extends string>({ options, value, onChange }: {
  options: [T, string][]; value: T; onChange: (v: T) => void;
}) {
  return (
    <div className="flex items-center gap-0.5 rounded-[7px] border border-line p-0.5 text-[12px]">
      {options.map(([k, label]) => (
        <button key={k} type="button" onClick={() => onChange(k)} aria-pressed={value === k}
          className={`rounded-[5px] px-2 py-1 transition-colors ${value === k
            ? "bg-panel3 font-medium text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
          {label}
        </button>
      ))}
    </div>
  );
}

/// One key and its value, in a list of them.
export const KV = ({ k, children, tone = "" }: { k: ReactNode; children: ReactNode; tone?: string }) => (
  <div className="flex items-baseline justify-between gap-4 border-t border-linesoft py-2.5 first:border-t-0">
    <span className="flex-none text-[13px] text-muted-foreground">{k}</span>
    <span className={`n min-w-0 truncate text-right text-[13px] font-medium ${tone}`}>{children}</span>
  </div>
);

/// A table's header row.
export const Head = ({ children, cols }: { children: ReactNode; cols: string }) => (
  <div className={`${cols} ${PAD} py-2.5 ${LABEL} font-normal`}>{children}</div>
);

export const ROW = `border-t border-linesoft ${PAD} py-3 text-[13px]`;

export const Empty = ({ children }: { children: ReactNode }) => (
  <p className={`border-t border-linesoft ${PAD} py-10 text-[13px] text-muted-foreground`}>{children}</p>
);

/// Three grey bars where a table will be, so a read in progress looks like a
/// table on its way rather than a sentence that never changes.
export const Skeleton = () => (
  <div className={`border-t border-linesoft ${PAD} py-4`} aria-label="Loading">
    {[0.9, 0.7, 0.8].map((w, i) => (
      <div key={i} className="my-2.5 h-3 animate-pulse rounded-full bg-panel3"
        style={{ width: `${w * 100}%` }} />
    ))}
  </div>
);

/// A note under a table.
export const Foot = ({ children }: { children: ReactNode }) => (
  <p className={`border-t border-linesoft ${PAD} py-3 text-[12px] text-muted-foreground`}>{children}</p>
);

/// Everything on these pages is public, so any wallet can be read. This is
/// the way in for a visitor with no wallet connected, or someone else's.
export function Lookup({ path }: { path: string }) {
  const [v, setV] = useState("");
  const ok = isAddress(v.trim());
  return (
    <form className="flex items-center gap-2"
      onSubmit={(e) => { e.preventDefault(); if (ok) location.href = `${path}?wallet=${v.trim()}`; }}>
      <input value={v} onChange={(e) => setV(e.target.value)} spellCheck={false}
        placeholder="Look up any wallet" aria-label="Wallet address"
        className="n h-9 w-[200px] min-w-0 rounded-[8px] border border-line bg-panel px-3
                   text-[13px] outline-none transition-colors placeholder:text-dim
                   focus:border-foreground/40" />
      <button type="submit" disabled={!ok} className={GHOST}>View</button>
    </form>
  );
}

const hashTab = <T extends string>(keys: readonly T[], fallback: T) => {
  const h = location.hash.slice(1) as T;
  return keys.includes(h) ? h : fallback;
};

/// The tab in the hash, so a link can open straight to one.
export function useHashTab<T extends string>(keys: readonly T[], fallback: T) {
  const [tab, setTab] = useState<T>(() => hashTab(keys, fallback));
  useEffect(() => {
    const sync = () => setTab(hashTab(keys, fallback));
    addEventListener("hashchange", sync);
    return () => removeEventListener("hashchange", sync);
  }, [keys, fallback]);
  const go = (t: T) => {
    setTab(t);
    history.replaceState(null, "", `${location.pathname}${location.search}#${t}`);
  };
  return [tab, go] as const;
}

/*
 * A line over time.
 *
 * One series, drawn to fit, with the level it started from as a dashed
 * baseline so a fall reads as one. Three gridlines with their values on the
 * right and the span's ends underneath, as the venues draw theirs. Hovering
 * reads a point.
 */
export function Chart({ points, format, height = 220, empty }: {
  /// `[unix seconds, value]`, oldest first.
  points: [number, number][]; format: (v: number) => string; height?: number; empty?: ReactNode;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 1000, H = height, PADY = 12;
  const geo = useMemo(() => {
    if (points.length < 2) return null;
    const ts = points.map((p) => p[0]), vs = points.map((p) => p[1]);
    const t0 = ts[0], t1 = ts[ts.length - 1];
    let lo = Math.min(...vs), hi = Math.max(...vs);
    if (hi === lo) { hi += Math.abs(hi) * 0.001 || 1; lo -= Math.abs(lo) * 0.001 || 1; }
    const pad = (hi - lo) * 0.12;
    lo -= pad; hi += pad;
    const x = (t: number) => ((t - t0) / (t1 - t0 || 1)) * W;
    const y = (v: number) => PADY + (1 - (v - lo) / (hi - lo)) * (H - PADY * 2);
    const d = points.map((p, i) => `${i ? "L" : "M"}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join("");
    const area = `${d}L${x(t1).toFixed(1)},${H}L${x(t0).toFixed(1)},${H}Z`;
    const ticks = [0, 0.5, 1].map((f) => lo + (hi - lo) * f);
    return { x, y, d, area, ticks, t0, t1 };
  }, [points, H]);

  if (!geo) {
    return (
      <div className="grid place-items-center text-[13px] text-muted-foreground" style={{ height }}>
        {empty ?? "Nothing recorded yet."}
      </div>
    );
  }
  const first = points[0][1], last = points[points.length - 1][1];
  const up = last >= first;
  const at = hover == null ? null : points[hover];
  const day = (t: number) => new Date(t * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const when = (t: number) => new Date(t * 1000).toLocaleString(undefined,
    { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block w-full"
        style={{ height }}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const f = (e.clientX - r.left) / r.width;
          const t = geo.t0 + f * (geo.t1 - geo.t0);
          let i = 0;
          while (i < points.length - 1 && points[i + 1][0] <= t) i++;
          setHover(i);
        }}
        onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="currentColor" stopOpacity=".18" />
            <stop offset="1" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        {geo.ticks.map((v) => (
          <line key={v} x1="0" x2={W} y1={geo.y(v)} y2={geo.y(v)}
            className="stroke-linesoft" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        ))}
        <line x1="0" x2={W} y1={geo.y(first)} y2={geo.y(first)} className="stroke-dim"
          strokeWidth="1" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" opacity=".7" />
        <g className={up ? "text-up" : "text-down"}>
          <path d={geo.area} fill="url(#chart-fill)" />
          <path d={geo.d} fill="none" stroke="currentColor" strokeWidth="1.5"
            vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        </g>
        {at && (
          <line x1={geo.x(at[0])} x2={geo.x(at[0])} y1="0" y2={H} className="stroke-foreground"
            strokeWidth="1" vectorEffect="non-scaling-stroke" opacity=".5" />
        )}
      </svg>
      {/* Values on the gridlines, and the span under it. HTML, not SVG text,
          so the letters do not stretch with the drawing. */}
      {geo.ticks.map((v) => (
        <span key={v} className="n pointer-events-none absolute right-0 -translate-y-full pr-0.5
                                 text-[10.5px] text-dim"
          style={{ top: `${(geo.y(v) / H) * 100}%` }}>
          {format(v)}
        </span>
      ))}
      <div className="n mt-1.5 flex justify-between text-[11px] text-dim">
        <span>{day(geo.t0)}</span>
        <span>{day(geo.t1)}</span>
      </div>
      {at && (
        <div className="n pointer-events-none absolute top-2 rounded-[6px] border border-line bg-panel2
                        px-2 py-1 text-[11.5px] shadow-[0_4px_16px_-6px_rgba(0,0,0,.5)]"
          style={{ left: `min(max(${(geo.x(at[0]) / W) * 100}%, 0px), calc(100% - 150px))` }}>
          <span className="font-medium">{format(at[1])}</span>
          <span className="ml-2 text-muted-foreground">{when(at[0])}</span>
        </div>
      )}
    </div>
  );
}
