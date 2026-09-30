/*
 * Ranks, quests and seasons, worked out from what the chain already keeps.
 *
 * Nothing here is a second ledger. Every threshold is read off a wallet's
 * `Trader` account and the markets it opened (see `Rewards` in api.ts), so
 * the rank a page shows is the rank anyone would compute from the same
 * figures. The thresholds live in one place so the docs and the page cannot
 * disagree about them.
 *
 * Ranks do not multiply points: the page's rule that points are counted
 * once, by the program, and never changed after the fact still holds. What
 * a rank changes is USDC-side, a fee discount and a referral share, and
 * those take effect with mainnet, when the program carries them.
 */
import type { Rewards } from "@/lib/api";

/// Trading ranks, by points. The discount is off every open and close fee.
export const RANKS = [
  { name: "Trader",  at: 0,          discount: 0 },
  { name: "Regular", at: 10_000,     discount: 2.5 },
  { name: "Desk",    at: 100_000,    discount: 5 },
  { name: "Whale",   at: 1_000_000,  discount: 7.5 },
  { name: "Titan",   at: 10_000_000, discount: 10 },
] as const;

/// Referral ranks, by active referees: wallets that took your code and
/// have filled at least one order. The share is of every fee they pay.
export const REF_RANKS = [
  { name: "Referrer I",   at: 0,   share: 10 },
  { name: "Referrer II",  at: 5,   share: 15 },
  { name: "Referrer III", at: 20,  share: 20 },
  { name: "Referrer IV",  at: 50,  share: 25 },
] as const;

export const SEASONS = [
  { name: "Devnet",   note: "Now",     state: "active" },
  { name: "Season 1", note: "Mainnet", state: "upcoming" },
  { name: "Season 2", note: "",        state: "upcoming" },
  { name: "Season 3", note: "",        state: "upcoming" },
] as const;

export type Ladder = {
  /// Index into the ladder, and the rung itself.
  level: number; name: string;
  /// The figure the ladder is climbed by, and the next rung's threshold
  /// (null at the top).
  value: number; next: number | null;
  /// Progress from this rung to the next, 0 to 1.
  frac: number;
};

function climb(value: number, rungs: readonly { name: string; at: number }[]): Ladder {
  let level = 0;
  for (let i = 0; i < rungs.length; i++) if (value >= rungs[i].at) level = i;
  const here = rungs[level].at;
  const next = rungs[level + 1]?.at ?? null;
  const frac = next == null ? 1 : Math.min(1, Math.max(0, (value - here) / (next - here)));
  return { level, name: rungs[level].name, value, next, frac };
}

export const activeReferees = (r: Rewards) => r.referees.filter((x) => x.volume > 0).length;

export const tradingRank = (points: number) => climb(points, RANKS);
export const referralRank = (r: Rewards) => climb(activeReferees(r), REF_RANKS);

export type Quest = {
  key: string; text: string;
  /// Where it stands, and the figure it is done at.
  have: number; need: number;
  /// How the figures print.
  unit?: "usd" | "n";
  /// What finishing it earns. Rank quests name the rank.
  reward?: string;
};

const done = (q: Quest) => q.have >= q.need;

/// The quests that move a wallet up the trading ladder: the next rungs,
/// stated as what to do.
export function rankQuests(points: number): Quest[] {
  const { level } = tradingRank(points);
  return RANKS.slice(1).map((rk, i) => ({
    key: `rank-${i + 1}`,
    text: `Earn ${rk.at.toLocaleString()} points`,
    have: Math.min(points, rk.at), need: rk.at, unit: "n",
    reward: rk.name,
  })).filter((_, i) => i + 1 >= level);
}

export function refRankQuests(r: Rewards): Quest[] {
  const n = activeReferees(r);
  const { level } = referralRank(r);
  return REF_RANKS.slice(1).map((rk, i) => ({
    key: `ref-rank-${i + 1}`,
    text: `Refer ${rk.at} active traders`,
    have: Math.min(n, rk.at), need: rk.at, unit: "n",
    reward: rk.name,
  })).filter((_, i) => i + 1 >= level);
}

/// The season's quests. Each is one thing the venue is for, done once.
/// What a finished quest is worth at mainnet is set before mainnet, and
/// not before; the page says so rather than printing a number that could
/// move.
export function seasonQuests(r: Rewards): Quest[] {
  return [
    { key: "trade", text: "Trade $1,000", have: r.volume, need: 1_000, unit: "usd" },
    { key: "trade10k", text: "Trade $10,000", have: r.volume, need: 10_000, unit: "usd" },
    { key: "code", text: "Take a referral code", have: r.code ? 1 : 0, need: 1 },
    { key: "refer", text: "Refer 1 trader who trades", have: activeReferees(r), need: 1 },
    { key: "open", text: "Open a market", have: r.listed.length, need: 1 },
    { key: "back", text: "Back a market with $100", have: r.backing, need: 100, unit: "usd" },
    { key: "pool", text: "Hold $1,000 in the pool", have: r.lp, need: 1_000, unit: "usd" },
  ];
}

export function refSeasonQuests(r: Rewards): Quest[] {
  return [
    { key: "ref1", text: "Refer 1 trader who trades", have: activeReferees(r), need: 1 },
    { key: "ref5", text: "Refer 5 traders who trade", have: activeReferees(r), need: 5 },
    { key: "refvol", text: "$100,000 traded by your referrals", have: r.referredVolume, need: 100_000, unit: "usd" },
    { key: "refusd", text: "Earn $10 from referrals", have: r.earned.referrals, need: 10, unit: "usd" },
  ];
}

export const questsDone = (qs: Quest[]) => qs.filter(done).length;
export { done as questDone };
