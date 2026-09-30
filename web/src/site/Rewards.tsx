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
import { Check, Lock } from "lucide-react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { DOCS, PILL_INDICATOR, PILL_LIST, PILL_TRIGGER, Shell, SiteFooter, SiteHeader } from "@/site/Chrome";
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
  refSeasonQuests, referralRank, seasonQuests, tradingRank, type Ladder, type Quest, type Tint,
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

  const connect = (
    <button type="button" onClick={() => setVisible(true)} disabled={api.readOnly} className={BTN}>
      Connect wallet
    </button>
  );

  return (
    <div className="site min-h-full">
      <SiteHeader here="/rewards" actions={<WalletActions />} />

      {/*
       * The page opens the way /markets does: the violet field, the name in
       * the serif, and one row of pills for the parts of it. The season
       * strip sits on the field's foot, where it fades into the page.
       */}
      <div className="relative overflow-hidden border-b border-line">
        <img src="/waitlist/field.webp" alt="" aria-hidden
          className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-70
                     [mask-image:linear-gradient(to_bottom,black_40%,transparent)]" />
        <Shell className="relative pb-6 pt-10 text-center sm:pt-14">
          <h1 className="font-serif-display mx-auto text-[clamp(2.6rem,9vw,3.4rem)] leading-[1]
                         tracking-[-.025em] md:text-[72px]">
            Rewards
          </h1>
          <p className="mt-4 text-[11px] font-medium uppercase tracking-[.22em] text-foreground/70">
            Trade · Refer · Open
          </p>
          <div className="mt-7 flex justify-center">
            <Tabs value={tab} onValueChange={(t) => go(t as Tab)} variant="pill" className="min-w-0 max-w-full">
              <TabsList className={`${PILL_LIST} rounded-full border border-line bg-panel/70 p-1 backdrop-blur`}>
                {TABS.map(([k, label]) => (
                  <TabsTrigger key={k} value={k} className={PILL_TRIGGER} indicatorClassName={PILL_INDICATOR}>
                    {label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>
          <Seasons />
        </Shell>
      </div>

      <Shell className="pb-14 pt-4">
        {note && <p className="mb-4 text-[12.5px] text-down">{note}</p>}

        {tab === "rewards" && (
          <>
            <RankHero ladder={owner ? rank : null} unit="points"
              name={name}
              line={!owner ? "Connect a wallet to see your rank."
                : rank.next == null ? "Top rank."
                : `${points(rank.next - live)} more points to ${RANKS[rank.level + 1].name}`}
              perks={[
                ["Fee discount", `${RANKS[rank.level].discount}%`],
                ["Referral share", refRank ? `${REF_RANKS[refRank.level].share}%` : "10%"],
              ]}
              figures={[
                ["Points", r ? <AnimatedNumber value={live} duration={0.9}
                  format={rate > 0 ? (n) => n.toLocaleString(undefined,
                    { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : points} /> : DASH,
                  rate > 0 ? `+${points(rate)} a day` : all?.me ? `#${all.me.rank} of ${all.wallets.toLocaleString()}` : ""],
                ["Volume", r ? compact(r.volume) : DASH, "Notional filled"],
                ["Fees saved", r ? money(r.feesSaved) : DASH, r?.referrer ? "Referred, 10% off" : ""],
                ["USDC to claim", r ? money(r.claimable) : DASH,
                  r && r.claimed > 0 ? `${money(r.claimed)} claimed` : "From referrals and markets"],
              ]}
              action={!self ? (
                <p className="text-[12.5px] text-muted-foreground">
                  Viewing {name}. Only its owner can claim. <a href="/rewards" className={LINK}>Yours</a>
                </p>
              ) : !owner ? connect : (
                <div className="flex items-center gap-3">
                  {claim}
                  {r?.exists && (
                    <a href={explorer(r.account)} target="_blank" rel="noreferrer"
                      className={`text-[12.5px] text-muted-foreground ${LINK}`}>Verify on Solscan</a>
                  )}
                </div>
              )} />

            <Quests
              left={{ title: "Rank quests", quests: rankQuests(live), empty: "Top rank. Nothing left to climb." }}
              right={{ title: "Season quests", quests: r ? seasonQuests(r) : [],
                empty: owner ? "Reading the chain." : "Connect a wallet to see yours." }} />

            <RankRow ladder={owner ? rank : null} rungs={RANKS.map((x) => ({
              name: x.name, tint: x.tint, at: x.at ? `${x.at.toLocaleString()} points` : "Start",
              perk: x.discount ? `${x.discount}% off fees` : "No discount",
            }))} foot="Discounts apply from mainnet, when the program carries them. A rank never changes points." />
          </>
        )}

        {tab === "referrals" && (
          <>
            <RankHero ladder={refRank} unit="active traders"
              name={name}
              line={!refRank ? "Connect a wallet to see your rank."
                : refRank.next == null ? "Top rank."
                : `${refRank.next - refRank.value} more active traders to ${REF_RANKS[refRank.level + 1].name}`}
              perks={[
                ["Your share", `${REF_RANKS[refRank?.level ?? 0].share}% of their fees`],
                ["Their discount", "10%"],
              ]}
              figures={[
                ["Referrals", r ? String(r.referralCount) : DASH, r ? `${activeReferees(r)} have traded` : ""],
                ["Their volume", r ? compact(r.referredVolume) : DASH, ""],
                ["USDC earned", r ? money(r.earned.referrals) : DASH, "Out of our cut"],
                ["USDC to claim", r ? money(r.claimable) : DASH, ""],
              ]}
              action={!self ? null : !owner ? connect : link
                ? <YourLink link={link} copied={copied} onCopy={copy} />
                : <ClaimCode busy={busy === "code"} onClaim={(code) => run("code", "referral-code", { code })} />}
              under={<>
                {self && owner && r?.canSetReferrer !== false && !r?.referrer && arrived
                  && arrived !== r?.code && (
                  <p className="text-[12.5px] leading-relaxed text-muted-foreground">
                    Joined through <span className="font-medium text-foreground">{arrived}</span>.
                    Your first order locks them in as your referrer and takes 10% off your fees.{" "}
                    <button type="button" disabled={!!busy} className={`${LINK} disabled:opacity-35`}
                      onClick={() => run("ref", "set-referrer", { code: arrived })}>
                      {busy === "ref" ? "Confirming" : "Lock in now"}
                    </button>
                  </p>
                )}
                {r?.referrer && (
                  <p className="text-[12.5px] text-muted-foreground">
                    Referred by <span className="font-medium text-foreground">{r.referrerCode ?? short(r.referrer)}</span>.
                    10% off every fee.
                  </p>
                )}
              </>} />

            <Quests
              left={{ title: "Rank quests", quests: r ? refRankQuests(r) : [],
                empty: owner ? "Top rank." : "Connect a wallet to see yours." }}
              right={{ title: "Season quests", quests: r ? refSeasonQuests(r) : [],
                empty: owner ? "Reading the chain." : "Connect a wallet to see yours." }} />

            <RankRow ladder={owner ? refRank : null} rungs={REF_RANKS.map((x) => ({
              name: x.name, tint: x.tint, at: x.at ? `${x.at} active traders` : "Start", perk: `${x.share}% share`,
            }))} foot="An active trader has filled at least one order. Shares above 10% apply from mainnet." />

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
          <div className="mt-4 grid overflow-hidden rounded-[24px] border border-line bg-panel
                          lg:grid-cols-[minmax(0,1fr)_440px]">
            {/* Bulk's numbered facts: a label, the figure, one line. */}
            <ol>
              {RATES.map((x, i) => (
                <li key={x.label}
                  className="grid grid-cols-[32px_minmax(0,1fr)] gap-x-4 border-t border-line px-5 py-6
                             first:border-t-0 sm:px-9">
                  <span className="n pt-0.5 text-[12px] text-muted-foreground">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <div className={CAPS}>{x.label}</div>
                    <div className="mt-1.5 text-[22px] font-semibold leading-tight tracking-[-.01em]">
                      {x.figure}
                    </div>
                    <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{x.line}</p>
                  </div>
                </li>
              ))}
            </ol>
            <aside className="border-t border-line bg-panel2 px-5 py-7 sm:px-9 sm:py-9 lg:border-l
                              lg:border-t-0">
              <div className={CAPS}>The rules</div>
              <ul className="mt-4 space-y-3 text-[14px] leading-relaxed">
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

/// The glass mark, tinted for a rank. Locked ranks are drained.
const TINT: Record<Tint, string> = {
  bronze: "sepia(1) saturate(2.2) hue-rotate(-28deg) brightness(.82)",
  silver: "grayscale(1) brightness(1.15)",
  gold: "sepia(1) saturate(3) hue-rotate(2deg) brightness(1.12)",
  platinum: "grayscale(.7) brightness(1.3) contrast(1.05)",
  diamond: "saturate(1.15) brightness(1.1)",
};
function Emblem({ tint, size, locked = false, glow = false }: {
  tint: Tint; size: number; locked?: boolean; glow?: boolean;
}) {
  return (
    <span className="relative grid flex-none place-items-center" style={{ width: size, height: size }}>
      {glow && !locked && (
        <span aria-hidden className="absolute inset-[-30%] rounded-full bg-brand/30 blur-2xl" />
      )}
      <img src="/waitlist/logo-glass.webp" alt="" draggable={false} width={size} height={size}
        className="relative select-none"
        style={{ filter: locked ? "grayscale(1) brightness(.6)" : TINT[tint],
                 opacity: locked ? .35 : 1 }} />
    </span>
  );
}

/// The seasons in a row on the foot of the field: the one running in full
/// ink with a live dot, the rest waiting.
function Seasons() {
  return (
    <div className="mt-9 grid grid-cols-2 gap-px overflow-hidden rounded-[14px] border border-line bg-line
                    text-left md:grid-cols-4">
      {SEASONS.map((s) => {
        const on = s.state === "active";
        return (
          <div key={s.name} className={`flex items-center justify-between gap-3 px-4 py-3.5 ${
            on ? "bg-panel2" : "bg-panel/80 backdrop-blur"}`}>
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
  );
}

/*
 * The one card: the rank on the left, on the field with the mark lit up,
 * the progress to the next rung under it; the figures and the action on
 * the right. The /list split card, so it is the same object as the top of
 * /earn and /portfolio.
 */
function RankHero({ ladder, unit, name, line, perks, figures, action, under }: {
  ladder: Ladder | null; unit: string; name: string | null; line: string;
  perks: [string, string][];
  figures: [string, ReactNode, ReactNode][];
  action: ReactNode; under?: ReactNode;
}) {
  const tint = ladder?.tint ?? "bronze";
  return (
    <div className="grid overflow-hidden rounded-[24px] border border-line bg-panel
                    lg:grid-cols-[minmax(0,1fr)_440px]">
      <section className="relative overflow-hidden px-5 py-8 sm:px-9 sm:py-10">
        <img src="/waitlist/field.webp" alt="" aria-hidden
          className="pointer-events-none absolute inset-0 hidden h-full w-full object-cover opacity-40 dark:block" />
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-t from-panel
                                    via-panel/60 to-transparent" />
        <div className="relative flex flex-col items-start gap-6 sm:flex-row sm:items-center sm:gap-9">
          <Emblem tint={tint} size={168} locked={!ladder} glow />
          <div className="min-w-0 flex-1">
            <div className={CAPS}>{name ?? "Not connected"}</div>
            <div className="font-serif-display mt-2 text-[clamp(2.4rem,5vw,3.4rem)] leading-none tracking-[-.02em]">
              {ladder ? ladder.name : "No rank yet"}
            </div>
            <div className="mt-5 flex items-baseline justify-between gap-4 text-[12px] text-muted-foreground">
              <span>{line}</span>
              <span className="n flex-none">
                {ladder ? <>{points(ladder.value)}{ladder.next != null && <> / {points(ladder.next)}</>} {unit}</> : ""}
              </span>
            </div>
            <div className="mt-2 h-[6px] overflow-hidden rounded-full bg-panel3/80">
              <i className="block h-full rounded-full bg-brand"
                style={{ width: `${(ladder?.frac ?? 0) * 100}%`, transition: "width 700ms var(--ease-out-strong)" }} />
            </div>
            <div className="mt-5 flex flex-wrap gap-x-7 gap-y-2">
              {perks.map(([k, v]) => (
                <div key={k} className="text-[12.5px]">
                  <span className="text-muted-foreground">{k}</span>{" "}
                  <span className="n font-semibold">{v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <aside className="flex min-w-0 flex-col border-t border-line bg-panel2 px-5 py-7
                        sm:px-9 sm:py-8 lg:border-l lg:border-t-0">
        <div className="grid grid-cols-2 gap-x-6 gap-y-6">
          {figures.map(([k, v, sub]) => (
            <div key={k} className="min-w-0">
              <div className={CAPS}>{k}</div>
              <div className="n mt-2 truncate text-[26px] font-semibold leading-none tracking-[-.02em]">{v}</div>
              <div className="mt-1.5 min-h-[16px] truncate text-[12px] text-muted-foreground">{sub}</div>
            </div>
          ))}
        </div>
        <div className="mt-auto pt-7">{action}</div>
        {under && <div className="mt-4">{under}</div>}
      </aside>
    </div>
  );
}

/// The two quest lists side by side in one panel.
function Quests({ left, right }: {
  left: { title: string; quests: Quest[]; empty: string };
  right: { title: string; quests: Quest[]; empty: string };
}) {
  return (
    <section className="mt-4 grid overflow-hidden rounded-[24px] border border-line bg-panel md:grid-cols-2">
      <QuestList {...left} />
      <QuestList {...right} className="border-t border-line md:border-l md:border-t-0"
        foot="What a finished quest is worth at mainnet is set before mainnet." />
    </section>
  );
}

/// Quests as rows: a check, what to do, how far along, what it is for.
function QuestList({ title, quests, empty, foot, className = "" }: {
  title: string; quests: Quest[]; empty: string; foot?: string; className?: string;
}) {
  return (
    <div className={className}>
      <div className={`${PAD} flex items-baseline justify-between pb-3 pt-5`}>
        <h3 className="text-[15px] font-medium">{title}</h3>
        {quests.length > 0 && (
          <span className="n text-[12px] text-muted-foreground">{questsDone(quests)} / {quests.length}</span>
        )}
      </div>
      {quests.length === 0 && (
        <p className={`${PAD} border-t border-line py-5 text-[13px] text-muted-foreground`}>{empty}</p>
      )}
      {quests.map((q) => {
        const ok = questDone(q);
        const frac = q.need > 0 ? Math.min(1, q.have / q.need) : 0;
        return (
          <div key={q.key} className={`${PAD} grid grid-cols-[22px_minmax(0,1fr)_auto] items-center gap-x-3
                                        border-t border-line py-3.5`}>
            <span className={`grid size-[22px] place-items-center rounded-full border ${
              ok ? "border-brand bg-brand text-white" : "border-line text-transparent"}`}>
              <Check size={12} strokeWidth={2.5} />
            </span>
            <div className="min-w-0">
              <div className={`truncate text-[13.5px] ${ok ? "text-muted-foreground line-through" : ""}`}>
                {q.text}
              </div>
              {!ok && q.have > 0 && (
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="h-[3px] w-[110px] overflow-hidden rounded-full bg-panel3">
                    <i className="block h-full rounded-full bg-brand" style={{ width: `${frac * 100}%` }} />
                  </div>
                  <span className="n text-[11px] text-muted-foreground">
                    {fig(q.have, q.unit)} / {fig(q.need, q.unit)}
                  </span>
                </div>
              )}
            </div>
            <span className="n text-right text-[12px] font-medium text-muted-foreground">{q.reward ?? ""}</span>
          </div>
        );
      })}
      {foot && (
        <p className={`${PAD} border-t border-line py-3 text-[12px] text-muted-foreground`}>{foot}</p>
      )}
    </div>
  );
}

/// Every rung in a row: the held ones in their metal, the rest drained.
function RankRow({ ladder, rungs, foot }: {
  ladder: Ladder | null; rungs: { name: string; tint: Tint; at: string; perk: string }[]; foot: string;
}) {
  const level = ladder?.level ?? -1;
  return (
    <section className="mt-4 overflow-hidden rounded-[24px] border border-line bg-panel">
      <div className="strip-scroll">
        <div className="grid min-w-[640px]" style={{ gridTemplateColumns: `repeat(${rungs.length}, minmax(0, 1fr))` }}>
          {rungs.map((x, i) => {
            const on = i === level, held = i <= level;
            return (
              <div key={x.name} className={`relative flex flex-col items-center border-l border-line px-3 pb-6 pt-5
                                            text-center first:border-l-0 ${on ? "bg-panel2" : ""}`}>
                <span className={`h-5 text-[10.5px] font-medium uppercase tracking-[.12em] ${
                  on ? "text-brand" : held ? "text-muted-foreground" : "text-dim"}`}>
                  {on ? "Current" : held ? "Held" : "Locked"}
                </span>
                <div className="mt-3"><Emblem tint={x.tint} size={72} locked={!held} glow={on} /></div>
                <span className={`mt-4 text-[15px] font-medium ${held ? "" : "text-dim"}`}>{x.name}</span>
                <span className="n mt-1 text-[11.5px] text-muted-foreground">{x.at}</span>
                <span className={`n mt-0.5 text-[11.5px] ${on ? "text-foreground" : "text-muted-foreground"}`}>{x.perk}</span>
              </div>
            );
          })}
        </div>
      </div>
      <p className={`${PAD} border-t border-line py-3 text-[12px] text-muted-foreground`}>{foot}</p>
    </section>
  );
}

function Card({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="mt-4 overflow-hidden rounded-[24px] border border-line bg-panel">
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

function YourLink({ link, copied, onCopy }: { link: string; copied: boolean; onCopy: () => void }) {
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
