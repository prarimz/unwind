/*
 * Rewards.
 *
 * What a wallet has earned. Points are counted by the program as they are
 * earned, so every figure here is one anybody can check. Referrals and
 * listings also pay USDC, out of the protocol's cut of each fee.
 *
 * The copy leads with the figure, not an adjective; gives each rate a label,
 * a number and one line of qualification; and states the principles as
 * things the program refuses to do. The layout is the ledger pages': the
 * figures across the top with the claim beside them, the wallet's code and
 * breakdown under that, and the leaderboard and the tables under tabs.
 */
import { useEffect, useState, type ReactNode } from "react";
import "@/site/serif.css";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { DOCS, Shell, SiteFooter, SiteHeader } from "@/site/Chrome";
import {
  BTN, Count, DASH, Empty, Foot, GHOST, Head, KV, LABEL, LINK, Lookup, PAD, PageTop, Panel,
  PanelTabs, ROW, Seg, Tiles, isAddress, short, useHashTab,
} from "@/site/Account";
import { WalletActions } from "@/components/WalletActions";
import * as api from "@/lib/api";
import {
  checkCode, getLeaderboard, getRewards, useHasBackend, usePoll,
  type LeaderRow, type Leaderboard, type Rewards,
} from "@/lib/api";
import { storedRef } from "@/lib/ref";
import { signAndSend } from "@/lib/tx";
import { compact, money } from "@/lib/format";

/// The rules in force. Shown on the page so a change is never silent.
const RULES_VERSION = "v1";
const RULES_URL = `${DOCS}/trading/rewards`;

const TABS = ["leaderboard", "referrals", "markets", "rates"] as const;
type Tab = (typeof TABS)[number];

const wallets = (n: number) => `${n.toLocaleString()} wallet${n === 1 ? "" : "s"}`;
const points = (n: number) =>
  n.toLocaleString(undefined, { maximumFractionDigits: n < 100 ? 2 : 0 });

/// Every rate, as the program counts it. Mirrors `constants.rs`.
const RATES: { label: string; figure: string; line: string }[] = [
  { label: "Trading", figure: "1 point per $1",
    line: "Every fill, open or close, maker or taker." },
  { label: "Referrals", figure: "10% of their fees",
    line: "Paid in USDC, out of our cut. Plus 10% of their points. They pay 10% less." },
  { label: "Markets", figure: "10% of every fee",
    line: "On any market you open, for as long as it trades. Half fees when you trade it yourself." },
  { label: "Backing", figure: "2 points per $1 a day",
    line: "Backing takes first loss, so it earns double." },
  { label: "Pool", figure: "1 point per $1 a day",
    line: "On xLP still in the wallet that minted it." },
];

/// What the program will not do. Stated plainly, since these are what
/// other points programs were caught doing.
const PRINCIPLES = [
  "No snapshots. No multipliers. No points changed after the fact.",
  "Counted by the program, not by us. Anyone can check any wallet on chain.",
  "Referral and market rewards come out of our cut. LPs, backers, insurance and the chain are paid in full.",
  "A referrer is set once, before the first trade. It can't be bought later.",
  "Points are not a token.",
];

/// Seconds, ticking once a second while `on`.
function useClock(on: boolean) {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    if (!on) return;
    const id = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(id);
  }, [on]);
  return now;
}

export default function RewardsPage() {
  const wallet = useWallet();
  const { setVisible } = useWalletModal();
  const connected = wallet.publicKey?.toBase58();
  // `?wallet=` shows anyone's rewards, read only. It is all public on chain.
  const [viewing] = useState(() => {
    const w = new URLSearchParams(location.search).get("wallet");
    return w && isAddress(w) ? w : null;
  });
  const owner = viewing ?? connected;
  const self = !viewing || viewing === connected;
  const testnet = useHasBackend() === true;
  const [tab, go] = useHashTab(TABS, "leaderboard");

  const [tick, setTick] = useState(0);
  const r = usePoll<Rewards | null>(() => getRewards(owner), 15_000, [owner, tick]);
  const all = usePoll<Leaderboard | null>(() => getLeaderboard("all", owner), 30_000, [owner, tick]);
  const week = usePoll<Leaderboard | null>(() => getLeaderboard("week", owner), 30_000, [owner, tick]);
  const refresh = () => setTick((t) => t + 1);

  // Backing and the pool earn by the second, so those points are carried
  // forward between reads. Everything else arrives in steps.
  const rate = r ? r.perDay.backing + r.perDay.lp : 0;
  const now = useClock(rate > 0);
  const live = r ? r.points + (rate * Math.max(0, now - r.asOf)) / 86_400 : 0;

  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const run = async (key: string, path: string, body: Record<string, unknown> = {}) => {
    setBusy(key); setNote(null);
    const res = await signAndSend(wallet, path, body);
    setBusy(null);
    setNote(res.ok ? null : res.error ?? "failed");
    if (res.ok) refresh();
  };

  const arrived = storedRef();
  const link = r?.code ? `${location.origin}/?ref=${r.code}` : null;
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!link) return;
    try { await navigator.clipboard.writeText(link); setCopied(true); } catch { /* denied */ }
    setTimeout(() => setCopied(false), 1400);
  };
  const explorer = (address: string) =>
    `https://solscan.io/account/${address}${testnet ? "?cluster=devnet" : ""}`;
  const who = (address: string, code?: string | null) => code ?? short(address);

  const tabs: [Tab, ReactNode][] = [
    ["leaderboard", "Leaderboard"],
    ["referrals", <>Referred<Count n={r?.referralCount ?? 0} /></>],
    ["markets", <>Markets opened<Count n={r?.listed.length ?? 0} /></>],
    ["rates", "Rates"],
  ];

  return (
    <div className="site relative min-h-full">
      <SiteHeader here="/rewards" actions={<WalletActions />} />

      <Shell className="relative pb-14 pt-6 sm:pt-9">
        <PageTop title="Rewards"
          lede={!self
            ? <>Viewing <span className="n font-medium text-foreground">{who(viewing!, r?.code)}</span>.
                Read only; only its owner can claim. <a href="/rewards" className={LINK}>Yours</a></>
            : "Points on every dollar you trade, back or deposit. USDC on every trader you bring and every market you open."}
          actions={!owner ? (
            <>
              <Lookup path="/rewards" />
              <button type="button" onClick={() => setVisible(true)} disabled={api.readOnly} className={BTN}>
                Connect wallet
              </button>
            </>
          ) : self ? (
            <>
              {r?.exists && (
                <a href={explorer(r.account)} target="_blank" rel="noreferrer" className={GHOST}>
                  Verify on chain
                </a>
              )}
              <button type="button" disabled={!r || r.claimable <= 0 || !!busy}
                onClick={() => run("claim", "claim-rewards")} className={BTN}>
                {busy === "claim" ? "Claiming" : r && r.claimable > 0 ? `Claim ${money(r.claimable)}` : "Claim"}
              </button>
            </>
          ) : undefined} />

        <Tiles items={[
          { k: "Points",
            /* Two places while it is earning by the second, or the ticking would be invisible. */
            v: r ? (rate > 0 ? live.toLocaleString(undefined,
              { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : points(live)) : DASH,
            sub: rate > 0 ? `+${points(rate)} a day from backing and the pool` : r ? `${money(r.volume, 0)} traded` : undefined },
          { k: "Rank",
            v: all?.me ? `#${all.me.rank}` : DASH,
            sub: all?.me ? `of ${wallets(all.wallets)} · top ${Math.max(1, Math.round(all.me.percentile))}%` : all ? `${wallets(all.wallets)} ranked` : undefined },
          { k: "USDC to claim", tone: r && r.claimable > 0 ? "text-up" : "",
            v: r ? money(r.claimable) : DASH,
            sub: r ? `${money(r.earned.referrals + r.earned.listing)} earned · ${money(r.claimed)} claimed` : undefined },
          { k: "Fees saved",
            v: r ? money(r.feesSaved) : DASH,
            sub: r?.referrer ? `10% off, referred by ${r.referrerCode ?? short(r.referrer)}` : r ? "No referrer" : undefined },
        ]} />

        {owner && (
          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <Panel title="Breakdown" className="!mt-0">
              <div className={`${PAD} pb-3`}>
                <KV k="Trading">{r ? points(r.breakdown.trading) : DASH}</KV>
                <KV k="Referrals">{r ? points(r.breakdown.referrals) : DASH}</KV>
                <KV k="Markets opened">{r ? points(r.breakdown.listing) : DASH}</KV>
                <KV k="Backing and pool">{r ? points(r.breakdown.stakes) : DASH}</KV>
                <KV k="Earning now">{!r ? DASH : rate > 0 ? `${points(rate)} a day` : "Nothing accruing"}</KV>
                <KV k="Volume">{r ? money(r.volume, 0) : DASH}</KV>
              </div>
            </Panel>
            <Panel title="Referral" className="!mt-0">
              <div className={`${PAD} pb-4`}>
                {!self ? (
                  <>
                    <KV k="Code">{r?.code ?? DASH}</KV>
                    <KV k="Referred">{r ? r.referralCount : DASH}</KV>
                    <KV k="Referred volume">{r ? money(r.referredVolume, 0) : DASH}</KV>
                  </>
                ) : link ? (
                  <>
                    <KV k="Your code">{r!.code}</KV>
                    <div className="mt-3">
                      <div className={LABEL}>Your link</div>
                      <div className="mt-2 flex items-center gap-2">
                        <div className="n flex h-9 min-w-0 flex-1 items-center truncate rounded-[8px] border
                                        border-line bg-panel2 px-3 text-[13px]">
                          {link.replace(/^https?:\/\//, "")}
                        </div>
                        <button type="button" onClick={copy} className={`${BTN} flex-none`}>
                          {copied ? "Copied" : "Copy"}
                        </button>
                      </div>
                      <p className="mt-2 text-[12px] text-muted-foreground">
                        They pay 10% less. You get 10% of what they pay, in USDC, and 10% of their points.
                      </p>
                    </div>
                  </>
                ) : (
                  <ClaimCode busy={busy === "code"}
                    onClaim={(code) => run("code", "referral-code", { code })} />
                )}
                {self && r?.canSetReferrer !== false && !r?.referrer && arrived && arrived !== r?.code && (
                  <p className="mt-3 border-t border-linesoft pt-3 text-[12.5px] leading-relaxed text-muted-foreground">
                    Joined through <span className="font-medium text-foreground">{arrived}</span>.
                    Your first order locks them in as your referrer and takes 10% off your fees.{" "}
                    <button type="button" disabled={!!busy} className={`${LINK} disabled:opacity-35`}
                      onClick={() => run("ref", "set-referrer", { code: arrived })}>
                      {busy === "ref" ? "Confirming" : "Lock in now"}
                    </button>
                  </p>
                )}
                {note && <p className="mt-3 text-[12.5px] text-down">{note}</p>}
              </div>
            </Panel>
          </div>
        )}

        <Panel>
          <PanelTabs tabs={tabs} value={tab} onChange={go} />
          {tab === "leaderboard" && <Board all={all} week={week} owner={owner} self={self} who={who} />}
          {tab === "referrals" && (
            !owner ? <Empty>Connect a wallet, or look up any address above.</Empty>
              : !r ? <Empty>Reading.</Empty>
                : <Referrals r={r} self={self} explorer={explorer} />
          )}
          {tab === "markets" && (
            !owner ? <Empty>Connect a wallet, or look up any address above.</Empty>
              : !r ? <Empty>Reading.</Empty>
                : <Markets r={r} self={self} />
          )}
          {tab === "rates" && <Rates />}
        </Panel>
      </Shell>

      <SiteFooter />
    </div>
  );
}

const BOARD = "grid grid-cols-[36px_minmax(0,1fr)_minmax(0,.8fr)] items-center gap-x-3 " +
  "md:grid-cols-[48px_minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,.8fr)]";

const PERIODS: ["all" | "week", string][] = [["all", "All time"], ["week", "This week"]];

function Board({ all, week, owner, self, who }: {
  all: Leaderboard | null; week: Leaderboard | null; owner?: string; self: boolean;
  who: (a: string, c?: string | null) => string;
}) {
  const [period, setPeriod] = useState<"all" | "week">("all");
  const b = period === "all" ? all : week;
  const score = (row: LeaderRow) => period === "week" ? row.week : row.points;
  const rows = b?.top ?? [];
  const pinned = b?.me && !rows.some((t) => t.wallet === b.me!.wallet) ? b.me : null;

  const line = (row: LeaderRow) => (
    <a key={row.wallet} href={`/rewards?wallet=${row.wallet}`}
      className={`${BOARD} ${ROW} transition-colors hover:bg-panel2 ${row.wallet === owner ? "bg-panel2" : ""}`}>
      <span className={`n ${row.rank <= 3 ? "font-semibold" : "text-muted-foreground"}`}>{row.rank}</span>
      <span className="n min-w-0 truncate font-medium">
        {who(row.wallet, row.code)}
        {row.wallet === owner && self && <span className="ml-2 font-normal text-muted-foreground">you</span>}
      </span>
      <span className="n text-right md:text-left">{points(score(row))}</span>
      <span className="n hidden text-muted-foreground md:block">{compact(row.volume)}</span>
    </a>
  );

  return (
    <>
      <div className={`flex items-center justify-between gap-3 ${PAD} pt-3`}>
        <span className="text-[12.5px] text-muted-foreground">
          {b ? <>{wallets(b.wallets)} · {money(b.paidUsd)} paid out</> : null}
        </span>
        <Seg options={PERIODS} value={period} onChange={setPeriod} />
      </div>
      <Head cols={BOARD}>
        <span>#</span><span>Wallet</span>
        <span className="text-right md:text-left">{period === "week" ? "This week" : "Points"}</span>
        <span className="hidden md:block">Volume</span>
      </Head>
      {pinned && line(pinned)}
      {rows.map(line)}
      {!b && <Empty>Connect to devnet to load it.</Empty>}
      {b && rows.length === 0 && <Empty>No points yet.</Empty>}
      {b && b.wallets > 0 && (
        <Foot>
          Top 20 hold {(b.concentration * 100).toFixed(1)}% of {period === "week" ? "this week's" : "all"} points.
          House wallets aren't ranked.
        </Foot>
      )}
    </>
  );
}

function Referrals({ r, self, explorer }: {
  r: Rewards; self: boolean; explorer: (a: string) => string;
}) {
  const cols = "grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)] items-center gap-x-3 " +
    "md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]";
  if (r.referees.length === 0) {
    return <Empty>{!self || r.code ? "No referrals yet." : "Take a code above to get a link."}</Empty>;
  }
  return (
    <>
      <Head cols={cols}>
        <span>Wallet</span><span>Volume</span><span>USDC</span>
        <span className="hidden md:block">Points</span>
      </Head>
      {r.referees.map((x) => (
        <div key={x.wallet} className={`${cols} ${ROW}`}>
          <a href={explorer(x.wallet)} target="_blank" rel="noreferrer"
            className="n min-w-0 truncate font-medium hover:underline">
            {x.code ?? short(x.wallet)}
          </a>
          <span className="n">{compact(x.volume)}</span>
          <span className="n">{money(x.usdc)}</span>
          <span className="n hidden md:block">{points(x.points)}</span>
        </div>
      ))}
      <Foot>{r.referralCount} referred · {money(r.earned.referrals)} earned in USDC.</Foot>
    </>
  );
}

function Markets({ r, self }: { r: Rewards; self: boolean }) {
  const cols = "grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] items-center gap-x-3 " +
    "md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]";
  if (r.listed.length === 0) {
    return (
      <Empty>
        {self ? <>No markets yet. <a href="/list" className={LINK}>Open one</a> and earn 10% of its fees.</>
          : "No markets yet."}
      </Empty>
    );
  }
  return (
    <>
      <Head cols={cols}>
        <span>Market</span><span>Volume</span><span>USDC</span>
        <span className="hidden md:block">Points</span>
      </Head>
      {r.listed.map((m) => (
        <a key={m.symbol} href={`/trade?symbol=${m.symbol}`} className={`${cols} ${ROW} hover:bg-panel2`}>
          <span className="min-w-0 truncate font-medium">{m.symbol}</span>
          <span className="n">{compact(m.volume)}</span>
          <span className="n">{money(m.earned)}</span>
          <span className="n hidden md:block">{points(m.volume * 0.1)}</span>
        </a>
      ))}
      <Foot>{money(r.earned.listing)} earned in USDC across {r.listed.length} market{r.listed.length === 1 ? "" : "s"}.</Foot>
    </>
  );
}

/// The rates as a table, and the refusals under it.
function Rates() {
  const cols = "grid grid-cols-[minmax(0,.8fr)_minmax(0,1fr)] items-baseline gap-x-3 " +
    "md:grid-cols-[minmax(0,.6fr)_minmax(0,.9fr)_minmax(0,2fr)]";
  return (
    <>
      <Head cols={cols}>
        <span>For</span><span>Rate</span><span className="hidden md:block">Counted on</span>
      </Head>
      {RATES.map((x) => (
        <div key={x.label} className={`${cols} ${ROW}`}>
          <span className="font-medium">{x.label}</span>
          <span className="n">
            <span className="block">{x.figure}</span>
            <span className="block text-[12px] text-muted-foreground md:hidden">{x.line}</span>
          </span>
          <span className="hidden text-muted-foreground md:block">{x.line}</span>
        </div>
      ))}
      <div className={`border-t border-linesoft ${PAD} py-4`}>
        <div className={LABEL}>What the program won't do</div>
        <ul className="mt-2.5 space-y-1.5 text-[13px] leading-relaxed">
          {PRINCIPLES.map((p) => <li key={p}>{p}</li>)}
        </ul>
      </div>
      <Foot>
        Rules {RULES_VERSION}. They only change going forward, and every change is{" "}
        <a href={`${RULES_URL}#rules-changelog`} target="_blank" rel="noreferrer" className={LINK}>logged</a>.
      </Foot>
    </>
  );
}

/// Takes a code, checking as you type whether it is free.
function ClaimCode({ busy, onClaim }: { busy: boolean; onClaim: (code: string) => void }) {
  const [code, setCode] = useState("");
  const [state, setState] = useState<"idle" | "free" | "taken" | "invalid">("idle");
  useEffect(() => {
    if (!code) { setState("idle"); return; }
    if (!/^[a-z0-9_-]{3,16}$/.test(code)) { setState("invalid"); return; }
    let live = true;
    const t = setTimeout(() => {
      checkCode(code).then((c) => live && setState(c.owner ? "taken" : "free"),
        () => live && setState("idle"));
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [code]);

  const hint = {
    idle: "3 to 16 characters. Yours for good. They pay 10% less; you get 10% of what they pay.",
    free: "Available.",
    taken: "Taken.",
    invalid: "Letters, numbers, _ and -. 3 to 16 characters.",
  }[state];

  return (
    <div className="pt-1">
      <label htmlFor="ref-code" className={LABEL}>Take a code</label>
      <form className="mt-2 flex items-center gap-2"
        onSubmit={(e) => { e.preventDefault(); if (state === "free") onClaim(code); }}>
        <input id="ref-code" value={code} maxLength={16} spellCheck={false} autoCapitalize="none"
          onChange={(e) => setCode(e.target.value.toLowerCase())}
          placeholder="yourname"
          className="n h-9 min-w-0 flex-1 rounded-[8px] border border-line bg-panel2 px-3
                     text-[13px] outline-none transition-colors focus:border-foreground/40" />
        <button type="submit" disabled={state !== "free" || busy} className={`${BTN} flex-none`}>
          {busy ? "Taking" : "Take"}
        </button>
      </form>
      <p className={`mt-2 text-[12px] ${state === "taken" || state === "invalid"
        ? "text-down" : "text-muted-foreground"}`}>{hint}</p>
    </div>
  );
}
