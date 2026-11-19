"use client";

import { useEffect, useState } from "react";
import type { Address } from "viem";
import { fetchTokenizedStocks } from "./stocks";

/**
 * Ticker → B20 contract address. Prefers NEXT_PUBLIC_STOCKS (JSON set at deploy time, matching the
 * factory config), and fills gaps from the public Tokenized Stocks API.
 */
export function useStockAddresses() {
  const [map, setMap] = useState<Record<string, Address>>(() => {
    try {
      return JSON.parse(process.env.NEXT_PUBLIC_STOCKS ?? "{}");
    } catch {
      return {};
    }
  });

  useEffect(() => {
    const ctl = new AbortController();
    fetchTokenizedStocks(ctl.signal).then((list) => {
      if (!list.length) return;
      setMap((prev) => {
        const next = { ...prev };
        for (const s of list) {
          if (s.symbol && s.contract_address && !next[s.symbol]) next[s.symbol] = s.contract_address as Address;
        }
        return next;
      });
    });
    return () => ctl.abort();
  }, []);

  return map;
}
