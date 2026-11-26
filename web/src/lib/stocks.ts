// Launch stocks. Token addresses come from the Tokenized Stocks API at runtime / deploy time;
// always match by contract address, never by ticker (docs.base.org list-tokenized-stocks).

export type StockMeta = { ticker: string; company: string; underlying: string };

export const LAUNCH_STOCKS: StockMeta[] = [
  { ticker: "NVDAc", company: "NVIDIA", underlying: "NVDA" },
  { ticker: "AAPLc", company: "Apple", underlying: "AAPL" },
  { ticker: "TSLAc", company: "Tesla", underlying: "TSLA" },
  { ticker: "MSFTc", company: "Microsoft", underlying: "MSFT" },
  { ticker: "METAc", company: "Meta", underlying: "META" },
  { ticker: "AMZNc", company: "Amazon", underlying: "AMZN" },
  { ticker: "GOOGLc", company: "Alphabet", underlying: "GOOGL" },
];

/**
 * Stocks a pot can actually settle in today: the keeper buys on Aerodrome, which has USDC pools for
 * these four. Add a ticker here only once its pool is added to the keeper's AERO_TICK_SPACING too.
 */
export const PAYOUT_STOCKS = new Set(["NVDAc", "AAPLc", "METAc", "GOOGLc"]);
export const PAYOUT_CHOICES: StockMeta[] = LAUNCH_STOCKS.filter((s) => PAYOUT_STOCKS.has(s.ticker));

export const TOKENIZED_STOCKS_API = "https://api.coinbase.com/v1/tokenized-stocks";

export type ApiStock = {
  symbol?: string;
  name?: string;
  contract_address?: string;
  nav_price?: string | number;
  nav_price_updated_at?: string;
};

/** Fetches the live list (no API key). Returns [] if unavailable; callers fall back to LAUNCH_STOCKS. */
export async function fetchTokenizedStocks(signal?: AbortSignal): Promise<ApiStock[]> {
  try {
    const res = await fetch(`${TOKENIZED_STOCKS_API}?page_size=500`, { signal });
    if (!res.ok) return [];
    const data = await res.json();
    const list = (data.tokens ?? data.tokenized_stocks ?? data.data ?? []) as ApiStock[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}
