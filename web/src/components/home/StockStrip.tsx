"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useReadContracts } from "wagmi";
import type { Address } from "viem";
import { LAUNCH_STOCKS } from "@/lib/stocks";
import s from "./StockStrip.module.css";

/**
 * Live prices for the launch stocks, read straight from the Chainlink feeds on Base that Stockpot's
 * contracts settle against. No API key, and nothing that depends on coinbase.com, so it works in
 * every country. Price per token = feed price per share x the token's B20 multiplier.
 */

// Chainlink equity feeds on Base (same addresses the factory was configured with).
const FEEDS: Record<string, Address> = {
  AAPLc: "0x787f13dEa48Db0897CbCDD985de77809D837F988",
  AMZNc: "0x06A8E4b3aBB3B7543d8396FB2B763d22820cB295",
  GOOGLc: "0x5bF49E0ffA937CE2FfF033c739aD7C634c4D34F2",
  METAc: "0x6526aE6797A76123638b863AeE4dD27Ba4E4b27D",
  MSFTc: "0xeB10A6c9aa7E537aEd766C08c35Dae35B321b18c",
  NVDAc: "0x04689a41629776563E6822F76f2e57D148d28513",
  TSLAc: "0xFaf869185383a24F8cb00e27BdA6b63B9905DCb4",
};

const TOKENS: Record<string, Address> = {
  NVDAc: "0xb20000000000000000000078ee7ce2fE4908108C",
  AAPLc: "0xb200000000000000000000C2e324d24d7eEcd1fb",
  TSLAc: "0xb2000000000000000000001e800a7f5189430cD0",
  MSFTc: "0xB200000000000000000000Ab99cFa739E253872B",
  AMZNc: "0xb200000000000000000000d9192b6B456483C2E8",
  GOOGLc: "0xb2000000000000000000002D0BA3164cc74f58B7",
  METAc: "0xb2000000000000000000008bC8786B856E61707C",
};

const feedAbi = [
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
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
] as const;

const multiplierAbi = [
  { type: "function", name: "multiplier", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;

/** Regular US trading hours (9:30 to 16:00 New York time, Monday to Friday). Holidays not included. */
function usMarketOpen(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  if (get("weekday") === "Sat" || get("weekday") === "Sun") return false;
  const mins = Number(get("hour")) * 60 + Number(get("minute"));
  return mins >= 9 * 60 + 30 && mins < 16 * 60;
}

function ago(seconds: number) {
  if (seconds < 90) return "just now";
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

const usd = (v: number) =>
  `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const stocks = LAUNCH_STOCKS.filter((st) => FEEDS[st.ticker] && TOKENS[st.ticker]);

const contracts = stocks.flatMap((st) => [
    { address: FEEDS[st.ticker], abi: feedAbi, functionName: "latestRoundData" } as const,
    { address: FEEDS[st.ticker], abi: feedAbi, functionName: "decimals" } as const,
    { address: TOKENS[st.ticker], abi: multiplierAbi, functionName: "multiplier" } as const,
]);

export function StockStrip() {
  const { data } = useReadContracts({
    contracts,
    allowFailure: true,
    query: { refetchInterval: 30_000, refetchOnWindowFocus: true },
  });

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const prices = useMemo(() => {
    const out: Record<string, { price: number; updatedAt: number } | undefined> = {};
    stocks.forEach((st, i) => {
      const round = data?.[i * 3]?.result as readonly [bigint, bigint, bigint, bigint, bigint] | undefined;
      const dec = data?.[i * 3 + 1]?.result as number | undefined;
      const mult = data?.[i * 3 + 2]?.result as bigint | undefined;
      if (!round || dec == null || round[1] <= 0n) return;
      // Missing multiplier means 1:1 with the share.
      const m = mult && mult > 0n ? Number(mult) / 1e18 : 1;
      out[st.ticker] = { price: (Number(round[1]) / 10 ** dec) * m, updatedAt: Number(round[3]) };
    });
    return out;
  }, [data]);

  // Briefly highlight a price when it moves, so the strip reads as live.
  const last = useRef<Record<string, number>>({});
  const [moved, setMoved] = useState<Record<string, "up" | "down">>({});
  useEffect(() => {
    const next: Record<string, "up" | "down"> = {};
    for (const [t, p] of Object.entries(prices)) {
      const prev = last.current[t];
      if (p && prev != null && p.price !== prev) next[t] = p.price > prev ? "up" : "down";
      if (p) last.current[t] = p.price;
    }
    if (Object.keys(next).length) {
      setMoved(next);
      const t = setTimeout(() => setMoved({}), 1600);
      return () => clearTimeout(t);
    }
  }, [prices]);

  const open = usMarketOpen(new Date(now));
  const newest = Math.max(0, ...Object.values(prices).map((p) => p?.updatedAt ?? 0));
  const haveAny = newest > 0;

  return (
    <section className={s.section} aria-labelledby="stocks-title">
      <div className={`wrap ${s.row}`}>
        <div className={s.head}>
          <h2 id="stocks-title" className={s.title}>
            Pots pay out in real, 1:1 backed shares issued by Coinbase on Base
          </h2>
          {haveAny && (
            <p className={s.status} role="status">
              <span className={open ? s.dotLive : s.dotClosed} aria-hidden />
              {open ? "US market open" : "US market closed"}
            </p>
          )}
        </div>
        <ul className={s.list}>
          {stocks.map((st) => {
            const p = prices[st.ticker];
            const dir = moved[st.ticker];
            return (
              <li key={st.ticker} className={s.item}>
                <span className={s.company}>{st.company}</span>
                <span className={s.ticker}>{st.ticker}</span>
                <span
                  className={`${s.price} ${dir === "up" ? s.up : dir === "down" ? s.down : ""}`}
                  aria-live="polite"
                >
                  {p ? usd(p.price) : <span className={s.loading}>loading</span>}
                </span>
              </li>
            );
          })}
        </ul>
        <p className={s.note}>
          {haveAny
            ? open
              ? `Live prices per token from the Chainlink feeds pots settle against. Last update ${ago(now / 1000 - newest)}.`
              : `Prices per token from the Chainlink feeds pots settle against, as of the last trading session (${ago(now / 1000 - newest)}). Pots settle when the market reopens.`
            : "Prices per token from the Chainlink feeds pots settle against."}
        </p>
      </div>
    </section>
  );
}
