import type { Address } from "viem";

// Only multicall is needed; typed loosely so any chain-specific client fits.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Reader = { multicall: (args: any) => Promise<{ result?: unknown }[]> };

/**
 * Today's move for each stock, from Chainlink's own round history on Base (no API, no key).
 * "Today" means since the start of the latest US session: the change is measured against the last
 * price before that session opened (the previous close), and a few rounds in between draw the
 * sparkline. Holidays are not accounted for.
 */

export const feedAbi = [
  {
    type: "function",
    name: "latestRoundData",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
  },
  {
    type: "function",
    name: "getRoundData",
    stateMutability: "view",
    inputs: [{ name: "_roundId", type: "uint80" }],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
  },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
] as const;

type Round = readonly [bigint, bigint, bigint, bigint, bigint];

const NY = "America/New_York";

/** Offset of New York from UTC at instant t, in ms (negative: -4h or -5h). */
function nyOffset(t: number) {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: NY,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hourCycle: "h23",
  }).formatToParts(new Date(t));
  const g = (k: string) => Number(p.find((x) => x.type === k)?.value);
  return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second")) - Math.floor(t / 1000) * 1000;
}

/** Unix seconds of the most recent weekday 9:30am New York time at or before `now`. */
export function sessionStart(now = Date.now()) {
  for (let back = 0; back < 8; back++) {
    const day = new Date(now - back * 86_400_000);
    const p = new Intl.DateTimeFormat("en-US", {
      timeZone: NY,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      weekday: "short",
    }).formatToParts(day);
    const g = (k: string) => p.find((x) => x.type === k)?.value ?? "";
    if (g("weekday") === "Sat" || g("weekday") === "Sun") continue;
    const guess = Date.UTC(Number(g("year")), Number(g("month")) - 1, Number(g("day")), 9, 30);
    const open = guess - nyOffset(guess);
    if (open <= now) return Math.floor(open / 1000);
  }
  return Math.floor(now / 1000) - 86_400;
}

export type DayMove = { prevClose: number; series: number[] };

const MASK = (1n << 64n) - 1n;
const POINTS = 28;

/** Previous close and an intraday series for each feed (raw feed units, divided by decimals). */
export async function loadDayMoves(client: Reader, feeds: Address[], start: number): Promise<(DayMove | null)[]> {
  const latest = await client.multicall({
    contracts: feeds.flatMap((f) => [
      { address: f, abi: feedAbi, functionName: "latestRoundData" } as const,
      { address: f, abi: feedAbi, functionName: "decimals" } as const,
    ]),
    allowFailure: true,
  });

  const info = feeds.map((_, i) => {
    const r = latest[i * 2]?.result as Round | undefined;
    const d = latest[i * 2 + 1]?.result as number | undefined;
    if (!r || d == null) return null;
    return { phase: r[0] >> 64n, agg: r[0] & MASK, answer: r[1], updatedAt: Number(r[3]), scale: 10 ** d };
  });

  const id = (phase: bigint, agg: bigint) => (phase << 64n) | agg;
  const getRound = (f: Address, roundId: bigint) =>
    ({ address: f, abi: feedAbi, functionName: "getRoundData", args: [roundId] }) as const;

  // Binary search, all feeds together: the last round in this phase updated before the session opened.
  const lo = info.map(() => 1n);
  const hi = info.map((x) => (x ? (x.updatedAt < start ? x.agg : x.agg + 1n) : 0n));
  // If nothing has updated since the open, the latest round is the reference.
  for (let i = 0; i < info.length; i++) if (info[i] && info[i]!.updatedAt < start) lo[i] = info[i]!.agg;

  for (let step = 0; step < 64; step++) {
    const active = info
      .map((x, i) => (x && hi[i] - lo[i] > 1n ? i : -1))
      .filter((i) => i >= 0);
    if (!active.length) break;
    const mids = active.map((i) => (lo[i] + hi[i]) / 2n);
    const res = await client.multicall({
      contracts: active.map((i, k) => getRound(feeds[i], id(info[i]!.phase, mids[k]))),
      allowFailure: true,
    });
    active.forEach((i, k) => {
      const r = res[k]?.result as Round | undefined;
      if (r && Number(r[3]) > 0 && Number(r[3]) < start) lo[i] = mids[k];
      else hi[i] = mids[k];
    });
  }

  // Sample rounds from the reference to now for the sparkline.
  const plan = info.map((x, i) => {
    if (!x) return [] as bigint[];
    const from = lo[i];
    const span = x.agg - from;
    const n = span < BigInt(POINTS) ? Number(span) : POINTS;
    const out: bigint[] = [from];
    for (let k = 1; k < n; k++) out.push(from + (span * BigInt(k)) / BigInt(n));
    return out;
  });
  const flat = plan.flatMap((rounds, i) => rounds.map((r) => getRound(feeds[i], id(info[i]!.phase, r))));
  const samples = flat.length ? await client.multicall({ contracts: flat, allowFailure: true }) : [];

  let cursor = 0;
  return info.map((x, i) => {
    const got = plan[i].map(() => samples[cursor++]?.result as Round | undefined);
    if (!x) return null;
    const ref = got[0];
    const prevClose = ref && ref[1] > 0n ? Number(ref[1]) / x.scale : Number(x.answer) / x.scale;
    const series = got.filter((r): r is Round => Boolean(r && r[1] > 0n)).map((r) => Number(r[1]) / x.scale);
    series.push(Number(x.answer) / x.scale);
    return { prevClose, series };
  });
}
