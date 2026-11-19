"use client";

import { useAccount, useConnect, useDisconnect } from "wagmi";

export function ConnectButton({ label = "Sign in" }: { label?: string }) {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();

  if (isConnected && address) {
    return (
      <button className="btn btn-ghost" style={{ minHeight: 40 }} onClick={() => disconnect()} title="Sign out">
        {address.slice(0, 6)}…{address.slice(-4)}
      </button>
    );
  }
  const base = connectors.find((c) => c.id === "baseAccount") ?? connectors[0];
  return (
    <button
      className="btn btn-ghost"
      style={{ minHeight: 40 }}
      disabled={isPending || !base}
      onClick={() => base && connect({ connector: base })}
    >
      {isPending ? "Opening…" : label}
    </button>
  );
}
