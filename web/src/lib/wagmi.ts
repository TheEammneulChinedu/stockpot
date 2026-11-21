import { createConfig, http } from "wagmi";
import { base } from "wagmi/chains";
import { baseAccount, injected, walletConnect } from "wagmi/connectors";
import { Attribution } from "ox/erc8021";
import type { Address, Hex } from "viem";

export const APP_NAME = "Stockpot";

export const SITE_URL = "https://usestockpot.vercel.app";

/**
 * WalletConnect (Reown) lets phone users sign in from Safari/Chrome with Trust Wallet, MetaMask,
 * OKX and hundreds more: the wallet app opens to approve, then returns to the site. It is the
 * only route for Trust Wallet on iPhone (Apple removed its in-app browser) and does not depend on
 * coinbase.com, which is blocked on some networks. Project ID from cloud.reown.com (public value).
 */
export const WC_PROJECT_ID = process.env.NEXT_PUBLIC_WC_PROJECT_ID ?? "";

export const wagmiConfig = createConfig({
  chains: [base],
  connectors: [
    baseAccount({ appName: APP_NAME }),
    injected(),
    ...(WC_PROJECT_ID
      ? [
          walletConnect({
            projectId: WC_PROJECT_ID,
            showQrModal: true,
            metadata: {
              name: APP_NAME,
              description: "Savings circles that pay out in stocks, on Base",
              url: SITE_URL,
              icons: [],
            },
            qrModalOptions: {
              themeMode: "light",
              themeVariables: { "--wcm-accent-color": "#2350FF", "--wcm-z-index": "1000" },
              // WalletConnect explorer IDs: Trust Wallet, MetaMask, OKX Wallet shown first
              explorerRecommendedWalletIds: [
                "4622a2b2d6af1c9844944291e5e7351a6aa24cd7b23099efac1b2fd875da31a0",
                "c57ca95b47569778a828d19178114f4db188b89b763c899ba0be274e97267d96",
                "971e689d0a5be527bac79629b4ee9b925e82208e5168b733496a09c0faed0709",
              ],
            },
          }),
        ]
      : []),
  ],
  transports: { [base.id]: http(process.env.NEXT_PUBLIC_BASE_RPC_URL) },
  ssr: true,
});

/**
 * Builder Code (ERC-8021) suffix appended to every Stockpot transaction so Base can attribute
 * usage to the app. Register the code at base.dev and set NEXT_PUBLIC_BUILDER_CODE.
 */
export const BUILDER_CODE = process.env.NEXT_PUBLIC_BUILDER_CODE ?? "";
export const dataSuffix: Hex | undefined = BUILDER_CODE
  ? Attribution.toDataSuffix({ codes: [BUILDER_CODE] })
  : undefined;

export const FACTORY_ADDRESS = (process.env.NEXT_PUBLIC_FACTORY_ADDRESS ?? "") as Address | "";
export const USDC_ADDRESS: Address = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const SPEND_PERMISSION_MANAGER: Address = "0xf85210B21cC50302F477BA56686d2019dC9b67Ad";

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
