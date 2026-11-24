"use client";

import { useState } from "react";
import { useAccount, useDisconnect } from "wagmi";
import { WalletPicker } from "./WalletPicker";

export function ConnectButton({ label = "Sign in" }: { label?: string }) {
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const [open, setOpen] = useState(false);

  if (isConnected && address) {
    return (
      <button
        className="btn btn-ghost"
        style={{ minHeight: 40, whiteSpace: "nowrap" }}
        onClick={() => disconnect()}
        title="Sign out"
      >
        {address.slice(0, 4)}…{address.slice(-4)}
      </button>
    );
  }
  return (
    <>
      <button className="btn btn-ghost" style={{ minHeight: 40 }} onClick={() => setOpen(true)}>
        {label}
      </button>
      <WalletPicker open={open} onClose={() => setOpen(false)} onReopen={() => setOpen(true)} />
    </>
  );
}
