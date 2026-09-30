/*
 * Rewards.
 *
 * What a wallet has earned, and where it stands. Points are counted by the
 * program as they are earned, so every figure here is one anybody can
 * check. Referrals and listings also pay USDC, out of the protocol's cut of
 * each fee.
 *
 * Over the figures sits a ladder: seasons, a trading rank climbed by points,
 * a referral rank climbed by active referees, and the quests that move a
 * wallet up each. None of it is a second ledger (see lib/ranks.ts): a rank
 * is read off the same account as the points, and what it changes is the
 * fee discount and the referral share, from mainnet, never the points.
 *
 * The copy leads with the figure, not an adjective, and states the
 * principles as things the program refuses to do.
 */
import { useEffect, useState, type ReactNode } from "react";
import "@/site/serif.css";
import { Check, ChevronDown, Lock } from "lucide-react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { DOCS, Shell, SiteFooter, SiteHeader } from "@/site/Chrome";
import { WalletActions } from "@/components/WalletActions";
import { Tabs, TabsList, TabsTrigger } from "@/components/motion/tabs";
import { AnimatedNumber } from "@/components/motion/animated-number";
import * as api from "@/lib/api";
import {
  checkCode, getLeaderboard, getRewards, useHasBackend, usePoll,
  type LeaderRow, type Leaderboard, type Rewards,
} from "@/lib/api";
import {
  RANKS, REF_RANKS, SEASONS, activeReferees, questDone, questsDone, rankQuests, refRankQuests,
  refSeasonQuests, referralRank, seasonQuests, tradingRank, type Ladder, type Quest,
} from "@/lib/ranks";
import { storedRef } from "@/lib/ref";
import { signAndSend } from "@/lib/tx";
import { compact, money } from "@/lib/format";

/// The rules in force. Shown on the page so a change is never silent.
const RULES_VERSION = "v2";
const RULES_URL = `${DOCS}/trading/rewards`;

type Tab = "rewards" | "referrals" | "leaderboard" | "rules";
const TABS: [Tab, string][] = [
  ["rewards", "Rewards"],
  ["referrals", "Referrals"],
  ["leaderboard", "Leaderboard"],
  ["rules", "How it works"],
];

const BTN = "press inline-flex h-10 items-center justify-center rounded-[8px] bg-foreground px-5 " +
  "text-[13.5px] font-medium text-background transition-opacity hover:opacity-90 " +
  "disabled:pointer-events-none disabled:opacity-35";
const GHOST = "press inline-flex h-9 items-center justify-center rounded-[8px] border border-line px-4 " +
  "text-[13px] font-medium transition-colors hover:border-foreground/40 " +
  "disabled:pointer-events-none disabled:opacity-35";
const LINK = "underline decoration-line underline-offset-4 transition-colors hover:text-foreground";
const CAPS = "text-[11px] font-medium uppercase tracking-[.08em] text-muted-foreground";
const DASH = <span className="font-normal text-dim">–</span>;
const PAD = "px-5 sm:px-7";

const points = (n: number) =>
  n.toLocaleString(undefined, { maximumFractionDigits: n < 100 ? 2 : 0 });
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
const fig = (n: number, unit?: Quest["unit"]) => unit === "usd" ? compact(n) : points(n);

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
  { label: "Ranks", figure: `Up to ${RANKS[RANKS.length - 1].discount}% off fees`,
    line: `By points. Referral rank raises your share to ${REF_RANKS[REF_RANKS.length - 1].share}%. From mainnet.` },
];

/// What the program will not do. Stated plainly, since these are what
/// other points programs were caught doing.
const PRINCIPLES = [
  "No snapshots. No multipliers. No points changed after the fact.",
  "Counted by the program, not by us. Anyone can check any wallet on chain.",
  "Referral and market rewards come out of our cut. LPs, backers, insurance and the chain are paid in full.",
  "A referrer is set once, before the first trade. It can't be bought later.",
  "A rank changes what you pay and what you are paid, never the points.",
  "Points are not a token.",
];

const FAQ: [string, ReactNode][] = [
  ["How do ranks work?", <>Points move you up the trading ladder, active referees up the referral one.
    Both are read off your wallet's on-chain account, so your rank is what anyone would work out
    from the same figures. A rank changes your fee discount and your referral share from mainnet.
    It never changes your points.</>],
  ["What are quests worth?", <>Rank quests are the rungs themselves. Season quests are the things the
    venue is for, done once, and what a finished one is worth at mainnet is set before mainnet,
    not before. No number is printed here that could later move.</>],
  ["Do I have to claim?", <>Points are on chain the moment they are earned; there is nothing to claim.
    USDC from referrals and markets sits in the pool's vault on its own line until you press
    Claim, and it can wait as long as you like.</>],
  ["Does devnet count?", <>Devnet fees are test USDC, so the USDC here is not real. Points and ranks
    earned on devnet are read at mainnet and credited under rules set before then; a market you
    opened is scored by the distinct wallets that traded it.</>],
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
    return w && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(w) ? w : null;
  });
  const owner = viewing ?? connected;
  const self = !viewing || viewing === connected;
  const testnet = useHasBackend() === true;

  // The tab lives in the hash, so a link can open straight to one.
  const tabFromHash = (): Tab => {
    const h = location.hash.slice(1) as Tab;
    return TABS.some(([k]) => k === h) ? h : "rewards";
  };
  const [tab, setTab] = useState<Tab>(tabFromHash);
  useEffect(() => {
    const sync = () => setTab(tabFromHash());
    addEventListener("hashchange", sync);
    return () => removeEventListener("hashchange", sync);
  }, []);
  const go = (t: Tab) => {
    setTab(t);
    history.replaceState(null, "", `${location.pathname}${location.search}#${t}`);
  };

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
  const name = owner ? who(owner, r?.code) : null;

  const rank = tradingRank(live);
  const refRank = r ? referralRank(r) : null;
  const canClaim = self && !!owner && !!r && r.claimable > 0 && !busy;

  const claim = (
    <button type="button" disabled={!canClaim} onClick={() => run("claim", "claim-rewards")}
      className={BTN}>
      {busy === "claim" ? "Claiming" : "Claim"}
    </button>
  );

  return (
    <div className="site min-h-full">
      <SiteHeader here="/rewards" actions={<WalletActions />} />

      <Shell className="pb-14 pt-6 sm:pt-9">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
          <div className="min-w-0">
            <h1 className="text-[24px] font-semibold leading-none tracking-[-.02em]">Rewards</h1>
            <p className="mt-2.5 max-w-[60ch] text-[13.5px] leading-[1.55] text-muted-foreground">
              Points on every dollar you trade, back or deposit. USDC on every trader you bring
              and every market you open. Ranks by what you have done.
            </p>
          </div>
          {!self ? (
            <p className="text-[13px] text-muted-foreground">
              Viewing <span className="n font-medium text-foreground">{name}</span>. Only its owner can claim.{" "}
              <a href="/rewards" className={LINK}>Yours</a>
            </p>
          ) : !owner ? (
            <button type="button" onClick={() => setVisible(true)} disabled={api.readOnly} className={BTN}>
              Connect wallet
            </button>
          ) : null}
        </div>

        <div className="mt-6 border-b border-line">
          <Tabs value={tab} onValueChange={(t) => go(t as Tab)} variant="underline"
            className="min-w-0 max-w-full">
            <TabsList className="-mb-px gap-0 border-0">
              {TABS.map(([k, label]) => (
                <TabsTrigger key={k} value={k} indicatorClassName="bg-foreground"
                  className="min-h-[42px] px-3 text-[13.5px] font-medium first:pl-0">
                  {label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>

        {note && <p className="mt-4 text-[12.5px] text-down">{note}</p>}

        {tab === "rewards" && (
          <>
            <Seasons />

            <RankBar name={name} ladder={rank} unit="points"
              line={rank.next == null ? "Top rank."
                : `${points(rank.next - live)} more points to ${RANKS[rank.level + 1].name}`}
              side={r ? [
                ["USDC earned", money(r.earned.referrals + r.earned.listing)],
                ["To claim", money(r.claimable)],
              ] : undefined} />

            <Tiles items={[
              { k: "Volume", v: r ? compact(r.volume) : DASH, sub: "Notional filled" },
              { k: "Points", v: r ? <AnimatedNumber value={live} duration={0.9}
                  format={rate > 0 ? (n) => n.toLocaleString(undefined,
                    { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : points} /> : DASH,
                sub: rate > 0 ? `+${points(rate)} a day` : all?.me ? `#${all.me.rank} of ${all.wallets.toLocaleString()}` : "" },
              { k: "Fees saved", v: r ? money(r.feesSaved) : DASH,
                sub: r?.referrer ? "10% off, referred" : "Take a referral to save 10%" },
              { k: "USDC to claim", v: r ? money(r.claimable) : DASH,
                sub: r && r.claimed > 0 ? `${money(r.claimed)} claimed` : "", action: claim },
            ]} />

            <div className="mt-4 grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
              <RankCard ladder={rank} rungs={RANKS.map((x) => x.name)}
                perks={[
                  ["Fee discount", `${RANKS[rank.level].discount}%`],
                  ...(rank.next != null ? [["Next rank", `${RANKS[rank.level + 1].discount}% off`] as [string, string]] : []),
                  ["Referral share", refRank ? `${REF_RANKS[refRank.level].share}%` : "10%"],
                ]}
                foot="Discounts and shares apply from mainnet, when the program carries them." />
              <Panel>
                <QuestList title="Rank quests" quests={rankQuests(live)}
                  empty="Top rank. Nothing left to climb." />
                <QuestList title="Season quests" quests={r ? seasonQuests(r) : []}
                  empty={owner ? "Reading the chain." : "Connect a wallet to see yours."}
                  foot="What a finished quest is worth at mainnet is set before mainnet." />
              </Panel>
            </div>

            <RankRow ladder={rank} rungs={RANKS.map((x) => ({
              name: x.name, at: `${x.at.toLocaleString()} points`, perk: x.discount ? `${x.discount}% off fees` : "No discount",
            }))} />

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <ClaimPanel title="USDC" line="From referrals and markets you opened. Out of our cut."
                value={r ? money(r.claimable) : DASH}
                sub={r?.exists ? <a href={explorer(r.account)} target="_blank" rel="noreferrer" className={LINK}>
                  Verify on Solscan</a> : undefined}
                action={claim} />
              <ClaimPanel title="Points" line="Counted by the program. Not a token."
                value={r ? points(live) : DASH}
                sub={all?.me ? `#${all.me.rank} of ${all.wallets.toLocaleString()} wallets` : undefined}
                action={<a href="#leaderboard" onClick={() => go("leaderboard")} className={GHOST}>Leaderboard</a>} />
            </div>

            <Overview r={r} live={live} />
            <Faq />
          </>
        )}

        {tab === "referrals" && (
          <>
            <RankBar name={name} ladder={refRank} unit="active traders"
              line={!refRank ? "Connect a wallet."
                : refRank.next == null ? "Top rank."
                : `${refRank.next - refRank.value} more active traders to ${REF_RANKS[refRank.level + 1].name}`}
              side={r ? [
                ["USDC earned", money(r.earned.referrals)],
                ["Their volume", compact(r.referredVolume)],
              ] : undefined} />

            <Panel className={`${PAD} py-5`}>
              {!self ? (
                <p className="text-[13px] text-muted-foreground">
                  {name} has {r?.referralCount ?? 0} referrals.
                </p>
              ) : !owner ? (
                <button type="button" onClick={() => setVisible(true)} disabled={api.readOnly} className={BTN}>
                  Connect wallet
                </button>
              ) : link ? (
                <YourLink link={link} copied={copied} onCopy={copy} count={r?.referralCount ?? 0} />
              ) : (
                <ClaimCode busy={busy === "code"} onClaim={(code) => run("code", "referral-code", { code })} />
              )}
              {self && owner && r?.canSetReferrer !== false && !r?.referrer && arrived
                && arrived !== r?.code && (
                <p className="mt-4 text-[12.5px] leading-relaxed text-muted-foreground">
                  Joined through <span className="font-medium text-foreground">{arrived}</span>.
                  Your first order locks them in as your referrer and takes 10% off your fees.{" "}
                  <button type="button" disabled={!!busy} className={`${LINK} disabled:opacity-35`}
                    onClick={() => run("ref", "set-referrer", { code: arrived })}>
                    {busy === "ref" ? "Confirming" : "Lock in now"}
                  </button>
                </p>
              )}
              {r?.referrer && (
                <p className="mt-4 text-[12.5px] text-muted-foreground">
                  Referred by <span className="font-medium text-foreground">{r.referrerCode ?? short(r.referrer)}</span>.
                  10% off every fee.
                </p>
              )}
            </Panel>

            <div className="mt-4 grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
              <RankCard ladder={refRank} rungs={REF_RANKS.map((x) => x.name)}
                perks={[
                  ["Your share", `${REF_RANKS[refRank?.level ?? 0].share}% of their fees`],
                  ...(refRank && refRank.next != null
                    ? [["Next rank", `${REF_RANKS[refRank.level + 1].share}%`] as [string, string]] : []),
                  ["Their discount", "10%"],
                  ["Active traders", refRank ? String(refRank.value) : "–"],
                ]}
                foot="An active trader has filled at least one order. Shares above 10% apply from mainnet." />
              <Panel>
                <QuestList title="Rank quests" quests={r ? refRankQuests(r) : []}
                  empty={owner ? "Top rank." : "Connect a wallet to see yours."} />
                <QuestList title="Season quests" quests={r ? refSeasonQuests(r) : []}
                  empty={owner ? "Reading the chain." : "Connect a wallet to see yours."}
                  foot="What a finished quest is worth at mainnet is set before mainnet." />
              </Panel>
            </div>

            <RankRow ladder={refRank} rungs={REF_RANKS.map((x) => ({
              name: x.name, at: x.at ? `${x.at} active traders` : "Start", perk: `${x.share}% share`,
            }))} />

            {owner && r ? (
              <>
                <Referrals r={r} self={self} explorer={explorer} />
                <Markets r={r} self={self} />
              </>
            ) : (
              <Card title="Referred"><Empty>Connect a wallet to see yours.</Empty></Card>
            )}
          </>
        )}

        {tab === "leaderboard" && <Board all={all} week={week} owner={owner} self={self} who={who} />}

        {tab === "rules" && (
          <div className="mt-4 grid overflow-hidden rounded-[12px] border border-line bg-panel
                          lg:grid-cols-[minmax(0,1fr)_400px]">
            {/* Bulk's numbered facts: a label, the figure, one line. */}
            <ol>
              {RATES.map((x, i) => (
                <li key={x.label}
                  className="grid grid-cols-[32px_minmax(0,1fr)] gap-x-4 border-t border-line px-5 py-5
                             first:border-t-0 sm:px-7">
                  <span className="n pt-0.5 text-[12px] text-muted-foreground">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <div className={CAPS}>{x.label}</div>
                    <div className="mt-1.5 text-[20px] font-semibold leading-tight tracking-[-.01em]">
                      {x.figure}
                    </div>
                    <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{x.line}</p>
                  </div>
                </li>
              ))}
            </ol>
            <aside className="border-t border-line bg-panel2 px-5 py-6 sm:px-7 lg:border-l lg:border-t-0">
              <div className={CAPS}>The rules</div>
              <ul className="mt-4 space-y-3 text-[13.5px] leading-relaxed">
                {PRINCIPLES.map((p) => <li key={p}>{p}</li>)}
              </ul>
              <p className="mt-6 text-[12.5px] text-muted-foreground">
                Rules {RULES_VERSION}. They only change going forward, and every change is{" "}
                <a href={`${RULES_URL}#rules-changelog`} target="_blank" rel="noreferrer" className={LINK}>
                  logged
                </a>.
              </p>
            </aside>
          </div>
        )}
      </Shell>

      <SiteFooter />
    </div>
  );
}

/* ------------------------------------------------------------- pieces */

function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section className={`mt-4 overflow-hidden rounded-[12px] border border-line bg-panel ${className}`}>
      {children}
    </section>
  );
}

/// The seasons in a row: the one running in full ink, the rest waiting.
function Seasons() {
  return (
    <div className="mt-5">
      <div className="flex items-baseline justify-between">
        <span className={CAPS}>Seasons</span>
        <span className="n text-[11.5px] text-muted-foreground">{SEASONS.length} seasons</span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-px overflow-hidden rounded-[12px] border border-line bg-line
                      md:grid-cols-4">
        {SEASONS.map((s) => {
          const on = s.state === "active";
          return (
            <div key={s.name} className={`flex items-center justify-between gap-3 px-4 py-3.5 ${
              on ? "bg-panel2" : "bg-panel"}`}>
              <div className="min-w-0">
                <div className={`truncate text-[13.5px] font-medium ${on ? "" : "text-muted-foreground"}`}>
                  {s.name}
                </div>
                <div className="mt-0.5 text-[11.5px] text-muted-foreground">
                  {on ? "Active now" : s.note || "Upcoming"}
                </div>
              </div>
              {on
                ? <span className="size-1.5 flex-none rounded-full bg-up" />
                : <Lock size={13} className="flex-none text-dim" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/// Who, where they stand, and how far to the next rung.
function RankBar({ name, ladder, unit, line, side }: {
  name: string | null; ladder: Ladder | null; unit: string; line: string;
  side?: [string, string][];
}) {
  return (
    <div className="mt-4 grid gap-px overflow-hidden rounded-[12px] border border-line bg-line
                    md:grid-cols-[minmax(0,1fr)_260px]">
      <div className={`bg-panel ${PAD} py-4`}>
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <span className="min-w-0 truncate text-[13.5px] font-medium">
            {name ?? "Not connected"}
            {ladder && <span className="ml-2 font-normal text-muted-foreground">{ladder.name}</span>}
          </span>
          <span className="n text-[12px] text-muted-foreground">
            {ladder ? <>{points(ladder.value)} {ladder.next != null && <>/ {points(ladder.next)}</>} {unit}</> : DASH}
          </span>
        </div>
        <div className="mt-3 h-[5px] overflow-hidden rounded-full bg-panel3">
          <i className="block h-full rounded-full bg-foreground"
            style={{ width: `${(ladder?.frac ?? 0) * 100}%`, transition: "width 700ms var(--ease-out-strong)" }} />
        </div>
        <div className="mt-2 text-[12px] text-muted-foreground">{line}</div>
      </div>
      <div className={`bg-panel ${PAD} py-3`}>
        {(side ?? [["USDC earned", "–"], ["To claim", "–"]]).map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-4 py-1.5 text-[12.5px]">
            <span className="text-muted-foreground">{k}</span>
            <span className="n font-medium">{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/// A row of the page's figures. Each is a label, the number, and one line.
function Tiles({ items }: {
  items: { k: string; v: ReactNode; sub?: ReactNode; action?: ReactNode }[];
}) {
  return (
    <div className="mt-4 grid gap-px overflow-hidden rounded-[12px] border border-line bg-line
                    sm:grid-cols-2 lg:grid-cols-4">
      {items.map((x) => (
        <div key={x.k} className={`flex items-start justify-between gap-3 bg-panel ${PAD} py-4`}>
          <div className="min-w-0">
            <div className={CAPS}>{x.k}</div>
            <div className="n mt-2 truncate text-[22px] font-semibold leading-none tracking-[-.02em]">{x.v}</div>
            <div className="n mt-2 min-h-[16px] text-[12px] text-muted-foreground">{x.sub}</div>
          </div>
          {x.action && <div className="flex-none pt-1">{x.action}</div>}
        </div>
      ))}
    </div>
  );
}

/// The rank, large, with the rungs under it and what it is worth.
function RankCard({ ladder, rungs, perks, foot }: {
  ladder: Ladder | null; rungs: string[]; perks: [string, string][]; foot: string;
}) {
  const level = ladder?.level ?? 0;
  return (
    <Panel className="flex flex-col">
      <div className={`${PAD} flex flex-col items-center py-8 text-center`}>
        <div className="grid size-[88px] place-items-center rounded-[16px] border border-line bg-panel2
                        text-[34px] font-semibold tracking-[-.02em]">
          {roman(level + 1)}
        </div>
        <div className={`${CAPS} mt-5`}>Rank</div>
        <div className="mt-1.5 text-[24px] font-semibold leading-none tracking-[-.02em]">
          {ladder ? ladder.name : "–"}
        </div>
        <div className="mt-6 flex w-full items-center">
          {rungs.map((n, i) => (
            <div key={n} className="flex flex-1 items-center last:flex-none">
              <span title={n}
                className={`grid size-6 flex-none place-items-center rounded-full border text-[10.5px] ${
                  i < level ? "border-foreground bg-foreground text-background"
                  : i === level ? "border-foreground text-foreground"
                  : "border-line text-dim"}`}>
                {i < level ? <Check size={11} /> : i + 1}
              </span>
              {i < rungs.length - 1 && (
                <i className={`mx-1 block h-px flex-1 ${i < level ? "bg-foreground" : "bg-line"}`} />
              )}
            </div>
          ))}
        </div>
      </div>
      <div className={`${PAD} border-t border-line py-2`}>
        {perks.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-4 border-t border-linesoft py-2.5
                                  text-[13px] first:border-t-0">
            <span className="text-muted-foreground">{k}</span>
            <span className="n font-medium">{v}</span>
          </div>
        ))}
      </div>
      <p className={`${PAD} mt-auto border-t border-line py-3 text-[12px] leading-relaxed text-muted-foreground`}>
        {foot}
      </p>
    </Panel>
  );
}

const roman = (n: number) => ["I", "II", "III", "IV", "V", "VI"][n - 1] ?? String(n);

/// Quests as rows: a check, what to do, how far along, what it is for.
function QuestList({ title, quests, empty, foot }: {
  title: string; quests: Quest[]; empty: string; foot?: string;
}) {
  return (
    <div className="border-t border-line first:border-t-0">
      <div className={`${PAD} flex items-baseline justify-between py-3`}>
        <h3 className="text-[14px] font-medium">{title}</h3>
        {quests.length > 0 && (
          <span className="n text-[12px] text-muted-foreground">{questsDone(quests)} / {quests.length}</span>
        )}
      </div>
      {quests.length === 0 && (
        <p className={`${PAD} border-t border-linesoft py-4 text-[13px] text-muted-foreground`}>{empty}</p>
      )}
      {quests.map((q) => {
        const ok = questDone(q);
        const frac = q.need > 0 ? Math.min(1, q.have / q.need) : 0;
        return (
          <div key={q.key} className={`${PAD} grid grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-x-3
                                        border-t border-linesoft py-3`}>
            <span className={`grid size-5 place-items-center rounded-full border ${
              ok ? "border-up bg-up text-background" : "border-line text-transparent"}`}>
              <Check size={12} strokeWidth={2.5} />
            </span>
            <div className="min-w-0">
              <div className={`truncate text-[13.5px] ${ok ? "text-muted-foreground line-through" : ""}`}>
                {q.text}
              </div>
              {!ok && (
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="h-[3px] w-[120px] overflow-hidden rounded-full bg-panel3">
                    <i className="block h-full bg-foreground" style={{ width: `${frac * 100}%` }} />
                  </div>
                  <span className="n text-[11px] text-muted-foreground">
                    {fig(q.have, q.unit)} / {fig(q.need, q.unit)}
                  </span>
                </div>
              )}
            </div>
            <span className="n text-right text-[12px] text-muted-foreground">{q.reward ?? ""}</span>
          </div>
        );
      })}
      {foot && (
        <p className={`${PAD} border-t border-linesoft py-3 text-[12px] text-muted-foreground`}>{foot}</p>
      )}
    </div>
  );
}

/// Every rung in a row: the one held in full ink, the rest locked.
function RankRow({ ladder, rungs }: {
  ladder: Ladder | null; rungs: { name: string; at: string; perk: string }[];
}) {
  const level = ladder?.level ?? -1;
  return (
    <div className="strip-scroll mt-4 -mx-5 px-5 sm:mx-0 sm:px-0">
      <div className="grid min-w-[640px] gap-px overflow-hidden rounded-[12px] border border-line bg-line"
        style={{ gridTemplateColumns: `repeat(${rungs.length}, minmax(0, 1fr))` }}>
        {rungs.map((x, i) => {
          const on = i === level, past = i < level;
          return (
            <div key={x.name} className={`flex flex-col items-center px-3 py-6 text-center ${
              on ? "bg-panel2" : "bg-panel"}`}>
              <span className={`h-5 text-[10.5px] font-medium uppercase tracking-[.08em] ${
                on ? "text-up" : past ? "text-muted-foreground" : "text-dim"}`}>
                {on ? "Current" : past ? "Held" : "Locked"}
              </span>
              <span className={`mt-3 grid size-12 place-items-center rounded-[12px] border text-[18px]
                                font-semibold ${on || past ? "border-line bg-panel text-foreground"
                                : "border-line text-dim"}`}>
                {roman(i + 1)}
              </span>
              <span className={`mt-4 text-[14px] font-medium ${on || past ? "" : "text-dim"}`}>{x.name}</span>
              <span className="n mt-1 text-[11.5px] text-muted-foreground">{x.at}</span>
              <span className={`n mt-1 text-[11.5px] ${on ? "text-up" : "text-muted-foreground"}`}>{x.perk}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ClaimPanel({ title, line, value, sub, action }: {
  title: string; line: string; value: ReactNode; sub?: ReactNode; action: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-[12px] border border-line bg-panel">
      <div className={`${PAD} pt-5`}>
        <h3 className="text-[16px] font-semibold tracking-[-.01em]">{title}</h3>
        <p className="mt-1 text-[12.5px] text-muted-foreground">{line}</p>
      </div>
      <div className={`${PAD} mt-4 flex items-center justify-between gap-4 border-t border-line py-4`}>
        <div className="min-w-0">
          <div className={CAPS}>Available</div>
          <div className="n mt-1.5 truncate text-[22px] font-semibold leading-none tracking-[-.02em]">{value}</div>
          {sub && <div className="mt-2 text-[12px] text-muted-foreground">{sub}</div>}
        </div>
        <div className="flex-none">{action}</div>
      </div>
    </section>
  );
}

/// Where the points and the USDC came from, as bars against the total.
function Overview({ r, live }: { r: Rewards | null; live: number }) {
  const pts: [string, number][] = r ? [
    ["Trading", r.breakdown.trading], ["Referrals", r.breakdown.referrals],
    ["Markets", r.breakdown.listing],
    ["Backing and pool", Math.max(0, live - r.breakdown.trading - r.breakdown.referrals - r.breakdown.listing)],
  ] : [];
  const usd: [string, number][] = r ? [
    ["Referrals", r.earned.referrals], ["Markets", r.earned.listing],
  ] : [];
  const Bars = ({ rows, format, empty }: { rows: [string, number][]; format: (n: number) => string; empty: string }) => {
    const total = rows.reduce((a, [, v]) => a + v, 0);
    if (!r || total <= 0) return <p className={`${PAD} py-8 text-[13px] text-muted-foreground`}>{empty}</p>;
    return (
      <div className={`${PAD} py-4`}>
        {rows.map(([k, v]) => (
          <div key={k} className="py-2">
            <div className="flex items-baseline justify-between text-[12.5px]">
              <span className="text-muted-foreground">{k}</span>
              <span className="n font-medium">{format(v)} <span className="font-normal text-dim">
                {((v / total) * 100).toFixed(0)}%</span></span>
            </div>
            <div className="mt-1.5 h-[4px] overflow-hidden rounded-full bg-panel3">
              <i className="block h-full rounded-full bg-foreground" style={{ width: `${(v / total) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
    );
  };
  return (
    <div className="mt-8">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[16px] font-semibold tracking-[-.01em]">Overview</h2>
        <span className="text-[12px] text-muted-foreground">All time</span>
      </div>
      <div className="mt-3 grid gap-4 md:grid-cols-2">
        <section className="overflow-hidden rounded-[12px] border border-line bg-panel">
          <div className={`${PAD} border-b border-line py-3 ${CAPS}`}>Points by source</div>
          <Bars rows={pts} format={points} empty="Trade, refer, open or back to start." />
        </section>
        <section className="overflow-hidden rounded-[12px] border border-line bg-panel">
          <div className={`${PAD} border-b border-line py-3 ${CAPS}`}>USDC by source</div>
          <Bars rows={usd} format={money} empty="Refer a trader or open a market to earn USDC." />
        </section>
      </div>
    </div>
  );
}

function Faq() {
  return (
    <div className="mt-8">
      <h2 className="text-[16px] font-semibold tracking-[-.01em]">Questions</h2>
      <p className="mt-1 text-[12.5px] text-muted-foreground">
        The full rules are in the <a href={RULES_URL} target="_blank" rel="noreferrer" className={LINK}>docs</a>.
      </p>
      <div className="mt-3 overflow-hidden rounded-[12px] border border-line bg-panel">
        {FAQ.map(([q, a]) => (
          <details key={q} className="group border-t border-line first:border-t-0">
            <summary className={`${PAD} flex cursor-pointer list-none items-center justify-between gap-4 py-4
                                 text-[14px] font-medium [&::-webkit-details-marker]:hidden`}>
              {q}
              <ChevronDown size={16} className="flex-none text-dim transition-transform group-open:rotate-180" />
            </summary>
            <p className={`${PAD} pb-5 text-[13.5px] leading-relaxed text-muted-foreground`}>{a}</p>
          </details>
        ))}
      </div>
    </div>
  );
}

function Card({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="mt-4 overflow-hidden rounded-[12px] border border-line bg-panel">
      <div className={`flex flex-wrap items-center justify-between gap-3 ${PAD} pb-3 pt-4`}>
        <h2 className="text-[14px] font-medium">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

const Empty = ({ children }: { children: ReactNode }) => (
  <p className={`border-t border-line ${PAD} py-8 text-[13px] text-muted-foreground`}>{children}</p>
);

const Head = ({ children, cols }: { children: ReactNode; cols: string }) => (
  <div className={`${cols} border-t border-line ${PAD} py-2.5 ${CAPS}`}>{children}</div>
);

const BOARD = "grid grid-cols-[40px_minmax(0,1fr)_minmax(0,.8fr)] items-center gap-x-4 " +
  "md:grid-cols-[48px_minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,.8fr)]";

function Board({ all, week, owner, self, who }: {
  all: Leaderboard | null; week: Leaderboard | null; owner?: string; self: boolean;
  who: (a: string, c?: string | null) => string;
}) {
  const [period, setPeriod] = useState<"all" | "week">("all");
  const b = period === "all" ? all : week;
  const score = (row: LeaderRow) => period === "week" ? row.week : row.points;
  const rows = b?.top ?? [];
  const pinned = b?.me && !rows.some((t) => t.wallet === b.me!.wallet) ? b.me : null;

  const Line = ({ row }: { row: LeaderRow }) => (
    <div className={`${BOARD} border-t border-line ${PAD} py-3 text-[13.5px] ${
      row.wallet === owner ? "bg-panel2" : ""}`}>
      <span className={`n ${row.rank <= 3 ? "font-semibold" : "text-muted-foreground"}`}>{row.rank}</span>
      <span className="n min-w-0 truncate font-medium">
        {who(row.wallet, row.code)}
        {row.wallet === owner && self && <span className="ml-2 font-normal text-muted-foreground">(you)</span>}
        <span className="ml-2 font-normal text-dim">{tradingRank(row.points).name}</span>
      </span>
      <span className="n text-right md:text-left">{points(score(row))}</span>
      <span className="n hidden text-muted-foreground md:block">{compact(row.volume)}</span>
    </div>
  );

  return (
    <Card title="Leaderboard" aside={
      <div className="flex items-center gap-0.5 rounded-[7px] border border-line p-0.5 text-[12px]">
        {([["all", "All time"], ["week", "This week"]] as const).map(([k, label]) => (
          <button key={k} type="button" onClick={() => setPeriod(k)} aria-pressed={period === k}
            className={`rounded-[5px] px-2 py-1 transition-colors ${period === k
              ? "bg-panel3 font-medium text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
            {label}
          </button>
        ))}
      </div>
    }>
      <Head cols={BOARD}>
        <span>#</span><span>Wallet</span>
        <span className="text-right md:text-left">{period === "week" ? "This week" : "Points"}</span>
        <span className="hidden md:block">Volume</span>
      </Head>
      {pinned && <Line row={pinned} />}
      {rows.map((row) => <Line key={row.wallet} row={row} />)}
      {!b && <Empty>Connect to devnet to load it.</Empty>}
      {b && rows.length === 0 && <Empty>No points yet.</Empty>}
      {b && b.wallets > 0 && (
        <p className={`border-t border-line ${PAD} py-4 text-[12.5px] text-muted-foreground`}>
          {b.wallets.toLocaleString()} wallets. Top 20 hold {(b.concentration * 100).toFixed(1)}%.{" "}
          {money(b.paidUsd)} paid out. House wallets aren't ranked.
        </p>
      )}
    </Card>
  );
}

function Referrals({ r, self, explorer }: {
  r: Rewards; self: boolean; explorer: (a: string) => string;
}) {
  const cols = "grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)] items-center gap-x-4 " +
    "md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]";
  return (
    <Card title="Referred" aside={
      <span className="n text-[12.5px] text-muted-foreground">
        {r.referralCount} · {activeReferees(r)} active · {money(r.earned.referrals)} earned
      </span>
    }>
      {r.referees.length === 0 ? (
        <Empty>{!self || r.code ? "No referrals yet." : "Take a code above to get a link."}</Empty>
      ) : (
        <>
          <Head cols={cols}>
            <span>Wallet</span><span>Volume</span><span>USDC</span>
            <span className="hidden md:block">Points</span>
          </Head>
          {r.referees.map((x) => (
            <div key={x.wallet} className={`${cols} border-t border-line ${PAD} py-3 text-[13.5px]`}>
              <a href={explorer(x.wallet)} target="_blank" rel="noreferrer"
                className="n min-w-0 truncate font-medium hover:underline">
                {x.code ?? short(x.wallet)}
                {x.volume <= 0 && <span className="ml-2 font-normal text-dim">not yet traded</span>}
              </a>
              <span className="n">{compact(x.volume)}</span>
              <span className="n">{money(x.usdc)}</span>
              <span className="n hidden md:block">{points(x.points)}</span>
            </div>
          ))}
        </>
      )}
    </Card>
  );
}

function Markets({ r, self }: { r: Rewards; self: boolean }) {
  const cols = "grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] items-center gap-x-4 " +
    "md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]";
  return (
    <Card title="Markets opened" aside={
      <span className="n text-[12.5px] text-muted-foreground">{money(r.earned.listing)} earned</span>
    }>
      {r.listed.length === 0 ? (
        <Empty>
          {self ? <>No markets yet. <a href="/list" className={LINK}>Open one</a> and earn 10% of its fees.</>
            : "No markets yet."}
        </Empty>
      ) : (
        <>
          <Head cols={cols}>
            <span>Market</span><span>Volume</span><span>USDC</span>
            <span className="hidden md:block">Points</span>
          </Head>
          {r.listed.map((m) => (
            <a key={m.symbol} href={`/trade?symbol=${m.symbol}`}
              className={`${cols} border-t border-line ${PAD} py-3 text-[13.5px] hover:bg-panel2`}>
              <span className="min-w-0 truncate font-medium">{m.symbol}</span>
              <span className="n">{compact(m.volume)}</span>
              <span className="n">{money(m.earned)}</span>
              <span className="n hidden md:block">{points(m.volume * 0.1)}</span>
            </a>
          ))}
        </>
      )}
    </Card>
  );
}

function YourLink({ link, copied, onCopy, count }: {
  link: string; copied: boolean; onCopy: () => void; count: number;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0 flex-1">
        <div className={CAPS}>Your link</div>
        <div className="mt-2 flex items-center gap-2">
          <div className="n flex h-10 min-w-0 flex-1 items-center truncate rounded-[8px] border
                          border-line bg-panel2 px-3.5 text-[13.5px]">
            {link.replace(/^https?:\/\//, "")}
          </div>
          <button type="button" onClick={onCopy} className={`${BTN} flex-none`}>
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <p className="mt-2.5 text-[12.5px] text-muted-foreground">
          They pay 10% less. You get your share of what they pay, in USDC, once they trade.
        </p>
      </div>
      <div className="n text-[13px] text-muted-foreground">
        <span className="font-medium text-foreground">{count}</span> referrals
      </div>
    </div>
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
    idle: "3 to 16 characters. Yours for good.",
    free: "Available.",
    taken: "Taken.",
    invalid: "Letters, numbers, _ and -. 3 to 16 characters.",
  }[state];

  return (
    <div>
      <div className={CAPS}>Referral code</div>
      <form className="mt-2 flex items-center gap-2"
        onSubmit={(e) => { e.preventDefault(); if (state === "free") onClaim(code); }}>
        <input value={code} maxLength={16} spellCheck={false} autoCapitalize="none"
          onChange={(e) => setCode(e.target.value.toLowerCase())}
          placeholder="yourname"
          className="n h-10 min-w-0 flex-1 rounded-[8px] border border-line bg-panel2 px-3.5
                     text-[14px] outline-none focus:border-foreground/40 sm:max-w-[360px]" />
        <button type="submit" disabled={state !== "free" || busy} className={`${BTN} flex-none`}>
          {busy ? "Claiming" : "Claim"}
        </button>
      </form>
      <p className={`mt-2.5 text-[12.5px] ${state === "taken" || state === "invalid"
        ? "text-down" : "text-muted-foreground"}`}>{hint}</p>
    </div>
  );
}
