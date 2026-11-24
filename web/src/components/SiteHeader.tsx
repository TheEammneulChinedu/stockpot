"use client";

import Link from "next/link";
import { useAccount } from "wagmi";
import { ConnectButton } from "./ConnectButton";
import { Wordmark } from "./Logo";
import s from "./SiteHeader.module.css";

export function SiteHeader() {
  const { isConnected } = useAccount();
  return (
    <header className={s.header}>
      <div className={`wrap ${s.row}`}>
        <Link href="/" className={s.brand} aria-label="Stockpot home">
          <Wordmark />
        </Link>
        <nav className={s.nav} aria-label="Main">
          <Link href="/#how">How it works</Link>
          <Link href="/stats">Live stats</Link>
          {isConnected && (
            <Link href="/pots" className={s.mine}>
              My pots
            </Link>
          )}
          <Link href="/start" className={`${s.start} ${isConnected ? s.hideOnPhone : ""}`}>
            Start a pot
          </Link>
          <ConnectButton />
        </nav>
      </div>
    </header>
  );
}
