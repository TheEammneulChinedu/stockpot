"use client";

import Link from "next/link";
import { ConnectButton } from "./ConnectButton";
import { Wordmark } from "./Logo";
import s from "./SiteHeader.module.css";

export function SiteHeader() {
  return (
    <header className={s.header}>
      <div className={`wrap ${s.row}`}>
        <Link href="/" className={s.brand} aria-label="Stockpot home">
          <Wordmark />
        </Link>
        <nav className={s.nav} aria-label="Main">
          <Link href="/#how">How it works</Link>
          <Link href="/stats">Live stats</Link>
          <Link href="/start" className={s.start}>
            Start a pot
          </Link>
          <ConnectButton />
        </nav>
      </div>
    </header>
  );
}
