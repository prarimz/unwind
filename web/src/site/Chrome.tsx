import { useEffect, useRef, useState, type ReactNode } from "react";
import "@/site/serif.css";
import {
  ArrowLeftRight, ArrowUpRight, BookOpen, ChartPie, Gift, LayoutGrid, Menu, Search, Sprout, X,
} from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useHasBackend } from "@/lib/api";

export const REPO = "https://github.com/prarimz/unwind";

/// The two button looks, after the /list card: an inverted pill for the one
/// thing a page wants you to do, and an outlined pill for everything else.
export const SOLID =
  "press inline-flex h-11 items-center justify-center rounded-full bg-foreground px-7 text-[15px] " +
  "font-medium text-background transition-opacity hover:opacity-85";
export const OUTLINE =
  "press inline-flex h-11 items-center justify-center rounded-full border border-line bg-panel px-6 " +
  "text-[15px] font-medium transition-colors hover:bg-panel2";

/// beUI's pill tabs in the house look: no track, and the sliding indicator
/// is the same inverted pill as the buttons, with its label flipped to match.
export const PILL_LIST = "bg-transparent p-0";
export const PILL_TRIGGER =
  "h-9 px-4 text-[13.5px] font-normal [&_[data-tabs-label]]:font-medium " +
  "[&_[data-tabs-label]]:text-background";
export const PILL_INDICATOR = "bg-foreground";

export const Shell = ({ children, className = "" }: {
  children: ReactNode; className?: string;
}) => <div className={`mx-auto w-full max-w-[1180px] px-5 sm:px-6 ${className}`}>{children}</div>;

export const DOCS = "https://unwind.gitbook.io/unwind-docs";

export const X_URL = "https://x.com/unwindfi";

/*
 * Sections on the left, actions on the right.
 *
 * Opening a market is not in the bar: /markets offers it in its hero ("Or
 * open one") and the list has its own page, so the bar keeps to sections
 * and the wallet.
 */
/// Each link carries a small lucide icon beside its label, after the
/// panelled nav the user shared as the reference (2026-09-26).
const NAV = [
  { label: "Markets", href: "/markets", Icon: LayoutGrid },
  { label: "Trade", href: "/trade", Icon: ArrowLeftRight },
  { label: "Earn", href: "/earn", Icon: Sprout },
  { label: "Portfolio", href: "/portfolio", Icon: ChartPie },
  { label: "Rewards", href: "/rewards", Icon: Gift },
  { label: "Docs", href: DOCS, out: true, Icon: BookOpen },
];

/*
 * One header and one footer for every page on the site.
 *
 * These are plain `href`s, and they stay plain: the router in `main.tsx`
 * catches the click on its way up and swaps the page, so the same markup
 * works whether or not it is mounted under one -- and middle-click, open in
 * new tab and copy link address keep meaning what they say. `here` is passed
 * rather than read from location so a page cannot disagree with the nav about
 * which page it is.
 */
export function SiteHeader({ here, tradeHref = "/trade", actions }: {
  here?: string;
  /// Carries the market the visitor was looking at into the app.
  tradeHref?: string;
  /*
   * What goes in the right-hand panel instead of the site's two calls to
   * action.
   *
   * The trading screen used to carry a header of its own -- a different
   * height, a different mark, a different set of links -- so moving between
   * the site and the app redrew the top of the window and made one product
   * feel like two. It is the same bar everywhere now; only the last panel
   * changes, because a wallet is the one control the site has no use for.
   */
  actions?: ReactNode;
}) {
  // A backend that answers is the devnet venue; without one the site is a
  // read-only preview, which is still "Beta".
  const backend = useHasBackend();
  return (
    /*
     * The bar is a row of cells rather than a strip with things floating in
     * it: the mark sits in its own bordered box, the links in theirs, and the
     * actions in a third at the far end. It is what makes a header this
     * sparse still read as built rather than as a gap above the page.
     */
    /*
     * The bar is three panels with gaps between them, not one strip divided
     * by lines.
     *
     * A panel has a border all the way round and a corner radius, so the bar
     * reads as built out of parts rather than ruled into sections -- and the
     * empty middle becomes a deliberate piece of the composition instead of
     * the space left over between two ends.
     *
     * The mark shares the first panel with the links. Giving it one of its
     * own put a divider between a logo and the navigation beside it, which
     * is a seam with nothing on either side of it.
     */
    // Above everything a page lays over its hero (the search on /markets sits
    // at z-30), so the phone menu that opens under the bar is never cut.
    /*
     * The bar the prediction-market terminals use: the mark and a search
     * field on the left, the wallet on the right, and under it one row of
     * the site's parts as words with their icons, the current one in full
     * ink. No panels, no rules: the page's pale ground is the frame.
     */
    <header className="relative z-50 bg-background safe-t">
      <div className="flex h-[64px] items-center gap-4 px-4 sm:px-6">
        <a href="/markets" aria-label="unwind" className="flex flex-none items-center gap-2.5">
          <img src="/waitlist/logo-glass-mark.webp" alt="" className="h-8 w-8" />
          <span className="text-[17px] font-semibold tracking-[-.02em]">unwind</span>
        </a>
        <a href="/markets" aria-label="Search markets"
          className="hidden h-10 w-[300px] items-center gap-2.5 rounded-full bg-panel px-4 text-[14px]
                     text-muted-foreground transition-colors hover:bg-panel2 md:flex lg:w-[340px]">
          <Search size={16} strokeWidth={2} aria-hidden />
          Search markets
        </a>
        <div className="ml-auto flex flex-none items-center gap-2">
          {actions}
          <ThemeToggle className="h-10 w-10" />
          <PageMenu here={here} tradeHref={tradeHref} className="lg:hidden" />
        </div>
      </div>
      <nav className="strip-scroll hidden items-center gap-1 px-4 pb-3 sm:px-6 lg:flex" aria-label="Pages">
        {NAV.map((l, i) => (
          <a key={l.href} href={l.href === "/trade" ? tradeHref : l.href}
            {...(l.out ? { target: "_blank", rel: "noreferrer" } : {})}
            aria-current={here === l.href ? "page" : undefined}
            className={`flex h-9 flex-none items-center gap-2 rounded-full px-3.5 text-[14px]
                        transition-colors ${i === 5 ? "ml-3 border-l border-line pl-6" : ""} ${here === l.href
              ? "font-medium text-foreground"
              : "text-muted-foreground hover:text-foreground"}`}>
            <l.Icon size={16} strokeWidth={2} aria-hidden />
            {l.label}
          </a>
        ))}
        <span className="ml-auto hidden items-center gap-2 text-[13px] text-muted-foreground xl:flex">
          <span className="size-1.5 rounded-full bg-up" />
          {backend === true ? "Devnet" : "Beta"}
        </span>
      </nav>
    </header>
  );
}

/*
 * Every page, behind one button, for screens too narrow for the links.
 *
 * The bar's links used to scroll sideways inside it, which on a phone showed
 * "Markets" and half of "Trade" and gave no sign the rest existed. This opens
 * them all as full-width rows under whichever bar it sits in (the nearest
 * positioned ancestor), and closes on a choice, a tap outside or Escape.
 * Shared by the site header and the trade app's phone bar.
 */
export function PageMenu({ here, tradeHref = "/trade", className = "" }: {
  here?: string; tradeHref?: string; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const out = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", out);
    window.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", out); window.removeEventListener("keydown", key); };
  }, [open]);
  return (
    <div ref={box} className={className}>
      <button type="button" onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open}
        className="press grid h-[40px] w-[40px] flex-none place-items-center rounded-full
                   text-muted-foreground transition-colors hover:text-foreground">
        {open ? <X size={20} strokeWidth={1.8} /> : <Menu size={20} strokeWidth={1.8} />}
      </button>
      {open && (
        <nav aria-label="Pages"
          className="absolute inset-x-2 top-full z-40 mt-2 grid gap-1 rounded-[14px] border border-line
                     bg-panel p-2 shadow-[0_18px_40px_-12px_rgba(0,0,0,.55)]">
          {NAV.map((l) => (
            <a key={l.href} href={l.href === "/trade" ? tradeHref : l.href}
              {...(l.out ? { target: "_blank", rel: "noreferrer" } : {})}
              aria-current={here === l.href ? "page" : undefined}
              onClick={() => setOpen(false)}
              className={`flex h-[52px] items-center gap-3 rounded-[10px] px-4 text-[16px] transition-colors ${
                here === l.href ? "bg-panel2 font-medium text-foreground"
                  : "text-muted-foreground hover:bg-panel2 hover:text-foreground"}`}>
              <l.Icon size={19} strokeWidth={1.8} aria-hidden />
              {l.label}
              {l.out && <ArrowUpRight size={15} strokeWidth={1.8} aria-hidden className="ml-auto" />}
            </a>
          ))}
        </nav>
      )}
    </div>
  );
}

export function SiteFooter({ tradeHref = "/trade" }: { tradeHref?: string }) {
  const backend = useHasBackend();
  const cols: { title: string; links: { label: string; href: string; out?: boolean }[] }[] = [
    { title: "Product", links: [
      { label: "Markets", href: "/markets" },
      { label: "Trade", href: tradeHref },
      { label: "Earn", href: "/earn" },
      { label: "Portfolio", href: "/portfolio" },
      { label: "Rewards", href: "/rewards" },
      { label: "List a market", href: "/list" },
    ] },
    { title: "Resources", links: [
      { label: "Docs", href: DOCS, out: true },
      { label: "Source", href: REPO, out: true },
    ] },
    { title: "Follow", links: [
      { label: "X", href: X_URL, out: true },
    ] },
  ];
  return (
    /*
     * A panel in the brand's own light, like the front page: the glass logo
     * and the line, the links in three labelled columns, then the name set
     * big in the serif across the foot, cropped by the panel's edge.
     */
    /* The navbar's treatment, mirrored: full bleed and flush with the bottom
       of the window, rounded only on the corners that face the page. */
    <footer className="safe-b">
      <div className="relative overflow-hidden rounded-t-[10px] border-t border-line bg-panel">
        <img src="/waitlist/field.webp" alt="" aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-[70%] w-full object-cover opacity-25 dark:opacity-55
                     [mask-image:linear-gradient(to_top,black_35%,transparent)]" />
        <div className="relative grid gap-10 px-6 pt-12 sm:px-10 md:grid-cols-[1.2fr_2fr] md:pt-16">
          <div>
            <img src="/waitlist/logo-glass-mark.webp" alt="" className="h-11 w-11" />
            <p className="mt-5 max-w-[34ch] text-[15px] leading-relaxed text-foreground/85">
              Every market clears by auction. Anyone can open one.
            </p>
          </div>
          <nav className="grid grid-cols-2 gap-8 sm:grid-cols-3" aria-label="Footer">
            {cols.map((c) => (
              <div key={c.title}>
                <p className="text-[11px] font-medium uppercase tracking-[.14em] text-foreground/55">{c.title}</p>
                <ul className="mt-4 flex flex-col gap-2.5">
                  {c.links.map((l) => (
                    <li key={l.label}>
                      <a href={l.href} {...(l.out ? { target: "_blank", rel: "noreferrer" } : {})}
                        className="text-[14px] text-muted-foreground transition-colors hover:text-foreground">
                        {l.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        <p className="relative mt-12 max-w-[70ch] px-6 text-[11.5px] leading-relaxed text-foreground/55 sm:px-10">
          Unaudited.{" "}
          {backend === true && "Devnet, test USDC. "}
          {backend === false && "Live prices, trading off. "}
          Not investment advice.
        </p>

        {/* The name across the foot, cropped by the panel so it reads as a mark, not a line. */}
        <div aria-hidden className="font-serif-display relative -mb-[.1em] mt-4 select-none px-4
                                    leading-[.85] tracking-[-.035em] text-foreground/[.07] dark:text-[#e2d9ff] sm:px-8"
          style={{ fontSize: "clamp(96px, 22vw, 330px)" }}>
          unwind
        </div>
      </div>
    </footer>
  );
}

/// The masthead every page below the landing page opens with.
export function PageHead({ label, title, lede }: {
  label: string; title: ReactNode; lede: ReactNode;
}) {
  return (
    <section className="border-b border-line">
      <Shell className="py-11 md:py-14">
        <p className="rise text-[10.5px] font-medium uppercase tracking-[.16em] text-dim"
          style={{ animationDelay: "60ms" }}>
          {label}
        </p>
        <h1 className="rise mt-3.5 max-w-[22ch] text-balance text-[clamp(1.6rem,3vw,2.2rem)]
                       font-semibold leading-[1.12] tracking-[-.02em]"
          style={{ animationDelay: "140ms" }}>
          {title}
        </h1>
        <p className="rise mt-4 max-w-[64ch] text-[14.5px] leading-[1.6] text-muted-foreground"
          style={{ animationDelay: "220ms" }}>
          {lede}
        </p>
      </Shell>
    </section>
  );
}
