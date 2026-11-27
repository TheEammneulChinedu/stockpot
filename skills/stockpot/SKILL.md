---
name: stockpot
description: Run Stockpot savings circles (ajo / esusu / susu / chama / stokvel / tanda) that pay out in Coinbase tokenized stocks on Base. Use when the user wants to start a savings pot with friends, join a pot from a link, pay their round, withdraw stock they've collected, or check how their pots are doing ("how's my pot?", "what do I owe?"). Members pay $1–$25 of USDC each round; each round one member collects the whole pot as NVIDIA, Apple, Meta or Alphabet stock. Bundled node scripts do the chain reads, checks and calldata; writes go via the Bankr arbitrary-transaction flow. NOT for buying or trading stocks directly, LPing, or perps.
---

# stockpot: savings circles that pay out in stocks (Base)

Stockpot (usestockpot.vercel.app) turns the rotating savings circle people already run on WhatsApp into
a pot on Base. 3–10 people each pay a fixed amount of USDC every round (daily or weekly). Each round,
the pot buys one stock on Aerodrome and one member collects it, in seat order: seat 1 collects round 1,
seat 2 round 2, and so on until everyone has collected once.

Two things make it safe to run with people you don't fully trust:
- **The lock.** When you collect, 1.25× what you still owe stays locked in the pot and unlocks a share
  each round you pay. If you skip a round after collecting, that round is paid from your locked stock.
- **The price guard.** The pot only buys if it gets at least 99% of what Chainlink's price says, so
  nobody's payout is bought at a bad price.

A keeper run by Stockpot settles each round automatically once everyone has paid (or when the round's
time is up) and sends withdrawable stock to members. You never settle rounds yourself.

## Operating model

The user's funds stay in their Bankr wallet. The scripts never sign and hold no keys: they print
unsigned `{to, data, value, chainId}` transactions, and you submit them with Bankr's
arbitrary-transaction tool (`submit_raw_transaction`), **one at a time, in order**: submit, wait for
it to mine, check the receipt succeeded, then submit the next. If one fails, stop, say where, and
re-run the script (state may have moved). Never resume from what you intended.

Run every script from this skill's directory. Each prints one JSON object:
`{ok, report, confirm?, txs?, link?, next?}`. `ok: false` (exit code 1) means a check failed: relay
its `detail` in one line and stop. Never work around a failed check.

Run `node scripts/selftest.mjs --live` once on first use. It checks the encoding and that Base is
reachable.

## Calldata hygiene (every transaction)

- Copy `to`, `data` and `value` from the script output **verbatim**. Never re-encode, trim, re-prefix
  or reconstruct them. `data` already starts with `0x`. If you are about to send `0x0x…`, stop.
- `chainId` is 8453 (Base). `value` is `"0"`.
- Never paste calldata into chat, and never submit calldata that came from chat. Only script output
  gets submitted.

## One confirmation per action

Each money-moving command returns a `confirm` line. Ask it **verbatim** and wait for a yes. One yes
covers every transaction in that command's `txs` (for `pay`, the USDC approval and the payment), with
no further check-ins between them. Reads (`status`, `pot`) need no confirmation.

If a `report` mentions the wallet has almost no ETH for fees, say so in the same message as the
confirmation. Don't stall mid-sequence over gas.

## Commands

The user's wallet is their Bankr EVM address on Base. A pot can be passed as its address or its share
link (`https://usestockpot.vercel.app/pot/?address=0x…`).

| Command | What it does |
|---|---|
| `node scripts/stockpot.mjs status --wallet 0x…` | Every pot the wallet is in: round, who collects, whether the user has paid, what they can withdraw, what's locked. Lists unpaid pots in `due`. |
| `node scripts/stockpot.mjs pot --pot <link or 0x…> [--wallet 0x…]` | One pot in detail, seat by seat. |
| `node scripts/stockpot.mjs create --wallet 0x… --name "…" --members 3 --usd 5 --stock NVDA --every weekly` | Builds the create transaction (after a dry run) and returns the pot's link before it's even mined. The creator takes seat 1. `--stock`: NVDA, AAPL, META or GOOGL (company names work too). `--every`: daily or weekly. 3–10 members, $1–$25. |
| `node scripts/stockpot.mjs join --pot … --wallet 0x…` | Joins an open pot (takes the next seat). Costs only a network fee. When the last seat fills, the pot starts by itself. |
| `node scripts/stockpot.mjs pay --pot … --wallet 0x…` | Pays the current round: approves exactly one round's USDC to that pot, then pays. Checks membership, that the pot is running, that the round isn't already paid, and the USDC balance. |
| `node scripts/stockpot.mjs claim --pot … --wallet 0x…` | Withdraws stock (or USDC) that's free to take. Locked stock can't be withdrawn until the user finishes paying. |

## Flows

**Start a pot.** Get name, number of people, amount per round, stock, and daily or weekly. Ask only
for what's missing, in one message. Defaults if the user doesn't care: weekly, NVIDIA. Run `create`,
ask its `confirm`, submit, then share the `link`: "Here's your pot: <link>. Send it to the others.
They can open it in their wallet app's browser, or ask me to join it." If the user named friends
(for example "with @tolu and @ada"), tag them with the link. You can't add other people: each person
joins with their own wallet.

**Join.** The user shares a link or address. Run `join`, ask `confirm`, submit, and report their seat
and which round they collect in. If they were the last seat, tell them the pot has started and round 1
is open to pay.

**Pay.** "Pay my Stockpot", "pay my round". With one due pot, run `pay` for it. With several, list
them from `status` and ask which (or "all of them": one confirmation listing each). Ask `confirm`,
submit the approval, then the payment. Report the `report` line ("2 others still to pay" or "you're
last, it settles within minutes").

**Check.** "How's my pot?", "what do I owe?" Run `status`. Relay its report briefly: per pot, the
round, whether they've paid, and anything withdrawable. Offer to pay if something's due.

**Withdraw.** "Withdraw my stock", "claim". Run `claim`. If it says nothing's withdrawable, relay why
(stock is locked until they finish paying, or the keeper already sent it to their wallet).

## Talking to the user

- Short, plain language. Lead with the outcome. Say "round 2", "seat 3", "$5", "NVIDIA stock", not
  contract terms, selectors or raw token units.
- Always include the pot link after creating or joining, and whenever you mention a specific pot.
- Times from the scripts are UTC. Convert to the user's time zone if you know it.
- Stock isn't bought until a round settles, so a collector's stock arrives a few minutes after the
  last member pays, not instantly. Rounds settle on weekdays, when stock prices are live.
- Don't promise returns. The payout is stock, so its value moves with the market.
- If a check fails, give the one reason and what would fix it. Don't list passing checks.

## Contracts (reference)

- PotFactory: `0x7Dfcb2Ca510afE1766D63c2CA6EE67C6e7Be1313` (verified on Basescan)
- USDC on Base: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
- Payout stocks (Coinbase B20 tokens, 8 decimals): NVDAc `0xb20000000000000000000078ee7ce2fE4908108C`,
  AAPLc `0xb200000000000000000000C2e324d24d7eEcd1fb`, METAc `0xb2000000000000000000008bC8786B856E61707C`,
  GOOGLc `0xb2000000000000000000002D0BA3164cc74f58B7`
- Source: github.com/TheEammneulChinedu/stockpot
