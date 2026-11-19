import Link from "next/link";
import { Wordmark } from "./Logo";

export function SiteFooter() {
  return (
    <footer style={{ borderTop: "1px solid var(--line)", padding: "40px 0 56px", fontSize: "var(--t-xs)", color: "var(--harbor-2)" }}>
      <div className="wrap" style={{ display: "grid", gap: 18 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 24, alignItems: "center", justifyContent: "space-between" }}>
          <Wordmark />
          <div style={{ display: "flex", gap: 22 }}>
            <Link href="/start">Start a pot</Link>
            <Link href="/stats">Live stats</Link>
            <a href="https://github.com/" target="_blank" rel="noreferrer">
              Source code
            </a>
          </div>
        </div>
        <p style={{ maxWidth: 780 }}>
          Stockpot is non-custodial software on Base, built in public for Base Stocks Maxxing Season. It is not
          affiliated with or endorsed by Base, Coinbase or any company whose stock is referenced. Coinbase tokenized
          stocks are available only to eligible persons outside the United States, carry no voting rights, and can
          lose value. Nothing here is investment advice.
        </p>
      </div>
    </footer>
  );
}
