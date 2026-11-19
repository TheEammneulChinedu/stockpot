import type { Address, Hex } from "viem";
import { formatUnits } from "viem";

export type ContractPermission = {
  account: Address;
  spender: Address;
  token: Address;
  allowance: bigint;
  period: number;
  start: number;
  end: number;
  salt: bigint;
  extraData: Hex;
};

export const EMPTY_PERMISSION: ContractPermission = {
  account: "0x0000000000000000000000000000000000000000",
  spender: "0x0000000000000000000000000000000000000000",
  token: "0x0000000000000000000000000000000000000000",
  allowance: 0n,
  period: 0,
  start: 0,
  end: 0,
  salt: 0n,
  extraData: "0x",
};

/** Shape returned by @base-org/account requestSpendPermission → the struct the Pot contract takes. */
export function toContractPermission(sp: {
  permission: {
    account: string;
    spender: string;
    token: string;
    allowance: string;
    period: number;
    start: number;
    end: number;
    salt: string;
    extraData: string;
  };
}): ContractPermission {
  const p = sp.permission;
  return {
    account: p.account as Address,
    spender: p.spender as Address,
    token: p.token as Address,
    allowance: BigInt(p.allowance),
    period: p.period,
    start: p.start,
    end: p.end,
    salt: BigInt(p.salt),
    extraData: (p.extraData || "0x") as Hex,
  };
}

export const usd = (v: bigint | undefined) =>
  v === undefined ? "–" : `$${Number(formatUnits(v, 6)).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

export const STATUS = ["Filling up", "Running", "Finished"] as const;

export function shortAddr(a?: string) {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "";
}

export function inviteText(name: string, url: string, contribution: string, ticker: string) {
  return `Join "${name}" on Stockpot: ${contribution} a round, and every round one of us collects the whole pot in ${ticker} stock. ${url}`;
}
