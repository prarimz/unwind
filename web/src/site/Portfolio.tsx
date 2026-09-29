/*
 * Portfolio.
 *
 * Everything one wallet holds here, on one page: positions, the orders
 * waiting to fire, what it has in the pool and behind markets, and the fills
 * the server has settled for it. The trade screen shows one market at a time
 * and /earn one vault at a time; this is the page that adds them up.
 *
 * Every figure is read from the chain except the fill history, which the
 * program does not keep. The server records fills as it settles them, so the
 * history covers what it has settled since it last started and says so.
 *
 * The account's figures across the top, where the account stands beside
 * them, and the tables under one set of tabs. `?wallet=` shows anyone's,
 * read only, since it is all public anyway.
 */
import { useState, type ReactNode } from "react";
import "@/site/serif.css";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Shell, SiteFooter, SiteHeader } from "@/site/Chrome";
import {
  BTN, Count, DASH, Empty, Foot, GHOST, Head, KV, LINK, Lookup, PAD, PageTop, Panel,
  PanelTabs, ROW, SMALL, Skeleton, Tiles, isAddress, short, useHashTab,
} from "@/site/Account";
import { WalletActions } from "@/components/WalletActions";
import * as api from "@/lib/api";
import {
  getAccount, getBackings, getFills, getMarkets, getRewards, peek, useHasBackend, usePoll,
  type Account, type Backing, type Market, type Position, type Rewards, type Trade,
} from "@/lib/api";
import { signAndSend } from "@/lib/tx";
import { money, price, tone } from "@/lib/format";

const NO_BACKINGS: Backing[] = [];
const NO_FILLS: Trade[] = [];
const NONE: Market[] = [];

/// A signed dollar figure, with the plus a gain needs to read as one.
const signed = (n: number) => (n > 0 ? "+" : "") + money(n);
const when = (t: number) => {
  const d = new Date(t);
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString("en-GB")
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

type Order = Account["orders"][number];
/// What an order is, in the words the ticket used to set it. Slot 0 is the
/// take profit and slot 1 the stop; a limit order rests in any slot above.
const orderKind = (o: Order) =>
  o.kind === 1 ? (o.isLong ? "Limit buy" : "Limit sell")
    : o.slot === 0 ? "Take profit" : "Stop loss";

const TABS = ["positions", "orders", "vaults", "history"] as const;
type Tab = (typeof TABS)[number];

export default function PortfolioPage() {
  const wallet = useWallet();
  const { setVisible } = useWalletModal();
  const connected = wallet.publicKey?.toBase58();
  const [viewing] = useState(() => {
    const w = new URLSearchParams(location.search).get("wallet");
    return w && isAddress(w) ? w : null;
  });
  const owner = viewing ?? connected;
  const self = !viewing || viewing === connected;
  const testnet = useHasBackend() === true;
  const [tab, go] = useHashTab(TABS, "positions");

  // Nothing is read without a wallet. The server answers an ownerless
  // account request with its own demo account, which is not the visitor's.
  const [tick, setTick] = useState(0);
  const account = usePoll(() => owner ? getAccount(owner) : Promise.resolve(null), 5000, [owner, tick],
    () => (owner ? peek<Account>(`/api/account?owner=${owner}`) : null));
  const backingsRaw = usePoll(() => getBackings(owner), 10_000, [owner, tick]);
  const backings = backingsRaw ?? NO_BACKINGS;
  const rewards = usePoll<Rewards | null>(() => getRewards(owner), 15_000, [owner, tick]);
  const fillsRaw = usePoll(() => getFills(owner), 5000, [owner, tick]);
  const fills = fillsRaw ?? NO_FILLS;
  const markets = usePoll(getMarkets, 10_000) ?? NONE;

  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const cancel = async (o: Order) => {
    const key = `${o.symbol}:${o.slot}`;
    setBusy(key); setNote(null);
    const res = await signAndSend(wallet, "order/cancel", { symbol: o.symbol, slot: o.slot });
    setBusy(null);
    setNote(res.ok ? null : res.error ?? "failed");
    if (res.ok) setTick((t) => t + 1);
  };

  const positions = account
    ? Object.entries(account.positions).map(([symbol, p]) => ({ symbol, ...p }))
    : [];
  const orders = account?.orders ?? [];
  const lpHeld = (account?.lp.held ?? 0) > 0;
  const backed = backings.reduce((a, b) => a + b.value, 0);
  const notional = positions.reduce((a, p) => a + p.size, 0);
  // What the wallet would have if it closed and withdrew everything now.
  // `equity` from the server already counts USDC, margin, PnL and xLP.
  const total = account ? account.equity + backed : 0;
  const ready = !!owner && !!account;
  const canAct = self && !!connected && testnet && !busy;
  const explorer = (address: string) =>
    `https://solscan.io/account/${address}${testnet ? "?cluster=devnet" : ""}`;
  // The fee the account pays now: the venue's open fee, less the referral cut.
  const feeBps = markets[0]?.openFeeBps;
  const discount = rewards?.referrer ? 0.9 : 1;

  const tabs: [Tab, ReactNode][] = [
    ["positions", <>Positions<Count n={positions.length} /></>],
    ["orders", <>Orders<Count n={orders.length} /></>],
    ["vaults", <>Pool and backing<Count n={backings.length + (lpHeld ? 1 : 0)} /></>],
    ["history", "History"],
  ];

  return (
    <div className="site relative min-h-full">
      <SiteHeader here="/portfolio" actions={<WalletActions />} />

      <Shell className="relative pb-14 pt-6 sm:pt-9">
        <PageTop title="Portfolio"
          lede={!owner
            ? "Positions, orders, pool and backing for one wallet, read from the chain. Connect yours, or look up any address."
            : !self
              ? <>Viewing <a href={explorer(viewing!)} target="_blank" rel="noreferrer"
                  className="n font-medium text-foreground hover:underline">{short(viewing!)}</a>.
                  Read only; only its owner can cancel. <a href="/portfolio" className={LINK}>Yours</a></>
              : <a href={explorer(owner)} target="_blank" rel="noreferrer"
                  className="n text-foreground hover:underline">{short(owner)}</a>}
          actions={!owner ? (
            <>
              <Lookup path="/portfolio" />
              <button type="button" onClick={() => setVisible(true)} disabled={api.readOnly} className={BTN}>
                Connect wallet
              </button>
            </>
          ) : (
            <>
              <a href="/earn" className={GHOST}>Earn</a>
              <a href="/trade" className={BTN}>Trade</a>
            </>
          )} />

        <Tiles items={[
          { k: "Account value",
            v: ready ? money(total) : DASH,
            sub: ready ? `${money(account!.usdc)} free · ${money(account!.lp.value + backed)} in vaults` : undefined },
          { k: "Unrealized PnL", tone: ready ? tone(account!.unrealized) : "",
            v: ready ? signed(account!.unrealized) : DASH,
            sub: ready ? `${positions.length} open · ${money(notional, 0)} notional` : undefined },
          { k: "Margin in use",
            v: ready ? money(account!.margin) : DASH,
            sub: ready ? `${money(account!.usdc)} available to post` : undefined },
          { k: "Volume",
            v: rewards ? money(rewards.volume, 0) : DASH,
            sub: rewards ? `${rewards.points.toLocaleString(undefined, { maximumFractionDigits: 0 })} points earned` : undefined },
        ]} />

        {owner && (
          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            {/* Where the value sits. Lighter and Hyperliquid both open the
                portfolio with this list, and it is the one a person checks. */}
            <Panel title="Balances" className="!mt-0">
              <div className={`${PAD} pb-3`}>
                <KV k="Available USDC">{ready ? money(account!.usdc) : DASH}</KV>
                <KV k="Position margin">{ready ? money(account!.margin) : DASH}</KV>
                <KV k="Unrealized PnL" tone={ready ? tone(account!.unrealized) : ""}>
                  {ready ? signed(account!.unrealized) : DASH}
                </KV>
                <KV k="Pool (xLP)">{ready ? money(account!.lp.value) : DASH}</KV>
                <KV k="Backing">{backingsRaw ? money(backed) : DASH}</KV>
                <KV k="Total">{ready ? money(total) : DASH}</KV>
              </div>
            </Panel>
            <Panel title="Account" className="!mt-0"
              aside={rewards && rewards.claimable > 0 && self ? (
                <a href="/rewards" className={SMALL}>Claim {money(rewards.claimable)}</a>
              ) : undefined}>
              <div className={`${PAD} pb-3`}>
                <KV k="Fee per side">
                  {feeBps != null ? `${+(feeBps * discount).toFixed(2)} bps` : DASH}
                  {rewards?.referrer && <span className="ml-1.5 font-normal text-muted-foreground">10% off</span>}
                </KV>
                <KV k="Fees saved">{rewards ? money(rewards.feesSaved) : DASH}</KV>
                <KV k="USDC to claim">{rewards ? money(rewards.claimable) : DASH}</KV>
                <KV k="Referral code">
                  {rewards ? rewards.code ?? <a href="/rewards#referrals" className={`${LINK} font-normal text-muted-foreground`}>Take one</a> : DASH}
                </KV>
                <KV k="Referred by">{rewards ? rewards.referrerCode ?? (rewards.referrer ? short(rewards.referrer) : "Nobody") : DASH}</KV>
                <KV k="Address">
                  <a href={explorer(owner)} target="_blank" rel="noreferrer" className="hover:underline">
                    {short(owner)}
                  </a>
                </KV>
              </div>
            </Panel>
          </div>
        )}

        <Panel>
          {owner ? (
            <>
              <PanelTabs tabs={tabs} value={tab} onChange={go} />
              {note && <p className={`${PAD} py-2 text-[12.5px] text-down`}>{note}</p>}
              {tab === "positions" && <Positions rows={positions} loaded={ready} />}
              {tab === "orders" && (
                <Orders orders={orders} loaded={ready} canAct={canAct} busy={busy} onCancel={cancel} />
              )}
              {/* Each tab waits only for what it reads. The account read is the
                  slow one (a few round trips to the RPC), and holding the fills
                  and backings behind it left every table blank for seconds. */}
              {tab === "vaults" && (
                <Holdings account={account} backings={backings} rewards={rewards}
                  loaded={!!account || backingsRaw !== null} />
              )}
              {tab === "history" && (
                <History fills={fills} account={account} owner={owner} loaded={fillsRaw !== null} />
              )}
            </>
          ) : (
            <>
              <PanelTabs tabs={tabs} value={tab} onChange={go} />
              <Empty>
                {api.readOnly ? "This deploy has no chain behind it, so there is nothing to read."
                  : "Connect a wallet, or look up any address above."}
              </Empty>
            </>
          )}
        </Panel>
      </Shell>

      <SiteFooter />
    </div>
  );
}

/// Side and leverage sit under the market, so the row spends its width on
/// figures: three columns on a phone, six from md, seven from xl.
const POS = "grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)] items-center gap-x-3 " +
  "md:grid-cols-[minmax(0,1.2fr)_repeat(5,minmax(0,1fr))] " +
  "xl:grid-cols-[minmax(0,1.2fr)_repeat(6,minmax(0,1fr))]";

function Positions({ rows, loaded }: { rows: (Position & { symbol: string })[]; loaded: boolean }) {
  if (!loaded) return <Skeleton />;
  if (rows.length === 0) return <Empty>No open positions. <a href="/trade" className={LINK}>Trade</a></Empty>;
  const pnl = rows.reduce((a, r) => a + r.pnl, 0);
  return (
    <>
      <Head cols={POS}>
        <span>Market</span>
        <span>Size</span>
        <span className="hidden md:block">Entry</span>
        <span className="hidden md:block">Mark</span>
        <span className="text-right md:text-left">PnL</span>
        <span className="hidden md:block">Margin</span>
        <span className="hidden xl:block">Liq. price</span>
      </Head>
      {rows.map((r) => (
        <a key={r.symbol} href={`/trade?symbol=${r.symbol}`} className={`${POS} ${ROW} hover:bg-panel2`}>
          <span className="min-w-0">
            <span className="block truncate font-medium">{r.symbol}</span>
            <span className={`block text-[12px] ${r.isLong ? "text-up" : "text-down"}`}>
              {r.isLong ? "Long" : "Short"} {r.leverage.toFixed(1)}x
            </span>
          </span>
          <span className="n">{money(r.size, 0)}</span>
          <span className="n hidden md:block">{price(r.entry)}</span>
          <span className="n hidden md:block">{price(r.mark)}</span>
          <span className={`n text-right md:text-left ${tone(r.pnl)}`}>
            <span className="block">{signed(r.pnl)}</span>
            <span className="block text-[12px]">{(r.pnlPct > 0 ? "+" : "") + r.pnlPct.toFixed(1)}%</span>
          </span>
          <span className="n hidden md:block">{money(r.collateral)}</span>
          <span className="n hidden xl:block">{r.liqPrice ? price(r.liqPrice) : DASH}</span>
        </a>
      ))}
      <Foot>
        {rows.length} open, <span className={`n ${tone(pnl)}`}>{signed(pnl)}</span> unrealized.
      </Foot>
    </>
  );
}

const ORD = "grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto] items-center gap-x-3 " +
  "md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_88px]";

function Orders({ orders, loaded, canAct, busy, onCancel }: {
  orders: Order[]; loaded: boolean; canAct: boolean;
  busy: string | null; onCancel: (o: Order) => void;
}) {
  if (!loaded) return <Skeleton />;
  if (orders.length === 0) return <Empty>No take profits, stops or limit orders.</Empty>;
  return (
    <>
      <Head cols={ORD}>
        <span>Market</span>
        <span>Trigger</span>
        <span className="hidden md:block">Size</span>
        <span className="hidden md:block">Margin</span>
        <span />
      </Head>
      {orders.map((o) => {
        const key = `${o.symbol}:${o.slot}`;
        return (
          <div key={o.address} className={`${ORD} ${ROW}`}>
            <a href={`/trade?symbol=${o.symbol}`} className="min-w-0 hover:underline">
              <span className="block truncate font-medium">{o.symbol}</span>
              <span className="block text-[12px] text-muted-foreground">{orderKind(o)}</span>
            </a>
            <span className="n">{o.triggerAbove ? "≥ " : "≤ "}{price(o.triggerPrice)}</span>
            {/* A take profit or stop with no size closes the whole position. */}
            <span className="n hidden md:block">
              {o.sizeUsd > 0 ? money(o.sizeUsd, 0) : <span className="text-muted-foreground">All</span>}
            </span>
            <span className="n hidden md:block">{o.collateralUsd > 0 ? money(o.collateralUsd) : DASH}</span>
            <span className="text-right">
              {canAct || busy === key ? (
                <button type="button" disabled={!!busy} onClick={() => onCancel(o)} className={SMALL}>
                  {busy === key ? "Cancelling" : "Cancel"}
                </button>
              ) : null}
            </span>
          </div>
        );
      })}
    </>
  );
}

const HOLD = "grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)] items-center gap-x-3 " +
  "md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]";

/// The pool and every market's backing, in one table: both are capital this
/// wallet has lent the venue, and /earn is where either is changed.
function Holdings({ account, backings, rewards, loaded }: {
  account: Account | null; backings: Backing[]; rewards: Rewards | null; loaded: boolean;
}) {
  if (!loaded) return <Skeleton />;
  const lp = account?.lp;
  // What the xLP cost, as the program records it for tokens this wallet
  // minted. Tokens bought elsewhere have no cost here, so it is left blank
  // rather than shown as a gain.
  const lpCost = rewards?.exists && rewards.lp > 0 ? rewards.lp : null;
  const rows: { key: string; name: string; sub: string; value: number; deposited: number | null }[] = [];
  if (lp && lp.held > 0) {
    rows.push({ key: "pool", name: "Pool", sub: `${lp.held.toLocaleString(undefined,
      { maximumFractionDigits: 2 })} xLP at ${price(lp.price)}`, value: lp.value, deposited: lpCost });
  }
  for (const b of backings) {
    rows.push({ key: b.symbol, name: b.symbol, value: b.value, deposited: b.deposited,
      sub: b.opening ? "Backing, opening" : b.tradeable ? "Backing, live" : "Backing, waiting" });
  }
  if (rows.length === 0) {
    return <Empty>Nothing in the pool or behind a market. <a href="/earn" className={LINK}>Earn</a></Empty>;
  }
  return (
    <>
      <Head cols={HOLD}>
        <span>Vault</span>
        <span>Value</span>
        <span className="hidden md:block">Deposited</span>
        <span className="text-right md:text-left">Change</span>
      </Head>
      {rows.map((r) => {
        const change = r.deposited == null ? null : r.value - r.deposited;
        return (
          <a key={r.key} href="/earn" className={`${HOLD} ${ROW} hover:bg-panel2`}>
            <span className="min-w-0">
              <span className="block truncate font-medium">{r.name}</span>
              <span className="block truncate text-[12px] text-muted-foreground">{r.sub}</span>
            </span>
            <span className="n">{money(r.value)}</span>
            <span className="n hidden md:block">{r.deposited == null ? DASH : money(r.deposited)}</span>
            <span className={`n text-right md:text-left ${change == null ? "" : tone(change)}`}>
              {change == null ? DASH : signed(change)}
            </span>
          </a>
        );
      })}
    </>
  );
}

const HIST = "grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)] items-center gap-x-3 " +
  "md:grid-cols-[90px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]";

const ACTION: Record<string, string> = {
  open: "Open", close: "Close", liquidation: "Liquidated", trigger: "Trigger fired", expired: "Expired",
};

/// Settled fills, liquidations and the take profits and stops that fired,
/// merged into one list, newest first.
function History({ fills, account, owner, loaded }: {
  fills: Trade[]; account: Account | null; owner: string; loaded: boolean;
}) {
  if (!loaded) return <Skeleton />;
  // Fired triggers come from the account's shared list, which carries every
  // wallet's; only this one's belong here.
  const fired = (account?.orderFills ?? []).filter((f) => f.owner === owner).map((f) => ({
    t: f.t, symbol: f.symbol, kind: f.expired ? "expired" : "trigger",
    side: null as "buy" | "sell" | null, size: null as number | null, price: f.price,
  }));
  const rows = [...fills.map((f) => ({ ...f, side: f.side as "buy" | "sell" | null,
    size: f.size as number | null })), ...fired].sort((a, b) => b.t - a.t);
  const action = (r: (typeof rows)[number]) => `${ACTION[r.kind] ?? r.kind}${r.side ? ` ${r.side}` : ""}`;

  return (
    <>
      {rows.length === 0 ? <Empty>No fills since the server last started.</Empty> : (
        <>
          <Head cols={HIST}>
            <span className="hidden md:block">Time</span>
            <span>Market</span>
            <span className="hidden md:block">Action</span>
            <span>Size</span>
            <span className="text-right md:text-left">Price</span>
          </Head>
          {rows.map((r, i) => (
            <div key={`${r.t}-${i}`} className={`${HIST} ${ROW}`}>
              <span className="n hidden text-muted-foreground md:block">{when(r.t)}</span>
              <span className="min-w-0">
                <span className="block truncate font-medium">{r.symbol}</span>
                <span className="block truncate text-[12px] text-muted-foreground md:hidden">
                  {action(r)} · {when(r.t)}
                </span>
              </span>
              <span className="hidden text-muted-foreground md:block">{action(r)}</span>
              <span className="n">{r.size == null ? DASH : money(r.size, 0)}</span>
              <span className="n text-right md:text-left">{price(r.price)}</span>
            </div>
          ))}
        </>
      )}
      <Foot>Fills the server has settled since it last started, up to 50. The chain keeps positions, not a fill log.</Foot>
    </>
  );
}
