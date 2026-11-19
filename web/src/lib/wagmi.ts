import { createConfig, http } from "wagmi";
import { base } from "wagmi/chains";
import { baseAccount, injected } from "wagmi/connectors";
import { Attribution } from "ox/erc8021";
import type { Address, Hex } from "viem";

export const APP_NAME = "Stockpot";

export const wagmiConfig = createConfig({
  chains: [base],
  connectors: [
    baseAccount({ appName: APP_NAME, appLogoUrl: "https://stockpot.app/icon.png" }),
    injected(),
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
