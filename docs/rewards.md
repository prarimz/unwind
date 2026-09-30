# Referrals and points

## Overview

unwind rewards the people who make a market worth trading: the traders, the
people who open markets, the people who back them, and the people who bring
others in. There are two kinds of reward.

* **Points**, counted by the program on chain as they are earned. Points are a
  record of use, not a token and not a promise of one. The tally is the one
  the program kept, and anyone can check any wallet's on its `Trader` account.
* **USDC**, paid to referrers and to whoever opened a market, out of the
  protocol's share of each trading fee. It is claimable at any time from
  [Rewards](https://unwindfi.xyz/rewards).

Every wallet has a `Trader` account that holds both. It is made the first time
the wallet places an order, backs a market, adds liquidity, or takes a
referral code.

## Earning points

| Activity | Points |
| --- | --- |
| Trading | 1 point per $1 of notional filled, opens and closes both |
| Referring | 10 percent of the points your referees earn from trading |
| Opening a market | 0.1 points per $1 traded on a market you opened |
| Backing a market | 2 points per $1 of backing, per day |
| Providing liquidity | 1 point per $1 deposited in the pool, per day |

A referee keeps all of their own points. The referrer's share is extra, not
taken from them.

Backing earns twice the pool's rate because backing takes first loss on its
market (see [How to underwrite a market](how-to-underwrite-a-market.md)).
Backing points are counted on what was posted, in dollars at the time, and
stop in proportion to the shares withdrawn.

Pool points are counted on the xLP a wallet minted and still holds. xLP can be
moved to another wallet without the program seeing it, so tokens sent away
stop earning at the next update and do not start again if they come back, and
tokens received from someone else earn nothing.

## Referrals

A wallet takes a referral code once: 3 to 16 characters of `a` to `z`, `0` to
`9`, `_` and `-`, first come, permanent. Its link is
`unwindfi.xyz/?ref=<code>`.

A wallet that arrives on a link names that code's holder as its referrer with
its first order. It can also do so from the Rewards page before trading. The
referrer can be set once, only before the wallet's first fill, and never to
the wallet itself.

Once referred, a wallet:

* pays **10 percent less** on every open and close fee, and
* its referrer is owed **10 percent of every fee it pays**, in USDC, plus 10
  percent of its trading points.

Liquidation fees are not discounted and carry no referral share.

## Opening a market

Whoever opens a market (its `deployer`, see
[How to open a market](how-to-open-a-market.md)) is owed:

* **10 percent of every fee** paid on that market, in USDC, and
* 0.1 points per dollar traded on it.

They also trade their own market at **half the fee**. The discount applies
only to the market they opened: a discount on every market would make opening
a throwaway market the cheapest way to trade everything else. On their own
market a deployer takes the discount instead of the fee share, and the
deployer discount and the referral discount do not stack; the larger applies.

## Where the USDC comes from

Referral and listing rewards are taken from the protocol's share of each fee
and from nothing else. On the default split (see [Fees](fees.md)) the protocol
receives 20 percent of every fee, so on a fee paid by a referred trader on a
market somebody else opened, 10 percent goes to the referrer, 10 percent to
the deployer, and the protocol keeps nothing. The liquidity pool, backers,
insurance fund and chain are paid exactly what they would be without any
referral.

When the protocol's share of a fee is smaller than the rewards on it, the
referrer is paid first and the deployer's share is cut to fit. The USDC sits in the pool's vault
on its own line, `rewards_usd`, until it is claimed, so it is never counted as
LP capital.

## Syncing

Settlement never needs a referrer's or a deployer's account, which keeps the
number of orders that fit in one settlement transaction as high as possible.
What a trade earns them is left on the referee's `Trader` account and on the
market, and two permissionless instructions move it across:

* `sync_referral` moves a referee's owed points and USDC to their referrer.
* `sync_deployer` moves a market's owed USDC and volume points to its deployer.

Neither can pay anyone but the account the program says is owed. The devnet
server runs both every minute, and claiming from the Rewards page syncs the
wallet's own markets first. Backing and pool points are brought up to date
whenever the stake changes, or by anyone calling `accrue_points`.

## Numerical example

A referred trader opens $10,000 on a market with a 10 basis point open fee,
which somebody else opened.

1. The full fee would be $10. With the referral discount it is $9.
2. The trader earns 10,000 points; their referrer is owed 1,000.
3. The protocol's 20 percent of $9 is $1.80. Of it, $0.90 goes to the
   referrer and $0.90 to the market's deployer.
4. The chain ($0.90), insurance fund ($0.90) and pool ($5.40, shared with
   backers if the market has any) are paid as usual.

## Leaderboard

The Rewards page ranks every wallet with points, all time and for the current
week (Monday 00:00 UTC onwards), and pins the viewer's own row. It also
publishes the share of points the top 20 wallets hold, so concentration is
visible rather than something to work out. Wallets the venue runs itself, such
as devnet's market maker, earn points like anyone else but are left off
the ranking.

## Ranks

A wallet holds two ranks, both read off its `Trader` account. Neither is a
second ledger: a rank is what anyone would work out from the same figures,
and the thresholds are in the site's source (`web/src/lib/ranks.ts`).

A rank never changes points. What it changes is USDC-side, and takes effect
with mainnet, when the program carries it. Until then the Rewards page shows
the ladder and the perk a rank will bring.

### Trading rank

By points, all time.

| Rank | Points | Fee discount at mainnet |
| --- | --- | --- |
| Trader | 0 | 0 percent |
| Regular | 10,000 | 2.5 percent |
| Desk | 100,000 | 5 percent |
| Whale | 1,000,000 | 7.5 percent |
| Titan | 10,000,000 | 10 percent |

The discount is off every open and close fee, on every market. It does not
stack with the referral discount or the deployer discount; the largest
applies.

### Referral rank

By active referees: wallets that took your code and have filled at least one
order. Referrals are one level deep; the program records only the direct
referrer.

| Rank | Active referees | Referral share at mainnet |
| --- | --- | --- |
| Referrer I | 0 | 10 percent |
| Referrer II | 5 | 15 percent |
| Referrer III | 20 | 20 percent |
| Referrer IV | 50 | 25 percent |

The share is of every fee a referee pays, in USDC, and comes out of the
protocol's cut as it does today. A referee's own discount stays at 10
percent whatever their referrer's rank.

## Quests and seasons

The Rewards page lists two kinds of quest for each ladder.

* **Rank quests** are the rungs themselves: earn the next threshold of
  points, or refer the next count of active traders.
* **Season quests** are the things the venue is for, done once: trade
  $1,000 and $10,000, take a referral code, refer a trader who trades, open
  a market, back one with $100, hold $1,000 in the pool. On the referral
  ladder: refer one and five traders who trade, $100,000 traded by your
  referrals, $10 earned from them.

Every quest is measured from the wallet's on-chain figures, so finishing one
is never something to submit or claim. What a finished season quest is worth
at mainnet is set before mainnet and not before; the page prints no number
that could later move.

Seasons are Devnet, which is running now, then Season 1 from mainnet, and
Seasons 2 and 3 after it. Devnet points and ranks are read at mainnet and
credited under rules set before then (see [Devnet](devnet.md)).

## Rules changelog

Rules change only going forward. Points already earned are never recounted,
and every change is listed here with the date it took effect.

| Version | From | Change |
| --- | --- | --- |
| v1 | Season 1 | The rules on this page. |
| v2 | 2026-09-30 | Ranks, quests and seasons added. Nothing about points changed. |
