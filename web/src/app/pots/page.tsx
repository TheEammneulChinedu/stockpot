"use client";

import Link from "next/link";
import { useMemo } from "react";
import type { Address } from "viem";
import { useAccount, useReadContract, useReadContracts } from "wagmi";
import { ConnectButton } from "@/components/ConnectButton";
import { potAbi } from "@/lib/abi/Pot";
import { potFactoryAbi } from "@/lib/abi/PotFactory";
import { usd } from "@/lib/pot";
import { useStockAddresses } from "@/lib/useStockAddresses";
import { FACTORY_ADDRESS } from "@/lib/wagmi";
import a from "../app.module.css";

/** Every pot the signed-in wallet has created or joined, read straight from the contracts. */
export default function MyPotsPage() {
  const { address, isConnected } = useAccount();
  const factory = FACTORY_ADDRESS as Address;
  const stocks = useStockAddresses();
  const tickerOf = useMemo(() => {
    const m: Record<string, string> = {};
    for (const [t, addr] of Object.entries(stocks)) m[addr.toLowerCase()] = t;
    return m;
  }, [stocks]);

  const { data: count } = useReadContract({
    address: factory,
    abi: potFactoryAbi,
    functionName: "potCount",
    query: { enabled: Boolean(FACTORY_ADDRESS) && isConnected, refetchInterval: 30_000 },
  });
  const n = Number(count ?? 0n);

  const { data: potAddrs } = useReadContracts({
    contracts: Array.from({ length: n }, (_, i) => ({
      address: factory,
      abi: potFactoryAbi,
      functionName: "allPots" as const,
      args: [BigInt(i)] as const,
    })),
    query: { enabled: n > 0 && isConnected },
  });
  const pots = (potAddrs ?? []).map((d) => d.result as Address | undefined).filter(Boolean) as Address[];

  // Which of them is this wallet in? (seat number + 1, or 0 if not a member)
  const { data: seatData, isLoading: seatsLoading } = useReadContracts({
    contracts: pots.map((p) => ({
      address: p,
      abi: potAbi,
      functionName: "indexPlusOne" as const,
      args: [address as Address] as const,
    })),
    query: { enabled: pots.length > 0 && Boolean(address), refetchInterval: 30_000 },
  });
  const mine = pots
    .map((p, i) => ({ pot: p, seat: Number((seatData?.[i]?.result as bigint | undefined) ?? 0n) - 1 }))
    .filter((x) => x.seat >= 0)
    .reverse(); // newest first

  const fields = ["name", "stock", "contribution", "status", "round", "memberCount", "maxMembers", "captain", "members"] as const;
  const { data: potData } = useReadContracts({
    contracts: mine.flatMap(({ pot }) => fields.map((f) => ({ address: pot, abi: potAbi, functionName: f }))),
    query: { enabled: mine.length > 0, refetchInterval: 20_000 },
  });

  const rows = mine.map(({ pot, seat }, i) => {
    const get = (k: number) => potData?.[i * fields.length + k]?.result;
    const members = (get(8) as readonly { claimableStock: bigint; claimableUsdc: bigint; locked: bigint }[] | undefined) ?? [];
    const me = members[seat];
    return {
      pot,
      seat,
      name: (get(0) as string | undefined) ?? "…",
      ticker: tickerOf[((get(1) as string | undefined) ?? "").toLowerCase()] ?? "stock",
      contribution: get(2) as bigint | undefined,
      status: Number(get(3) ?? 0),
      round: Number((get(4) as bigint | undefined) ?? 0n),
      memberCount: Number((get(5) as bigint | undefined) ?? 0n),
      maxMembers: Number((get(6) as bigint | undefined) ?? 0n),
      captain: ((get(7) as string | undefined) ?? "").toLowerCase() === (address ?? "").toLowerCase(),
      toClaim: Boolean(me && (me.claimableStock > 0n || me.claimableUsdc > 0n)),
    };
  });

  // Has this wallet paid the current round in each running pot?
  const running = rows.filter((r) => r.status === 1);
  const { data: paidData } = useReadContracts({
    contracts: running.map((r) => ({
      address: r.pot,
      abi: potAbi,
      functionName: "paid" as const,
      args: [BigInt(r.round), BigInt(r.seat)] as const,
    })),
    query: { enabled: running.length > 0, refetchInterval: 20_000 },
  });
  const paidMap = Object.fromEntries(running.map((r, i) => [r.pot, Boolean(paidData?.[i]?.result)]));

  const loading = isConnected && (count === undefined || (n > 0 && (potAddrs === undefined || seatsLoading)));

  return (
    <div className={`wrap ${a.page}`}>
      <div className={a.head}>
        <h1>My pots</h1>
        <p>Every pot you&apos;ve started or joined with this wallet. Tap one to pay, claim or invite people.</p>
      </div>

      {!isConnected ? (
        <div className={a.panel}>
          <p>Sign in with the wallet you used for your pots.</p>
          <div className={a.actions}>
            <ConnectButton label="Sign in" />
          </div>
        </div>
      ) : loading ? (
        <p className={a.help}>Looking up your pots…</p>
      ) : rows.length === 0 ? (
        <div className={a.panel}>
          <p>You&apos;re not in any pots with this wallet yet.</p>
          <div className={a.actions}>
            <Link href="/start" className="btn btn-primary">
              Start a pot
            </Link>
          </div>
        </div>
      ) : (
        <>
          <ul className={a.potList}>
            {rows.map((r) => {
              const due = r.status === 1 && !paidMap[r.pot];
              return (
                <li key={r.pot}>
                  <Link href={`/pot/?address=${r.pot}`} className={a.potCard}>
                    <span className={a.potMain}>
                      <strong>{r.name}</strong>
                      <span className={a.meta}>
                        {usd(r.contribution)} a round in {r.ticker}, {r.memberCount} of {r.maxMembers} members
                        {r.captain ? ", you're the captain" : ""}
                      </span>
                    </span>
                    <span className={a.potTags}>
                      {r.status === 0 && (
                        <span className={a.tag}>{r.captain && r.memberCount >= 3 ? "Ready to start" : "Filling up"}</span>
                      )}
                      {r.status === 1 &&
                        (due ? (
                          <span className={a.tag} data-kind="due">
                            Pay round {r.round + 1}
                          </span>
                        ) : (
                          <span className={a.tag} data-kind="paid">
                            Paid round {r.round + 1}
                          </span>
                        ))}
                      {r.status === 2 && <span className={a.tag}>Finished</span>}
                      {r.toClaim && (
                        <span className={a.tag} data-kind="paid">
                          Stock to claim
                        </span>
                      )}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
          <div className={a.actions}>
            <Link href="/start" className="btn btn-ghost">
              Start another pot
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
