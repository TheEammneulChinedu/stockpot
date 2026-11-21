"use client";

import { useAccount, useSwitchChain } from "wagmi";
import { base } from "wagmi/chains";

/**
 * Which wallet the member signed in with, and a helper that moves their wallet onto Base before
 * any transaction. Base Account is always on Base; browser wallets (MetaMask, Trust, Rabby, OKX…)
 * may be sitting on another network.
 */
export function useWallet() {
  const { connector, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const isBaseAccount = connector?.id === "baseAccount";

  async function ensureBase() {
    if (chainId !== base.id) await switchChainAsync({ chainId: base.id });
  }

  return { isBaseAccount, walletName: connector?.name ?? "", ensureBase };
}
