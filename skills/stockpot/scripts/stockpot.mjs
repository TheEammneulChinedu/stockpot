#!/usr/bin/env node
// Stockpot for Bankr: run savings circles that pay out in tokenized stocks, from a chat.
// Every command prints ONE JSON object: {ok, report, txs?, link?, next?}. Scripts never sign:
// `txs` are unsigned {to, data, value, chainId} objects for Bankr's arbitrary-transaction flow,
// submitted one at a time in order. `ok:false` + exit code 1 means a gate failed (see gate/detail).
//
//   stockpot.mjs status --wallet 0x…                         my pots, what's due, what's claimable
//   stockpot.mjs pot    --pot 0x… [--wallet 0x…]             one pot in detail
//   stockpot.mjs create --wallet 0x… --name "…" --members 3 --usd 5 --stock NVDA --every weekly
//   stockpot.mjs join   --pot 0x… --wallet 0x…
//   stockpot.mjs pay    --pot 0x… --wallet 0x…
//   stockpot.mjs claim  --pot 0x… --wallet 0x…
//
// A pot can be given as its address or its share link (…/pot/?address=0x…).

import {
  FACTORY,
  USDC,
  STOCKS,
  LIMITS,
  RHYTHMS,
  STATUS,
  SEL,
  addrWord,
  uintWord,
  isAddress,
  encodeCreatePot,
  encodePredict,
  randomSalt,
  call,
  ethBalance,
  readUint,
  readAddr,
  readPot,
  stockMeta,
  usd,
  shares,
  link,
  sameAddr,
  when,
  tx,
  args,
  done,
  fail,
  revertReason,
} from "./lib.mjs";

const A = args(process.argv.slice(2));
const cmd = A._[0];
const MIN_GAS_WEI = 20_000_000_000_000n; // 0.00002 ETH: a few Base transactions

function needWallet() {
  if (!isAddress(A.wallet)) fail("input", "Pass the user's Bankr wallet as --wallet 0x… (their Base EVM address).");
  return A.wallet;
}

function needPot() {
  const raw = A.pot ?? "";
  const m = raw.match(/0x[0-9a-fA-F]{40}/);
  if (!m) fail("input", "Pass the pot as --pot 0x… or its share link.");
  return m[0];
}

async function gasNote(wallet) {
  const bal = await ethBalance(wallet).catch(() => null);
  return bal !== null && bal < MIN_GAS_WEI
    ? "Your wallet has almost no ETH on Base for fees; top up a little ETH (about $1) first."
    : null;
}

function seatLine(p, i, wallet) {
  const m = p.members[i];
  const you = wallet && sameAddr(m.account, wallet) ? " (you)" : "";
  const turn = `collects in round ${i + 1}`;
  const paid = p.status === 1 ? (p.paidFlags[i] ? ", paid this round" : ", not paid yet") : "";
  return `Seat ${i + 1}${you}: ${m.account.slice(0, 6)}…${m.account.slice(-4)}, ${turn}${paid}`;
}

function summary(p, wallet) {
  const s = stockMeta(p.stock);
  const seat = wallet ? p.members.findIndex((m) => sameAddr(m.account, wallet)) : -1;
  const lines = [`"${p.name}": ${usd(p.contribution)} a round from ${p.maxMembers} people, paid out in ${s.company} (${s.ticker}).`];
  if (p.status === 0) {
    lines.push(`Filling up: ${p.members.length} of ${p.maxMembers} seats taken. It starts by itself when the last seat fills.`);
  } else if (p.status === 1) {
    const collector = p.members[p.round];
    const paidCount = p.paidFlags.filter(Boolean).length;
    lines.push(
      `Round ${p.round + 1} of ${p.members.length}: ${paidCount} of ${p.members.length} paid. ` +
        `${seat === p.round ? "You collect" : `Seat ${p.round + 1} (${collector.account.slice(0, 6)}…) collects`} this round. ` +
        `Closes ${when(p.deadline)}; it settles as soon as everyone has paid.`,
    );
  } else {
    lines.push("Finished: everyone has collected once.");
  }
  if (seat >= 0) {
    const me = p.members[seat];
    if (p.status === 1 && !p.paidFlags[seat]) lines.push(`You haven't paid round ${p.round + 1} yet (${usd(p.contribution)}).`);
    if (me.claimableStock > 0n) lines.push(`You can withdraw ${shares(me.claimableStock)} ${s.ticker} now.`);
    if (me.locked > 0n) lines.push(`${shares(me.locked)} ${s.ticker} of yours is locked as a guarantee until you finish paying.`);
    if (me.debt > 0n) lines.push(`You owe ${usd(me.debt)} from missed rounds; it comes out of your payout.`);
  } else if (wallet) {
    lines.push(p.status === 0 && p.members.length < p.maxMembers ? "You're not in this pot yet; there's a free seat." : "You're not in this pot.");
  }
  return { lines, seat, stock: s };
}

async function loadPot(pot) {
  try {
    return await readPot(pot);
  } catch (e) {
    fail("pot", `Couldn't read a Stockpot pot at ${pot}. Check the link. (${revertReason(e)})`);
  }
}

async function status() {
  const wallet = needWallet();
  const count = Number(await readUint(FACTORY, SEL.potCount));
  const pots = await Promise.all(Array.from({ length: count }, (_, i) => readAddr(FACTORY, SEL.allPots + uintWord(i))));
  const seats = await Promise.all(pots.map((p) => readUint(p, SEL.indexPlusOne + addrWord(wallet))));
  const mine = pots.filter((_, i) => seats[i] > 0n).reverse();
  if (!mine.length) {
    return done({ ok: true, pots: [], report: "You're not in any Stockpot pots yet. Want to start one? Tell me the stock, amount per round, how many people and daily or weekly." });
  }
  const details = await Promise.all(mine.map(readPot));
  const report = [];
  const due = [];
  for (const p of details) {
    const { lines, seat } = summary(p, wallet);
    report.push(lines.join(" "), `Link: ${link(p.pot)}`);
    if (p.status === 1 && seat >= 0 && !p.paidFlags[seat]) due.push(p.pot);
  }
  done({
    ok: true,
    pots: details.map((p) => ({ pot: p.pot, name: p.name, status: STATUS[p.status], round: p.round + 1, link: link(p.pot) })),
    due,
    report: report.join("\n"),
    next: due.length ? `To pay: node scripts/stockpot.mjs pay --pot ${due[0]} --wallet ${wallet}` : undefined,
  });
}

async function pot() {
  const p = await loadPot(needPot());
  const wallet = isAddress(A.wallet) ? A.wallet : null;
  const { lines } = summary(p, wallet);
  const seats = p.members.map((_, i) => seatLine(p, i, wallet));
  done({ ok: true, pot: p.pot, status: STATUS[p.status], round: p.round + 1, link: link(p.pot), report: [...lines, ...seats, `Link: ${link(p.pot)}`].join("\n") });
}

async function create() {
  const wallet = needWallet();
  const name = String(A.name ?? "").trim();
  if (!name || Buffer.byteLength(name) > LIMITS.nameMax) fail("name", `Give the pot a name of 1–${LIMITS.nameMax} characters.`);
  const members = Number(A.members);
  if (!Number.isInteger(members) || members < LIMITS.minMembers || members > LIMITS.maxMembers)
    fail("members", `A pot has ${LIMITS.minMembers} to ${LIMITS.maxMembers} people (the creator counts as one).`);
  const amount = Number(A.usd);
  if (!(amount >= LIMITS.minUsd && amount <= LIMITS.maxUsd) || Math.round(amount * 100) !== amount * 100)
    fail("usd", `Each person pays $${LIMITS.minUsd}–$${LIMITS.maxUsd} a round (whole cents).`);
  const ALIASES = { NVDA: "NVDA", NVDAC: "NVDA", NVIDIA: "NVDA", AAPL: "AAPL", AAPLC: "AAPL", APPLE: "AAPL", META: "META", METAC: "META", FACEBOOK: "META", GOOGL: "GOOGL", GOOGLC: "GOOGL", GOOG: "GOOGL", GOOGLE: "GOOGL", ALPHABET: "GOOGL" };
  const stock = STOCKS[ALIASES[String(A.stock ?? "").toUpperCase().replace(/[^A-Z]/g, "")]];
  if (!stock) fail("stock", `Pots can pay out in ${Object.values(STOCKS).map((s) => s.company).join(", ")} for now.`);
  const every = String(A.every ?? "").toLowerCase();
  const interval = RHYTHMS[every];
  if (!interval) fail("every", "Choose daily or weekly rounds.");

  const params = { name, stock: stock.address, contribution: BigInt(Math.round(amount * 1e6)), maxMembers: members, interval };
  const salt = randomSalt();
  const data = encodeCreatePot(params, salt);

  // Dry run from the user's wallet: catches anything the factory would reject before spending gas.
  try {
    await call(FACTORY, data, wallet);
  } catch (e) {
    fail("simulate", `The factory would reject this pot: ${revertReason(e)}`);
  }
  const predicted = "0x" + (await call(FACTORY, encodePredict(wallet, params, salt))).slice(24, 64);
  const gas = await gasNote(wallet);
  done({
    ok: true,
    pot: predicted,
    link: link(predicted),
    confirm: `Start "${name}": ${members} people, $${amount} each per round (${every}), paying out in ${stock.company} stock? You take seat 1 and collect first. yes/no`,
    txs: [tx(FACTORY, data, `create pot "${name}"`)],
    report: [
      `Pot "${name}" will live at ${link(predicted)}.`,
      `Share that link: friends open it in their wallet app's browser, or ask me to join it. It starts by itself when all ${members} seats are taken; then everyone pays ${usd(params.contribution)} each round.`,
      gas,
    ]
      .filter(Boolean)
      .join("\n"),
    next: `After it mines: node scripts/stockpot.mjs pot --pot ${predicted} --wallet ${wallet}`,
  });
}

async function join() {
  const wallet = needWallet();
  const p = await loadPot(needPot());
  const s = stockMeta(p.stock);
  if (p.members.some((m) => sameAddr(m.account, wallet))) fail("member", "You're already in this pot.");
  if (p.status !== 0) fail("open", "This pot has already started, so it can't take new members.");
  if (p.members.length >= p.maxMembers) fail("full", "This pot is full.");
  const data = SEL.join;
  try {
    await call(p.pot, data, wallet);
  } catch (e) {
    fail("simulate", `Joining would fail: ${revertReason(e)}`);
  }
  const seat = p.members.length + 1;
  const gas = await gasNote(wallet);
  done({
    ok: true,
    link: link(p.pot),
    confirm: `Join "${p.name}"? You'd pay ${usd(p.contribution)} each round and collect the whole pot as ${s.company} stock in round ${seat}. Joining costs only a network fee. yes/no`,
    txs: [tx(p.pot, data, `join "${p.name}"`)],
    report: [
      `You'll take seat ${seat} of ${p.maxMembers}, so you collect in round ${seat}.`,
      seat === p.maxMembers ? "You're the last seat: the pot starts as soon as you join, and round 1 payments open." : `It starts when all ${p.maxMembers} seats are taken.`,
      gas,
    ]
      .filter(Boolean)
      .join(" "),
  });
}

async function pay() {
  const wallet = needWallet();
  const p = await loadPot(needPot());
  const seat = p.members.findIndex((m) => sameAddr(m.account, wallet));
  if (seat < 0) fail("member", "You're not a member of this pot.");
  if (p.status === 0) fail("active", `This pot hasn't started yet: ${p.members.length} of ${p.maxMembers} seats are taken.`);
  if (p.status === 2) fail("active", "This pot has finished; there's nothing left to pay.");
  if (p.paidFlags[seat]) fail("paid", `You've already paid round ${p.round + 1}. The next round opens once this one settles.`);

  const [balance, allowance] = await Promise.all([
    readUint(USDC, SEL.balanceOf + addrWord(wallet)),
    readUint(USDC, SEL.allowance + addrWord(wallet) + addrWord(p.pot)),
  ]);
  if (balance < p.contribution) fail("usdc", `You need ${usd(p.contribution)} USDC on Base; you have ${usd(balance)}.`);

  const txs = [];
  // Approve exactly one round's contribution, never more: the pot can only take what's due.
  if (allowance < p.contribution) txs.push(tx(USDC, SEL.approve + addrWord(p.pot) + uintWord(p.contribution), `allow the pot to take ${usd(p.contribution)} USDC`));
  txs.push(tx(p.pot, SEL.contribute, `pay round ${p.round + 1} of "${p.name}"`));
  if (txs.length === 1) {
    try {
      await call(p.pot, SEL.contribute, wallet);
    } catch (e) {
      fail("simulate", `Paying would fail: ${revertReason(e)}`);
    }
  }
  const others = p.paidFlags.filter((x, i) => !x && i !== seat).length;
  const gas = await gasNote(wallet);
  done({
    ok: true,
    link: link(p.pot),
    confirm: `Pay ${usd(p.contribution)} USDC for round ${p.round + 1} of "${p.name}"? yes/no`,
    txs,
    report: [
      others === 0
        ? "You're the last to pay: the round settles within minutes and the stock goes to this round's collector."
        : `${others} other member${others === 1 ? "" : "s"} still to pay this round.`,
      gas,
    ]
      .filter(Boolean)
      .join(" "),
  });
}

async function claim() {
  const wallet = needWallet();
  const p = await loadPot(needPot());
  const seat = p.members.findIndex((m) => sameAddr(m.account, wallet));
  if (seat < 0) fail("member", "You're not a member of this pot.");
  const me = p.members[seat];
  const s = stockMeta(p.stock);
  if (me.claimableStock === 0n && me.claimableUsdc === 0n) {
    fail("nothing", me.locked > 0n ? `Nothing to withdraw yet: ${shares(me.locked)} ${s.ticker} is locked until you finish paying, and unlocks a share each round you pay.` : "Nothing to withdraw right now. The Stockpot keeper also sends withdrawable stock to members automatically.");
  }
  try {
    await call(p.pot, SEL.claim, wallet);
  } catch (e) {
    fail("simulate", `Withdrawing would fail: ${revertReason(e)}`);
  }
  const parts = [me.claimableStock > 0n ? `${shares(me.claimableStock)} ${s.ticker}` : null, me.claimableUsdc > 0n ? `${usd(me.claimableUsdc)} USDC` : null].filter(Boolean).join(" and ");
  done({
    ok: true,
    link: link(p.pot),
    confirm: `Withdraw ${parts} from "${p.name}" to your wallet? yes/no`,
    txs: [tx(p.pot, SEL.claim, `withdraw from "${p.name}"`)],
    report: `${parts} will land in your wallet.`,
  });
}

const COMMANDS = { status, pot, create, join, pay, claim };
if (!COMMANDS[cmd]) fail("usage", `Commands: ${Object.keys(COMMANDS).join(", ")}. See the header of scripts/stockpot.mjs.`);
COMMANDS[cmd]().catch((e) => fail("error", String(e?.message || e).slice(0, 300)));
