/*
 * Earn.
 *
 * The page a depositor opens. What the vaults hold and return at the top,
 * the pool's share price drawn over the week, then two tables: the pool on
 * its own, and every market as a vault of first-loss backing.
 *
 * Backing leads. The way most people should take part is to pick a market
 * they believe in and stand behind it: first loss on that one market, half
 * the LP share of its fees. The pool is the default under all of it, for
 * whoever would rather hold every market at once than choose.
 *
 * The APY is measured, not projected. The server watches what each vault's
 * share is worth -- the pool's share price, a market's backing per share,
 * both of which rise with the fees they keep and fall with what traders win
 * -- and annualizes the change over the window it has seen. Each figure says
 * how long that window is, and a vault watched for under an hour says
 * "Measuring" rather than scaling a few minutes up to a year. The chart is
 * that same tape, so the rate is never a number without a line behind it.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import "@/site/serif.css";
import { AnimatePresence, motion } from "motion/react";
import { Search, X } from "lucide-react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Shell, SiteFooter, SiteHeader } from "@/site/Chrome";
import {
  BTN, Chart, Count, DASH, Empty, Field, Foot, GHOST, Head, KV, LABEL, PAD, PageTop, Panel,
  PanelTabs, ROW, Seg, Tiles,
} from "@/site/Account";
import { Mark } from "@/components/Brand";
import { TickerLogo } from "@/components/TickerLogo";
import { WalletActions } from "@/components/WalletActions";
import * as api from "@/lib/api";
import {
  getAccount, getApy, getBackings, getMarkets, usePoll,
  type Account, type Apy, type Apys, type Backing, type Market, type Series,
} from "@/lib/api";
import { signAndSend } from "@/lib/tx";
import { PAY_TOKENS, usdPrices, type PayWith } from "@/lib/listing";
import { PayToken } from "@/components/PayToken";
import { compact, money, price } from "@/lib/format";

const NONE: Market[] = [];
const NO_BACKINGS: Backing[] = [];
const NO_SERIES: Series = [];

/// One place to put money, whichever kind it is.
interface Vault {
  id: string;
  kind: "pool" | "market";
  title: string;
  subtitle: string;
  market?: Market;
  tvl: number;
  /// The line under the TVL: what it is measured in, or against.
  tvlNote: string;
  /// The APY column: the rate, and the window it was measured over.
  apy: { text: string; tone: string; note: string; value?: number };
  yours: number;
  symbol?: string;
  /// Which of the table's groups it belongs to.
  group: "pool" | "equities" | "crypto" | "opened";
}

/// What the APY column says, for a vault the server has or has not watched.
function apyCell(a: Apy | null | undefined, empty: string) {
  if (!a) return { text: "–", tone: "text-dim", note: empty };
  if (a.apy == null) {
    const mins = Math.round(a.hours * 60);
    return { text: "Measuring", tone: "text-muted-foreground",
      note: `${mins < 60 ? `${mins}m` : `${a.hours.toFixed(1)}h`} of 1h` };
  }
  const window = a.hours >= 167 ? "7d" : a.hours >= 23.5 ? `${Math.round(a.hours / 24)}d`
    : `${Math.round(a.hours)}h`;
  return {
    text: `${a.apy >= 0 ? "" : "-"}${Math.abs(a.apy).toFixed(2)}%`,
    value: a.apy,
    tone: a.apy > 0 ? "text-up" : a.apy < 0 ? "text-down" : "text-foreground",
    note: `over ${window}`,
  };
}

function vaultsOf(account: Account | null | undefined, markets: Market[], backings: Backing[],
  apy: Apys | null | undefined) {
  const out: Vault[] = [];
  const pool = account?.pool;
  if (pool) {
    out.push({
      id: "pool", kind: "pool", title: "The pool", subtitle: "Every market · xLP",
      tvl: pool.aum,
      tvlNote: `${compact(pool.lpSupply)} xLP`,
      apy: apyCell(apy?.pool, "no deposits"),
      yours: account!.lp.value,
      group: "pool",
    });
  }
  /*
   * Every market, not only the ones somebody opened on a pool. `back_market`
   * does not care where a price comes from, so an equity priced by Pyth takes
   * first-loss capital exactly as a pool-watched token does -- it simply has
   * a feed where the other has a depth, and the row says which.
   */
  for (const m of markets) {
    const o = m.observed;
    out.push({
      id: m.symbol, kind: "market", symbol: m.symbol, market: m,
      title: m.name,
      subtitle: m.name !== m.symbol ? m.symbol : "",
      tvl: m.backingUsd,
      tvlNote: o ? `of ${compact(o.depthUsd)} depth` : `${compact(m.lossBudgetUsd)} budget`,
      apy: apyCell(apy?.markets[m.symbol], "not backed yet"),
      yours: backings.find((b) => b.symbol === m.symbol)?.value ?? 0,
      group: o ? "opened" : /x$/.test(m.symbol) ? "equities" : "crypto",
    });
  }
  return out;
}

/*
 * The vault, opened: in and out of one place.
 *
 * A dialog on a desktop and a sheet on a phone, from one element whose
 * anchoring changes at `sm`. Escape and the backdrop both close it.
 */
function VaultDialog({ v, account, start, onClose, onDone }: {
  v: Vault; account: Account | null | undefined; start: "in" | "out";
  onClose: () => void; onDone: () => void;
}) {
  const wallet = useWallet();
  const { setVisible } = useWalletModal();
  const owner = wallet.publicKey?.toBase58();
  const input = useRef<HTMLInputElement>(null);
  const [side, setSide] = useState<"in" | "out">(start);
  const [amount, setAmount] = useState("");
  /// MAX on the way out sends "all of it", so a position closes to zero
  /// instead of leaving a share's worth of dust behind.
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  /// Backing can be paid in SOL or USDT as well, and is held as what it was
  /// paid in. The pool takes USDC only: xLP is minted against dollars.
  const [payWith, setPayWith] = useState<PayWith>("USDC");
  const [prices, setPrices] = useState<Record<PayWith, number> | null>(null);
  useEffect(() => { void usdPrices().then(setPrices).catch(() => {}); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    addEventListener("keydown", onKey);
    input.current?.focus();
    return () => removeEventListener("keydown", onKey);
  }, [onClose]);

  const pool = account?.pool;
  const lpPrice = account?.lp.price ?? 1;
  const usd = Number(amount) > 0 ? Number(amount) : 0;
  const fee = v.kind === "pool"
    ? (side === "in" ? pool?.addFeePct ?? 0 : pool?.removeFeePct ?? 0) : 0;
  const paying = v.kind === "market" && side === "in" ? payWith : "USDC";
  const ceiling = side === "in" ? (account?.usdc ?? 0) : v.yours;
  // Only USDC has a balance this page knows; a SOL or USDT amount is checked
  // by the wallet instead.
  const over = paying === "USDC" && usd > ceiling + 1e-9;
  const usdOf = (n: number) => n * (paying === "USDC" ? 1 : prices?.[paying] ?? 0);
  const verb = side === "in" ? (v.kind === "pool" ? "Deposit" : "Back") : "Withdraw";

  const submit = async () => {
    if (!usd || over) return;
    setBusy(true); setNote(null);
    const [path, body]: [string, Record<string, unknown>] = v.kind === "pool"
      ? side === "in"
        ? ["deposit", { amount: usd }]
        : ["withdraw", { lpAmount: all ? account!.lp.held : usd / lpPrice }]
      : side === "in"
        ? ["back-market", { symbol: v.symbol, amount: usd, payWith: paying }]
        : ["unback-market", all ? { symbol: v.symbol, all: true } : { symbol: v.symbol, amount: usd }];
    try {
      const r = await signAndSend(wallet, path, body);
      setNote(r.ok
        ? { ok: true, text: `${side === "out" ? "Withdrew" : v.kind === "pool" ? "Deposited" : "Backed with"} ${
          paying === "USDC" ? money(usd) : `${usd} ${paying}`}.` }
        : { ok: false, text: r.error ?? "Not accepted." });
      if (r.ok) { setAmount(""); setAll(false); onDone(); }
    } finally { setBusy(false); }
  };

  const sides: ["in" | "out", string][] = [
    ["in", v.kind === "pool" ? "Deposit" : "Back"], ["out", "Withdraw"],
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
      <motion.button type="button" aria-label="Close" onClick={onClose}
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        className="absolute inset-0 cursor-default bg-black/60" />
      <motion.div role="dialog" aria-modal="true" aria-label={v.title}
        initial={{ opacity: 0, y: 24, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 16, scale: 0.98 }}
        transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
        className="relative max-h-[92dvh] w-full overflow-y-auto rounded-t-[16px] border border-line
                   bg-panel safe-b sm:max-w-[420px] sm:rounded-[16px]">
        <div className={`${PAD} pb-5 pt-4`}>
          <header className="flex items-center gap-3">
            <VaultIcon v={v} size={32} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] font-medium">{v.title}</span>
              <span className="n block truncate text-[12px] text-muted-foreground">
                {v.kind === "pool" ? "Every market" : "First loss"} · {money(v.tvl, 0)} in
              </span>
            </span>
            <button type="button" onClick={onClose} aria-label="Close"
              className="press grid size-8 place-items-center rounded-[8px] text-muted-foreground
                         transition-colors hover:bg-panel2 hover:text-foreground">
              <X size={16} strokeWidth={1.75} />
            </button>
          </header>

          <div className="mt-4">
            <Seg options={sides} value={side}
              onChange={(k) => { setSide(k); setAmount(""); setAll(false); setNote(null); setPayWith("USDC"); }} />
          </div>

          {v.kind === "market" && side === "in" && (
            <div className="mt-4">
              <span className={`mb-2 block ${LABEL}`}>Pay with</span>
              <div role="radiogroup" aria-label="Pay with" className="flex flex-wrap gap-2">
                {(Object.keys(PAY_TOKENS) as PayWith[]).map((k) => (
                  <button key={k} type="button" role="radio" aria-checked={payWith === k}
                    onClick={() => { setPayWith(k); setAmount(""); }}
                    className={`press flex h-9 items-center rounded-[8px] border pl-1.5 pr-3
                                text-[13px] transition-colors ${payWith === k
                      ? "border-foreground text-foreground"
                      : "border-line text-muted-foreground hover:text-foreground"}`}>
                    <PayToken k={k} size={22} className="gap-2" />
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="mt-4">
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <label htmlFor="vault-amount" className={LABEL}>Amount</label>
              {owner && paying === "USDC" && (
                <button type="button"
                  onClick={() => { setAmount(ceiling.toFixed(2)); setAll(side === "out"); }}
                  className="n text-[12px] text-muted-foreground transition-colors hover:text-foreground">
                  {side === "in" ? "Wallet" : "Yours"} {money(ceiling)}
                  <span className="ml-1.5 font-medium text-foreground">Max</span>
                </button>
              )}
            </div>
            <div className="relative">
              <input id="vault-amount" ref={input} value={amount} inputMode="decimal"
                onChange={(e) => { setAmount(e.target.value.replace(/[^\d.]/g, "")); setAll(false); }}
                onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
                placeholder="0.00" aria-label={`Amount to ${verb.toLowerCase()}`}
                className="n h-12 w-full rounded-[8px] border border-line bg-panel2 pl-3.5 pr-12
                           text-[18px] font-medium outline-none transition-colors
                           placeholder:text-dim focus:border-foreground/40" />
              <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2">
                <img src={PAY_TOKENS[paying].logo} alt="" className="size-5 rounded-full" />
              </span>
            </div>
          </div>

          <div className="mt-4">
            <KV k="You receive">
              {!usd ? DASH : v.kind === "pool" && side === "in"
                ? `${(usd * (1 - fee / 100) / lpPrice).toLocaleString(undefined, { maximumFractionDigits: 2 })} xLP`
                : paying !== "USDC"
                  ? `≈${money(usdOf(usd), 0)} backing, held as ${paying}`
                  : money(usd * (1 - fee / 100))}
            </KV>
            <KV k="Fee">{fee ? `${fee}%, kept by the LPs who stay` : "None"}</KV>
            <KV k="Yours now">{money(v.yours)}</KV>
            <KV k={`APY, ${v.apy.note}`} tone={v.apy.tone}>{v.apy.text}</KV>
          </div>

          <div className="mt-4">
            {!owner ? (
              <button type="button" onClick={() => setVisible(true)} disabled={api.readOnly}
                className={`${BTN} h-11 w-full`}>
                Connect wallet
              </button>
            ) : (
              <button type="button" onClick={submit} disabled={busy || !usd || over || api.readOnly}
                className={`${BTN} h-11 w-full`}>
                {busy ? "Confirm in your wallet…"
                  : over ? `More than ${side === "in" ? "your wallet holds" : "is yours"}` : verb}
              </button>
            )}
            {api.readOnly && (
              <p className="mt-2.5 text-[12px] text-muted-foreground">
                No chain behind this deploy. Run it locally to deposit.
              </p>
            )}
            {note && (
              <p className={`mt-2.5 text-[12.5px] ${note.ok ? "text-up" : "text-down"}`}>{note.text}</p>
            )}
          </div>

          {/* The risk, where the money is committed rather than on another page. */}
          <p className="mt-4 border-t border-linesoft pt-3.5 text-[12px] leading-relaxed text-muted-foreground">
            {v.kind === "pool"
              ? "The pool is short the traders' combined PnL. When they are net right it pays them, and a share is worth less than it was."
              : `Backing is spent first when this market's traders win, and earns half the LP share of its fees. It is held as ${paying}, not swapped${
                paying === "SOL" ? ", and counts at 80% toward the market's budget" : ""
              }. Withdrawals come back in the mix the backing holds, and anything the market's open positions still need is refused.`}
          </p>
        </div>
      </motion.div>
    </div>
  );
}

/// The pool wears the venue's own mark; a market wears its token's.
function VaultIcon({ v, size = 28 }: { v: Vault; size?: number }) {
  return v.kind === "pool" || !v.market ? (
    <span className="grid flex-none place-items-center rounded-full border border-line bg-panel2"
      style={{ width: size, height: size }}>
      <Mark size={Math.round(size * 0.55)} />
    </span>
  ) : (
    <span className="flex-none"><TickerLogo m={v.market} size={size} /></span>
  );
}

const FILTERS = [
  ["all", "All"], ["equities", "Equities"], ["crypto", "Crypto"], ["opened", "Opened by anyone"],
  ["yours", "Yours"],
] as const;
type Filter = (typeof FILTERS)[number][0];

/// The table holds markets only; the pool has a panel of its own.
const keep = (v: Vault, f: Filter, q: string) =>
  v.kind === "market"
  && (f === "all" ? true : f === "yours" ? v.yours > 0 : v.group === f)
  && (!q || `${v.title} ${v.symbol}`.toLowerCase().includes(q));

const COLS = "grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,.9fr)] items-center gap-3 " +
  "md:grid-cols-[minmax(0,1.5fr)_minmax(0,.9fr)_minmax(0,1fr)_minmax(0,.9fr)_minmax(0,.8fr)_minmax(0,.7fr)]";

const PERIODS: [Period, string][] = [["1d", "1D"], ["7d", "7D"]];
type Period = "1d" | "7d";

/// A tape cut to the period, and rebased so it reads as the return since the
/// cut: what a dollar in the vault then is worth now.
function returnsOf(series: Series, period: Period): Series {
  const from = Date.now() / 1000 - (period === "1d" ? 86_400 : 7 * 86_400);
  const cut = series.filter((p) => p[0] >= from);
  const rows = cut.length >= 2 ? cut : series;
  if (rows.length < 2) return rows;
  const base = rows[0][1];
  return rows.map(([t, v]) => [t, (v / base - 1) * 100]);
}

const signedPct = (v: number, d = 3) => `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`;

export default function Earn() {
  const wallet = useWallet();
  const { setVisible } = useWalletModal();
  const owner = wallet.publicKey?.toBase58();
  const [tick, setTick] = useState(0);
  const account = usePoll(() => getAccount(owner), 3000, [owner, tick]);
  const markets = usePoll(getMarkets, 5000) ?? NONE;
  const backings = usePoll(() => getBackings(owner), 5000, [owner, tick]) ?? NO_BACKINGS;
  // The tape is sampled every two minutes, so polling faster than this would
  // only ask the same question again.
  const apy = usePoll(getApy, 30_000);

  const [open, setOpen] = useState<{ id: string; start: "in" | "out" } | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [period, setPeriod] = useState<Period>("7d");
  const [line, setLine] = useState("pool");

  const vaults = useMemo(() => vaultsOf(account, markets, backings, apy),
    [account, markets, backings, apy]);
  const opened = open ? vaults.find((v) => v.id === open.id) ?? null : null;
  const pool = account?.pool;
  const poolVault = vaults.find((v) => v.kind === "pool");
  const marketVaults = useMemo(() => vaults.filter((v) => v.kind === "market"), [vaults]);
  // Most-backed at the top: backing is the thing to choose.
  const shown = useMemo(() => marketVaults
    .filter((v) => keep(v, filter, q.trim().toLowerCase()))
    .sort((a, b) => b.tvl - a.tvl),
  [marketVaults, filter, q]);

  const tvl = vaults.reduce((a, v) => a + v.tvl, 0);
  const yours = vaults.reduce((a, v) => a + v.yours, 0);
  const posted = backings.reduce((a, b) => a + b.deposited, 0);
  const backedNow = backings.reduce((a, b) => a + b.value, 0);
  const mine = marketVaults.filter((v) => v.yours > 0).length;
  const poolApy = apyCell(apy?.pool, "no deposits");

  // The line: the pool's, or any backed market's, as the return over the period.
  const lines: [string, string][] = [
    ["pool", "The pool"],
    ...marketVaults.filter((v) => (apy?.series?.markets[v.symbol!]?.length ?? 0) > 1)
      .map((v) => [v.symbol!, v.symbol!] as [string, string]),
  ];
  const raw = line === "pool" ? apy?.series?.pool ?? NO_SERIES : apy?.series?.markets[line] ?? NO_SERIES;
  const points = useMemo(() => returnsOf(raw, period), [raw, period]);
  const lineReturn = points.length >= 2 ? points[points.length - 1][1] : null;

  return (
    <div className="site relative min-h-full">
      <SiteHeader here="/earn" actions={<WalletActions />} />
      <Field />

      <Shell className="relative pb-14 pt-6 sm:pt-9">
        <PageTop title="Earn"
          lede="Back one market and take first loss on it for half the LP share of its fees, or hold the pool behind every market. Paid in SOL, USDC or USDT."
          actions={!owner ? (
            <button type="button" onClick={() => setVisible(true)} disabled={api.readOnly} className={BTN}>
              Connect wallet
            </button>
          ) : (
            <>
              <button type="button" onClick={() => setOpen({ id: "pool", start: "out" })}
                disabled={!pool || !(account?.lp.value)} className={GHOST}>
                Withdraw
              </button>
              <button type="button" onClick={() => setOpen({ id: "pool", start: "in" })}
                disabled={!pool} className={BTN}>
                Deposit
              </button>
            </>
          )} />

        <Tiles items={[
          { k: "Total value locked", v: money(tvl, 0),
            sub: pool ? `${money(pool.aum, 0)} pool · ${money(tvl - pool.aum, 0)} backing` : undefined },
          { k: "Pool APY", tone: poolApy.tone,
            v: poolApy.text,
            sub: poolApy.value != null ? `Measured ${poolApy.note}` : poolApy.note },
          { k: "Your deposits",
            v: owner ? money(yours) : DASH,
            sub: owner ? `${money(account?.lp.value ?? 0)} pool · ${money(backedNow)} backing` : undefined },
          { k: "Backing return", tone: owner && backings.length ? (backedNow - posted >= 0 ? "text-up" : "text-down") : "",
            v: owner && backings.length
              ? `${backedNow - posted >= 0 ? "+" : "-"}${money(Math.abs(backedNow - posted))}` : DASH,
            sub: owner && backings.length ? `On ${money(posted)} posted across ${mine} market${mine === 1 ? "" : "s"}`
              : owner ? "Nothing backed yet" : undefined },
        ]} />

        {/* ------------------------------------------------------ the tape */}
        <Panel
          title={
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <h2 className="text-[14px] font-medium">Return per share</h2>
              {lineReturn != null && (
                <span className={`n text-[13px] font-medium ${lineReturn >= 0 ? "text-up" : "text-down"}`}>
                  {signedPct(lineReturn)}
                  <span className="ml-1.5 font-normal text-muted-foreground">
                    over {period === "1d" ? "1 day" : "7 days"}
                  </span>
                </span>
              )}
            </div>
          }
          aside={
            <div className="flex items-center gap-2">
              {lines.length > 1 && (
                <select value={line} onChange={(e) => setLine(e.target.value)} aria-label="Vault"
                  className="h-7 rounded-[7px] border border-line bg-panel px-2 text-[12px] outline-none">
                  {lines.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              )}
              <Seg options={PERIODS} value={period} onChange={setPeriod} />
            </div>
          }>
          <div className={`${PAD} pb-3`}>
            <Chart points={points} format={(v) => signedPct(v)}
              empty={apy?.series ? "Under an hour on the tape. The line starts once there is one to draw."
                : "Nothing recorded yet."} />
          </div>
          <Foot>One share's value, as the change since the start of the period. Sampled every two minutes.</Foot>
        </Panel>

        {/* ------------------------------------------------------ the pool */}
        <Panel title="Protocol vault">
          <Head cols={COLS}>
            <span>Vault</span>
            <span>TVL</span>
            <span className="hidden md:block">APY</span>
            <span className="hidden md:block">Utilization</span>
            <span className="hidden md:block">Fee in / out</span>
            <span className="text-right md:text-left">Yours</span>
          </Head>
          {poolVault && pool ? (
            <button type="button" onClick={() => setOpen({ id: "pool", start: "in" })}
              className={`${COLS} w-full ${ROW} text-left transition-colors hover:bg-panel2`}>
              <span className="flex min-w-0 items-center gap-2.5">
                <VaultIcon v={poolVault} />
                <span className="min-w-0">
                  <span className="block truncate font-medium">The pool</span>
                  <span className="block truncate text-[12px] text-muted-foreground">Every market · xLP</span>
                </span>
              </span>
              <span className="n min-w-0">
                <span className="block truncate">{money(pool.aum, 0)}</span>
                <span className="block truncate text-[12px] text-muted-foreground">{compact(pool.lpSupply)} xLP</span>
              </span>
              <span className="n hidden min-w-0 md:block">
                <span className={`block truncate ${poolVault.apy.tone}`}>{poolVault.apy.text}</span>
                <span className="block truncate text-[12px] text-muted-foreground">{poolVault.apy.note}</span>
              </span>
              <span className="n hidden min-w-0 md:block">
                <span className="block truncate">{pool.utilization.toFixed(2)}%</span>
                <span className="block truncate text-[12px] text-muted-foreground">of {pool.maxUtilization}% cap</span>
              </span>
              <span className="n hidden md:block">{pool.addFeePct}% / {pool.removeFeePct}%</span>
              <span className="n text-right md:text-left">{poolVault.yours > 0 ? money(poolVault.yours) : DASH}</span>
            </button>
          ) : <Empty>{api.readOnly ? "No chain behind this deploy." : "Reading the pool."}</Empty>}
        </Panel>

        {/* ---------------------------------------------------- the markets */}
        <Panel>
          <PanelTabs tabs={FILTERS.map(([k, l]) => [k, <>{l}{k === "yours" && <Count n={mine} />}</>])}
            value={filter} onChange={setFilter}
            aside={
              <label className="relative block">
                <Search size={14} strokeWidth={1.75}
                  className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-dim" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search"
                  aria-label="Search markets"
                  className="h-8 w-[150px] rounded-[7px] border border-line bg-panel pl-8 pr-2.5 text-[12.5px]
                             outline-none transition-colors placeholder:text-dim focus:border-foreground/40
                             sm:w-[190px]" />
              </label>
            } />
          <Head cols={COLS}>
            <span>Market</span>
            <span>Backing</span>
            <span className="hidden md:block">APY</span>
            <span className="hidden md:block">Budget</span>
            <span className="hidden md:block">Status</span>
            <span className="text-right md:text-left">Yours</span>
          </Head>
          {shown.length === 0 && (
            <Empty>
              {filter === "yours" ? "Nothing backed yet. Open any market in the list to start."
                : q ? "No market matches." : "No markets in this group yet."}
            </Empty>
          )}
          {shown.map((v) => {
            const m = v.market!;
            return (
              <button key={v.id} type="button" onClick={() => setOpen({ id: v.id, start: "in" })}
                className={`${COLS} w-full ${ROW} text-left transition-colors hover:bg-panel2`}>
                <span className="flex min-w-0 items-center gap-2.5">
                  <VaultIcon v={v} />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{v.title}</span>
                    <span className="n block truncate text-[12px] text-muted-foreground">
                      {v.subtitle ? `${v.subtitle} · ` : ""}{price(m.price)}
                    </span>
                  </span>
                </span>
                <span className="n min-w-0">
                  <span className="block truncate">
                    <span className="md:hidden">{compact(v.tvl)}</span>
                    <span className="hidden md:inline">{money(v.tvl, 0)}</span>
                  </span>
                  <span className="block truncate text-[12px] text-muted-foreground">{v.tvlNote}</span>
                </span>
                <span className="n hidden min-w-0 md:block">
                  <span className={`block truncate ${v.apy.tone}`}>
                    {v.apy.text}
                  </span>
                  <span className="block truncate text-[12px] text-muted-foreground">{v.apy.note}</span>
                </span>
                <span className="n hidden min-w-0 md:block">
                  <span className="block truncate">{compact(m.observed?.budgetUsd ?? m.lossBudgetUsd)}</span>
                  <span className="block truncate text-[12px] text-muted-foreground">{m.maxLeverage}x max</span>
                </span>
                <span className="hidden md:block">
                  <span className={`inline-block rounded-[5px] border px-1.5 py-0.5 text-[11px] ${
                    v.tvl > 0 ? "border-up/40 text-up" : "border-line text-dim"}`}>
                    {v.tvl > 0 ? "Backed" : "Unbacked"}
                  </span>
                </span>
                <span className="n text-right md:text-left">{v.yours > 0 ? money(v.yours) : DASH}</span>
              </button>
            );
          })}
          <Foot>
            {money(marketVaults.reduce((a, v) => a + v.tvl, 0), 0)} behind {marketVaults.length} markets.
            Anyone can <a href="/list" className="text-foreground underline underline-offset-4">open one</a>.
          </Foot>
        </Panel>

        {/* -------------------------------------------------- your backing */}
        {backings.length > 0 && (
          <YourBacking backings={backings} markets={markets}
            onAdd={(s) => setOpen({ id: s, start: "in" })}
            onWithdraw={(s) => setOpen({ id: s, start: "out" })} />
        )}
      </Shell>

      <AnimatePresence>
        {opened && open && (
          <VaultDialog key={`${opened.id}-${open.start}`} v={opened} account={account}
            start={open.start} onClose={() => setOpen(null)} onDone={() => setTick((t) => t + 1)} />
        )}
      </AnimatePresence>

      <SiteFooter />
    </div>
  );
}

const TOKENS: PayWith[] = ["SOL", "USDC", "USDT"];
const amount = (sym: string, n: number) =>
  n.toLocaleString(undefined, { maximumFractionDigits: sym === "SOL" ? 4 : 2 });

const SMALLBTN = "press h-7 rounded-[6px] bg-foreground px-2.5 text-[12px] font-medium text-background " +
  "transition-opacity hover:opacity-90";
const SMALLGHOST = "press h-7 rounded-[6px] border border-line px-2.5 text-[12px] font-medium " +
  "transition-colors hover:border-foreground/40";

/// The mix each backing is held in, and the way in and out of it. The
/// vault table answers "where could my money go"; this answers "where is it",
/// and what comes back on withdrawal.
function YourBacking({ backings, markets, onWithdraw, onAdd }: {
  backings: Backing[]; markets: Market[];
  onWithdraw: (symbol: string) => void; onAdd: (symbol: string) => void;
}) {
  const cols = "grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto] items-center gap-3 " +
    "md:grid-cols-[minmax(0,1.4fr)_minmax(0,.9fr)_minmax(0,.9fr)_minmax(0,1.4fr)_auto]";
  return (
    <Panel title="Your backing">
      <Head cols={cols}>
        <span>Market</span>
        <span>Worth now</span>
        <span className="hidden md:block">Posted</span>
        <span className="hidden md:block">Held as</span>
        <span />
      </Head>
      {backings.map((b) => {
        const m = markets.find((x) => x.symbol === b.symbol);
        const diff = b.value - b.deposited;
        const mix = TOKENS.filter((k) => (b.held[k] ?? 0) > 0);
        return (
          <div key={b.symbol} className={`${cols} ${ROW}`}>
            <span className="flex min-w-0 items-center gap-2.5">
              {m && <TickerLogo m={m} size={28} />}
              <span className="min-w-0">
                <a href={`/trade?symbol=${b.symbol}`} className="block truncate font-medium hover:underline">
                  {m?.name ?? b.symbol}
                </a>
                <span className={`block truncate text-[12px] ${b.opening ? "text-brand" : b.tradeable ? "text-up" : "text-dim"}`}>
                  {b.opening ? "Opening auction" : b.tradeable ? `Live · ${compact(b.budgetUsd)} budget` : "Not live"}
                </span>
              </span>
            </span>
            <span className="n min-w-0">
              <span className="block truncate">{money(b.value)}</span>
              <span className={`block truncate text-[12px] ${diff >= 0 ? "text-up" : "text-down"}`}>
                {diff >= 0 ? "+" : "-"}{money(Math.abs(diff))}
              </span>
            </span>
            <span className="n hidden md:block">{money(b.deposited)}</span>
            <span className="hidden flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] md:flex">
              {mix.length === 0 ? <span className="text-dim">Nothing left</span>
                : mix.map((k) => (
                  <span key={k} className="n inline-flex items-center gap-1">
                    {amount(k, b.held[k])} <PayToken k={k} size={14} />
                  </span>
                ))}
            </span>
            <span className="flex gap-1.5">
              <button type="button" onClick={() => onAdd(b.symbol)} className={SMALLBTN}>Add</button>
              <button type="button" onClick={() => onWithdraw(b.symbol)} className={SMALLGHOST}>Withdraw</button>
            </span>
          </div>
        );
      })}
      <Foot>Withdrawals come back in the mix the backing holds, not swapped.</Foot>
    </Panel>
  );
}
