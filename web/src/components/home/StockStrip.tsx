"use client";

import { useEffect, useState } from "react";
import { fetchTokenizedStocks, LAUNCH_STOCKS, type ApiStock } from "@/lib/stocks";
import s from "./StockStrip.module.css";

/** Launch stocks, with Coinbase's reference NAV when the public API is reachable from the browser. */
export function StockStrip() {
  const [live, setLive] = useState<ApiStock[]>([]);

  useEffect(() => {
    const ctl = new AbortController();
    fetchTokenizedStocks(ctl.signal).then(setLive);
    return () => ctl.abort();
  }, []);

  const nav = (ticker: string) => {
    const hit = live.find((x) => x.symbol?.toUpperCase() === ticker.toUpperCase());
    const v = hit?.nav_price != null ? Number(hit.nav_price) : NaN;
    return Number.isFinite(v) ? `$${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : null;
  };

  return (
    <section className={s.section} aria-labelledby="stocks-title">
      <div className={`wrap ${s.row}`}>
        <h2 id="stocks-title" className={s.title}>
          Pots pay out in real, 1:1 backed shares issued by Coinbase on Base
        </h2>
        <ul className={s.list}>
          {LAUNCH_STOCKS.map((st) => {
            const price = nav(st.ticker);
            return (
              <li key={st.ticker} className={s.item}>
                <span className={s.company}>{st.company}</span>
                <span className={s.ticker}>{st.ticker}</span>
                {price && <span className={s.price}>{price}</span>}
              </li>
            );
          })}
        </ul>
        <p className={s.note}>
          {live.length > 0
            ? `Prices are Coinbase reference values per token, not live quotes. ${live.length} tokenized stocks are listed today.`
            : "More stocks are being added. Each pot picks one when it starts."}
        </p>
      </div>
    </section>
  );
}
