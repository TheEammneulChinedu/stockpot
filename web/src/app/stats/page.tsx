"use client";

import Link from "next/link";
import type { Address } from "viem";
import { useReadContract, useReadContracts } from "wagmi";
import { potAbi } from "@/lib/abi/Pot";
import { potFactoryAbi } from "@/lib/abi/PotFactory";
import { STATUS, usd } from "@/lib/pot";
import { FACTORY_ADDRESS } from "@/lib/wagmi";
import a from "../app.module.css";

const GOALS = { pots: 100, seats: 500 };

export default function StatsPage() {
  const factory = FACTORY_ADDRESS as Address;
  const { data: count } = useReadContract({
    address: factory,
    abi: potFactoryAbi,
    functionName: "potCount",
    query: { enabled: Boolean(FACTORY_ADDRESS), refetchInterval: 30_000 },
  });
  const n = Number(count ?? 0n);

  const { data: potAddrs } = useReadContracts({
    contracts: Array.from({ length: n }, (_, i) => ({
      address: factory,
      abi: potFactoryAbi,
      functionName: "allPots" as const,
      args: [BigInt(i)] as const,
    })),
    query: { enabled: n > 0 },
  });
  const pots = (potAddrs ?? []).map((d) => d.result as Address | undefined).filter(Boolean) as Address[];

  const fields = ["name", "memberCount", "round", "status", "totalUsdcContributed"] as const;
  const { data: potData } = useReadContracts({
    contracts: pots.flatMap((p) => fields.map((f) => ({ address: p, abi: potAbi, functionName: f }))),
    query: { enabled: pots.length > 0, refetchInterval: 30_000 },
  });

  const rows = pots.map((p, i) => {
    const get = (k: number) => potData?.[i * fields.length + k]?.result;
    return {
      address: p,
      name: (get(0) as string) ?? "…",
      members: Number((get(1) as bigint) ?? 0n),
      round: Number((get(2) as bigint) ?? 0n),
      status: Number(get(3) ?? 0),
      contributed: (get(4) as bigint) ?? 0n,
    };
  });

  const seats = rows.reduce((s, r) => s + r.members, 0);
  const rounds = rows.reduce((s, r) => s + r.round, 0);
  const contributed = rows.reduce((s, r) => s + r.contributed, 0n);
  const finished = rows.filter((r) => r.status === 2).length;

  return (
    <div className={`wrap ${a.page}`}>
      <div className={a.head}>
        <h1>Live stats</h1>
        <p>
          Read straight from the Stockpot contracts on Base. Nothing here is self-reported. Building in public for Base
          Stocks Maxxing Season.
        </p>
      </div>

      {!FACTORY_ADDRESS ? (
        <p className={a.notice}>Stats appear here as soon as the contracts are live on Base mainnet.</p>
      ) : (
        <div style={{ display: "grid", gap: 40 }}>
          <div className={a.tiles}>
            <Tile value={String(n)} label="Pots started" />
            <Tile value={String(seats)} label="Seats filled" />
            <Tile value={usd(contributed)} label="USDC paid in" />
            <Tile value={String(rounds)} label="Rounds paid out" />
            <Tile value={String(finished)} label="Pots completed" />
          </div>

          <div className={a.panel}>
            <Goal label="Pots" value={n} goal={GOALS.pots} />
            <Goal label="Seats" value={seats} goal={GOALS.seats} />
            <p className={a.help}>Goals for the end of the hackathon, 4 December 2026.</p>
          </div>

          {rows.length > 0 && (
            <div className={a.panel} style={{ overflowX: "auto" }}>
              <table className={a.table}>
                <thead>
                  <tr>
                    <th>Pot</th>
                    <th>Members</th>
                    <th>Status</th>
                    <th>Paid in</th>
                  </tr>
                </thead>
                <tbody>
                  {[...rows].reverse().slice(0, 30).map((r) => (
                    <tr key={r.address}>
                      <td>
                        <Link href={`/pot/?address=${r.address}`}>{r.name}</Link>
                      </td>
                      <td>{r.members}</td>
                      <td>
                        {STATUS[r.status]}
                        {r.status === 1 && `, round ${r.round + 1}`}
                      </td>
                      <td>{usd(r.contributed)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Tile({ value, label }: { value: string; label: string }) {
  return (
    <div className={a.tile}>
      <span className={a.tileValue}>{value}</span>
      <span className={a.tileLabel}>{label}</span>
    </div>
  );
}

function Goal({ label, value, goal }: { label: string; value: number; goal: number }) {
  const pct = Math.min(100, (value / goal) * 100);
  return (
    <div className={a.goal}>
      <div className={a.goalRow}>
        <span>{label}</span>
        <span>
          {value} of {goal}
        </span>
      </div>
      <div className={a.goalBar} role="progressbar" aria-valuenow={value} aria-valuemax={goal} aria-label={`${label} goal`}>
        <span style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
