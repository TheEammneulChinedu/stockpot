// Mirrors contracts/src/Pot.sol in dollar terms (constant price), for the homepage demo and previews.

export const LOCK_BUFFER = 1.25;

export type SimMember = {
  name: string;
  collected: boolean;
  payout: number; // $ of stock received at their turn
  locked: number; // $ still frozen as collateral
  lockRoundsLeft: number;
  free: number; // $ of stock withdrawable
  debt: number; // $ missed before collecting
  owedTo: { creditor: number; amount: number }[];
  creditUsdc: number; // $ repaid to them in USDC
  skipNext: boolean;
};

export type RoundEvent =
  | { kind: "paid"; member: number }
  | { kind: "skip-covered"; member: number; amount: number; shortfall: number }
  | { kind: "skip-debt"; member: number; amount: number }
  | { kind: "repaid"; member: number; creditor: number; amount: number }
  | { kind: "thaw"; member: number; amount: number };

export type RoundResult = {
  round: number;
  collector: number;
  swapped: number;
  inKind: number;
  payout: number;
  locked: number;
  free: number;
  events: RoundEvent[];
};

export function newMembers(names: string[]): SimMember[] {
  return names.map((name) => ({
    name,
    collected: false,
    payout: 0,
    locked: 0,
    lockRoundsLeft: 0,
    free: 0,
    debt: 0,
    owedTo: [],
    creditUsdc: 0,
    skipNext: false,
  }));
}

/** Lock for a collector in round r (0-based) of n with contribution c, capped at the payout. */
export function lockFor(r: number, n: number, c: number, payout = n * c) {
  const remaining = n - 1 - r;
  return Math.min(payout, remaining * c * LOCK_BUFFER);
}

/** Runs round r. Returns new member state (immutable) and what happened. */
export function runRound(
  prev: SimMember[],
  r: number,
  c: number,
): { members: SimMember[]; result: RoundResult } {
  const n = prev.length;
  const members = prev.map((m) => ({ ...m, owedTo: m.owedTo.map((d) => ({ ...d })) }));
  const events: RoundEvent[] = [];
  let paid = 0;
  let inKind = 0;

  members.forEach((m, i) => {
    if (!m.skipNext) {
      paid += c;
      events.push({ kind: "paid", member: i });
      if (m.collected && m.lockRoundsLeft > 0) {
        const amt = m.locked / m.lockRoundsLeft;
        m.locked -= amt;
        m.free += amt;
        m.lockRoundsLeft -= 1;
        events.push({ kind: "thaw", member: i, amount: amt });
      }
    } else if (i !== r) {
      if (m.collected) {
        const taken = Math.min(c, m.locked);
        m.locked -= taken;
        if (m.lockRoundsLeft > 0) m.lockRoundsLeft -= 1;
        inKind += taken;
        events.push({ kind: "skip-covered", member: i, amount: taken, shortfall: c - taken });
      } else {
        m.debt += c;
        m.owedTo.push({ creditor: r, amount: c });
        events.push({ kind: "skip-debt", member: i, amount: c });
      }
    }
    m.skipNext = false;
  });

  // collector repays anyone they shorted before taking their own payout
  const col = members[r];
  let available = paid;
  for (const d of col.owedTo) {
    const pay = Math.min(d.amount, available);
    if (pay <= 0) break;
    available -= pay;
    d.amount -= pay;
    col.debt -= pay;
    members[d.creditor].creditUsdc += pay;
    events.push({ kind: "repaid", member: r, creditor: d.creditor, amount: pay });
  }

  const payout = available + inKind;
  const locked = lockFor(r, n, c, payout);
  col.collected = true;
  col.payout = payout;
  col.locked += locked;
  col.lockRoundsLeft = n - 1 - r;
  col.free += payout - locked;

  if (r === n - 1) {
    members.forEach((m) => {
      m.free += m.locked;
      m.locked = 0;
      m.lockRoundsLeft = 0;
    });
  }

  return {
    members,
    result: { round: r, collector: r, swapped: available, inKind, payout, locked, free: payout - locked, events },
  };
}

export const money = (v: number) =>
  `$${v.toFixed(v % 1 === 0 ? 0 : 2)}`;
