"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useConnect, type Connector } from "wagmi";
import s from "./WalletPicker.module.css";

type Props = { open: boolean; onClose: () => void };

const isMobile = () => typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
const hasInjected = () => typeof window !== "undefined" && Boolean((window as { ethereum?: unknown }).ethereum);

/**
 * Sign-in choices. Browser wallets come first: they work everywhere, including networks where
 * coinbase.com (and so the Base Account sign-in window) is blocked.
 */
export function WalletPicker({ open, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const { connectors, connectAsync, isPending, variables } = useConnect();
  const [error, setError] = useState("");
  const [env, setEnv] = useState({ mobile: false, injected: false, url: "" });

  useEffect(() => {
    setEnv({ mobile: isMobile(), injected: hasInjected(), url: window.location.href });
  }, [open]);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const { baseAccount, browserWallets } = useMemo(() => {
    const baseAccount = connectors.find((c) => c.id === "baseAccount");
    // Wallets that announce themselves (EIP-6963) appear by name; fall back to the generic one.
    const announced = connectors.filter((c) => c.type === "injected" && c.id !== "injected");
    const generic = connectors.find((c) => c.id === "injected");
    const browserWallets = announced.length > 0 ? announced : generic && env.injected ? [generic] : [];
    return { baseAccount, browserWallets };
  }, [connectors, env.injected]);

  async function pick(c: Connector) {
    setError("");
    try {
      await connectAsync({ connector: c });
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (c.id === "baseAccount") {
        setError(
          "The Base Account window didn't open. On some networks, including in Nigeria, coinbase.com is blocked. Use a browser wallet instead, or turn on a VPN and try again.",
        );
      } else if (!/reject|denied|cancel/i.test(msg)) {
        setError(msg.split("\n")[0] || "That wallet didn't connect. Try again.");
      }
    }
  }

  const host = env.url.replace(/^https?:\/\//, "");
  const pending = (c: Connector) => isPending && variables?.connector && "id" in variables.connector && variables.connector.id === c.id;

  return (
    <dialog ref={ref} className={s.dialog} onClose={onClose} onClick={(e) => e.target === ref.current && onClose()}>
      <div className={s.body}>
        <div className={s.head}>
          <h2>Sign in to Stockpot</h2>
          <button className={s.close} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {browserWallets.length > 0 && (
          <section className={s.group} aria-label="Browser wallets">
            {browserWallets.map((c) => (
              <button key={c.uid} className={s.option} onClick={() => pick(c)} disabled={isPending}>
                {c.icon ? <img src={c.icon} alt="" className={s.icon} /> : <span className={s.iconFallback}>W</span>}
                <span className={s.text}>
                  <strong>{c.id === "injected" ? "Browser wallet" : c.name}</strong>
                  <span>{pending(c) ? "Check your wallet…" : "Works everywhere. You tap Pay each round."}</span>
                </span>
              </button>
            ))}
          </section>
        )}

        {browserWallets.length === 0 && env.mobile && (
          <section className={s.group} aria-label="Open in a wallet app">
            <p className={s.note}>Open Stockpot inside your wallet app to sign in:</p>
            <a className={s.option} href={`https://link.trustwallet.com/open_url?coin_id=60&url=${encodeURIComponent(env.url)}`}>
              <span className={s.iconFallback}>T</span>
              <span className={s.text}>
                <strong>Open in Trust Wallet</strong>
                <span>Opens this page in Trust Wallet&apos;s browser</span>
              </span>
            </a>
            <a className={s.option} href={`https://metamask.app.link/dapp/${host}`}>
              <span className={s.iconFallback}>M</span>
              <span className={s.text}>
                <strong>Open in MetaMask</strong>
                <span>Opens this page in MetaMask&apos;s browser</span>
              </span>
            </a>
          </section>
        )}

        {browserWallets.length === 0 && !env.mobile && (
          <p className={s.note}>
            No browser wallet found. Install MetaMask, Rabby or OKX Wallet for your browser, then reload this page.
          </p>
        )}

        {baseAccount && (
          <section className={s.group} aria-label="Base Account">
            <button className={s.option} onClick={() => pick(baseAccount)} disabled={isPending}>
              <span className={`${s.iconFallback} ${s.base}`}>B</span>
              <span className={s.text}>
                <strong>Base Account</strong>
                <span>{pending(baseAccount) ? "Opening…" : "Email or passkey. Adds auto-pay. Needs coinbase.com to load."}</span>
              </span>
            </button>
          </section>
        )}

        {error && <p className={s.error}>{error}</p>}
      </div>
    </dialog>
  );
}
