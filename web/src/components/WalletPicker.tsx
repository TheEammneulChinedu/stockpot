"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useConnect, type Connector } from "wagmi";
import s from "./WalletPicker.module.css";

type Props = { open: boolean; onClose: () => void; onReopen?: () => void };

const isMobile = () => typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
/** How to get back to the browser after approving in the wallet app. */
const backHint = () => {
  if (typeof navigator === "undefined") return "come back here";
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) {
    const browser = /CriOS/i.test(ua) ? "Chrome" : /FxiOS/i.test(ua) ? "Firefox" : /EdgiOS/i.test(ua) ? "Edge" : "Safari";
    return `switch back to ${browser}`;
  }
  if (/Android/i.test(ua)) return "switch back to this browser";
  return "come back here";
};
const hasInjected = () => typeof window !== "undefined" && Boolean((window as { ethereum?: unknown }).ethereum);

/**
 * Sign-in choices. Browser wallets come first: they work everywhere, including networks where
 * coinbase.com (and so the Base Account sign-in window) is blocked.
 */
export function WalletPicker({ open, onClose, onReopen }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const { connectors, connectAsync, isPending, variables } = useConnect();
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [env, setEnv] = useState({ mobile: false, injected: false, url: "", back: "come back here" });

  useEffect(() => {
    setCopied(false);
    setEnv({ mobile: isMobile(), injected: hasInjected(), url: window.location.href, back: backHint() });
  }, [open]);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const { baseAccount, browserWallets, walletConnect } = useMemo(() => {
    const baseAccount = connectors.find((c) => c.id === "baseAccount");
    // Wallets that announce themselves (EIP-6963) appear by name; fall back to the generic one.
    const announced = connectors.filter((c) => c.type === "injected" && c.id !== "injected");
    const generic = connectors.find((c) => c.id === "injected");
    const browserWallets = announced.length > 0 ? announced : generic && env.injected ? [generic] : [];
    const walletConnect = connectors.find((c) => c.id === "walletConnect");
    return { baseAccount, browserWallets, walletConnect };
  }, [connectors, env.injected]);

  const pending = (c: Connector) =>
    Boolean(isPending && variables?.connector && "id" in variables.connector && variables.connector.id === c.id);

  async function pick(c: Connector) {
    setError("");
    // WalletConnect opens its own window with the wallet list; ours sits in the browser's top
    // layer and would cover it, so close ours first.
    if (c.id === "walletConnect") {
      onClose();
      // A tap here while an earlier attempt is still waiting (say the wallet was opened but never
      // approved, or the phone paused the page) starts over cleanly instead of hanging on the old one.
      if (pending(c)) {
        try {
          const provider = (await c.getProvider()) as { abortPairingAttempt?: () => void } | undefined;
          provider?.abortPairingAttempt?.();
        } catch {}
      }
    }
    try {
      await connectAsync({ connector: c });
      try {
        sessionStorage.removeItem("stockpot-reloaded");
      } catch {}
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      // The page was loaded from an older deploy and a code file it needs was replaced.
      // Reload once to pick up the current version instead of showing an error.
      if (/Loading chunk|ChunkLoadError|dynamically imported module/i.test(msg)) {
        try {
          if (!sessionStorage.getItem("stockpot-reloaded")) {
            sessionStorage.setItem("stockpot-reloaded", "1");
            window.location.reload();
            return;
          }
        } catch {}
        setError("Stockpot was just updated. Refresh the page and try again.");
        return;
      }
      if (c.id === "baseAccount") {
        setError(
          "The Base Account window didn't open. On some networks, including in Nigeria, coinbase.com is blocked. Use a browser wallet instead, or turn on a VPN and try again.",
        );
      } else if (c.id === "walletConnect" && /publish|relay|socket|network|fetch|timeout|timed out|offline/i.test(msg)) {
        // WalletConnect's relay servers are blocked or throttled on some networks, Nigeria included.
        setError(
          env.mobile
            ? "WalletConnect couldn't reach its servers. This happens on some networks, including in Nigeria. Use \u201cOpen in your wallet app\u201d above instead, or turn on a VPN and try again."
            : "WalletConnect couldn't reach its servers. This happens on some networks, including in Nigeria. Use a browser wallet instead, or turn on a VPN and try again.",
        );
        onReopen?.();
      } else if (!/reject|denied|cancel|abort/i.test(msg)) {
        setError(msg.split("\n")[0] || "That wallet didn't connect. Try again.");
        // Our window was closed to make room for WalletConnect's, so bring it back to show why.
        if (c.id === "walletConnect") onReopen?.();
      }
    }
  }

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
              <button key={c.uid} className={s.option} onClick={() => pick(c)} disabled={pending(c)}>
                {c.icon ? <img src={c.icon} alt="" className={s.icon} /> : <span className={s.iconFallback}>W</span>}
                <span className={s.text}>
                  <strong>{c.id === "injected" ? "Browser wallet" : c.name}</strong>
                  <span>{pending(c) ? "Check your wallet…" : "Works everywhere. You tap Pay each round."}</span>
                </span>
              </button>
            ))}
          </section>
        )}

        {env.mobile && browserWallets.length === 0 && (
          <section className={s.group} aria-label="Open in your wallet app">
            <button
              className={s.option}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(env.url);
                } catch {}
                setCopied(true);
              }}
            >
              <span className={`${s.iconFallback} ${s.app}`} aria-hidden>
                <svg viewBox="0 0 24 24" width="22" height="22">
                  <rect x="6" y="2.5" width="12" height="19" rx="3" fill="none" stroke="currentColor" strokeWidth="2" />
                  <path d="M10.5 18h3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </span>
              <span className={s.text}>
                <strong>Open in your wallet app</strong>
                <span>
                  {copied
                    ? "Link copied. In Trust Wallet, MetaMask, OKX or Bitget, tap the browser or search bar, paste it and go."
                    : "Most reliable. Tap to copy the link, then paste it into your wallet app\u2019s browser."}
                </span>
              </span>
            </button>
          </section>
        )}

        {walletConnect && !(env.mobile && browserWallets.length > 0) && (
          <section className={s.group} aria-label="Wallet apps">
            <button className={s.option} onClick={() => pick(walletConnect)}>
              <span className={s.iconFallback}>W</span>
              <span className={s.text}>
                <strong>{env.mobile ? "Trust Wallet, MetaMask & more" : "Phone wallet (scan a QR code)"}</strong>
                <span>
                  {pending(walletConnect)
                    ? "Waiting for your wallet. Tap to start again."
                    : env.mobile
                    ? `Pick your wallet app and approve. Then ${env.back}.`
                    : "Trust Wallet, MetaMask, OKX and more, via WalletConnect."}
                </span>
              </span>
            </button>
          </section>
        )}

        {browserWallets.length === 0 && env.mobile && !walletConnect && (
          <p className={s.note}>Open this page in your wallet app&apos;s browser to sign in.</p>
        )}

        {browserWallets.length === 0 && !env.mobile && !walletConnect && (
          <p className={s.note}>
            No browser wallet found. Install MetaMask, Rabby or OKX Wallet for your browser, then reload this page.
          </p>
        )}

        {baseAccount && (
          <section className={s.group} aria-label="Base Account">
            <button className={s.option} onClick={() => pick(baseAccount)} disabled={pending(baseAccount)}>
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
