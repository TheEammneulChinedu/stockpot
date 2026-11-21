"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { erc20Abi, formatUnits, isAddress, type Address } from "viem";
import { useAccount, usePublicClient, useReadContract, useReadContracts, useWriteContract } from "wagmi";
import { requestSpendPermission } from "@base-org/account/spend-permission/browser";
import { ConnectButton } from "@/components/ConnectButton";
import { potAbi } from "@/lib/abi/Pot";
import { inviteText, shortAddr, STATUS, toContractPermission, usd } from "@/lib/pot";
import { useStockAddresses } from "@/lib/useStockAddresses";
import { useWallet } from "@/lib/useWallet";
import { dataSuffix, USDC_ADDRESS } from "@/lib/wagmi";
import a from "../app.module.css";

export default function PotPage() {
  return (
    <Suspense fallback={<div className={`wrap ${a.page}`}>Loading pot…</div>}>
      <PotView />
    </Suspense>
  );
}

function PotView() {
  const params = useSearchParams();
  const raw = params.get("address") ?? "";
  const isNew = params.get("new") === "1";
  if (!isAddress(raw)) {
    return (
      <div className={`wrap ${a.page}`}>
        <div className={a.head}>
          <h1>Pot not found</h1>
          <p>Check the invite link. It should end with ?address= followed by the pot&apos;s address.</p>
        </div>
      </div>
    );
  }
  return <PotDetail pot={raw} isNew={isNew} />;
}

function PotDetail({ pot, isNew }: { pot: Address; isNew: boolean }) {
  const { address, connector, isConnected } = useAccount();
  const client = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const stocks = useStockAddresses();
  const { isBaseAccount, ensureBase } = useWallet();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const c = { address: pot, abi: potAbi } as const;
  const { data, refetch } = useReadContracts({
    contracts: [
      { ...c, functionName: "name" },
      { ...c, functionName: "stock" },
      { ...c, functionName: "contribution" },
      { ...c, functionName: "maxMembers" },
      { ...c, functionName: "interval" },
      { ...c, functionName: "status" },
      { ...c, functionName: "round" },
      { ...c, functionName: "members" },
      { ...c, functionName: "roundDeadline" },
      { ...c, functionName: "captain" },
      { ...c, functionName: "stockDecimals" },
    ],
    query: { refetchInterval: 15_000 },
  });
  const [name, stock, contribution, maxMembers, interval, status, round, members, deadline, captain, decimals] =
    (data ?? []).map((d) => d?.result) as [
      string | undefined,
      Address | undefined,
      bigint | undefined,
      bigint | undefined,
      bigint | undefined,
      number | undefined,
      bigint | undefined,
      | readonly {
          account: Address;
          collected: boolean;
          hasPermission: boolean;
          lockRoundsLeft: number;
          locked: bigint;
          claimableStock: bigint;
          claimableUsdc: bigint;
          debt: bigint;
        }[]
      | undefined,
      bigint | undefined,
      Address | undefined,
      number | undefined,
    ];

  const list = members ?? [];
  const r = Number(round ?? 0n);
  const { data: paidData, refetch: refetchPaid } = useReadContracts({
    contracts: list.map((_, i) => ({ ...c, functionName: "paid" as const, args: [BigInt(r), BigInt(i)] as const })),
    query: { enabled: status === 1 && list.length > 0, refetchInterval: 15_000 },
  });
  const paid = (paidData ?? []).map((d) => Boolean(d?.result));

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: "allowance",
    args: address ? [address, pot] : undefined,
    query: { enabled: Boolean(address) },
  });

  const ticker = useMemo(
    () => Object.entries(stocks).find(([, v]) => v.toLowerCase() === stock?.toLowerCase())?.[0] ?? "stock",
    [stocks, stock],
  );
  const myIndex = list.findIndex((m) => m.account.toLowerCase() === address?.toLowerCase());
  const me = myIndex >= 0 ? list[myIndex] : undefined;
  const isCaptain = captain && address && captain.toLowerCase() === address.toLowerCase();
  const tok = (v: bigint) => `${Number(formatUnits(v, decimals ?? 18)).toLocaleString(undefined, { maximumFractionDigits: 5 })} ${ticker}`;
  const potSize = contribution !== undefined && maxMembers !== undefined ? contribution * maxMembers : undefined;
  const url = typeof window !== "undefined" ? window.location.href.replace("&new=1", "") : "";
  const invite = inviteText(name ?? "my pot", url, usd(contribution), ticker);
  const days = interval ? Number(interval) / 86_400 : 1;

  async function act(label: string, fn: () => Promise<`0x${string}` | void>) {
    setBusy(label);
    setError("");
    try {
      await ensureBase();
      const hash = await fn();
      if (hash && client) await client.waitForTransactionReceipt({ hash });
      await Promise.all([refetch(), refetchPaid(), refetchAllowance()]);
    } catch (e) {
      setError(e instanceof Error ? e.message.split("\n")[0] : "That didn't go through. Try again.");
    } finally {
      setBusy("");
    }
  }

  const joinAuto = () =>
    act("join", async () => {
      if (!address || !contribution || !interval) return;
      const provider = await connector?.getProvider();
      const sp = await requestSpendPermission({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        provider: provider as any,
        account: address,
        spender: pot,
        token: USDC_ADDRESS,
        chainId: 8453,
        allowance: contribution * 2n,
        periodInDays: Math.max(1, Math.round(days)),
        end: new Date(Date.now() + (Number(maxMembers ?? 10n) + 4) * Number(interval) * 1000 + 14 * 86_400_000),
      });
      return writeContractAsync({
        ...c,
        functionName: "joinWithPermission",
        args: [toContractPermission(sp), sp.signature as `0x${string}`],
        dataSuffix,
      });
    });

  const joinManual = () => act("join", () => writeContractAsync({ ...c, functionName: "join", dataSuffix }));
  const startNow = () => act("start", () => writeContractAsync({ ...c, functionName: "start", dataSuffix }));
  const claim = () => act("claim", () => writeContractAsync({ ...c, functionName: "claim", dataSuffix }));
  const pay = () =>
    act("pay", async () => {
      if (!contribution || !client) return;
      if ((allowance ?? 0n) < contribution) {
        const h = await writeContractAsync({
          address: USDC_ADDRESS,
          abi: erc20Abi,
          functionName: "approve",
          args: [pot, contribution],
          dataSuffix,
        });
        await client.waitForTransactionReceipt({ hash: h });
      }
      return writeContractAsync({ ...c, functionName: "contribute", dataSuffix });
    });

  const loading = name === undefined;

  return (
    <div className={`wrap ${a.page}`}>
      <div className={a.head}>
        <h1>{loading ? "Loading pot…" : name}</h1>
        {!loading && (
          <p>
            {usd(contribution)} a round from each of {String(maxMembers)} people. Every round one of them collects{" "}
            {usd(potSize)} of {ticker}. {STATUS[status ?? 0]}
            {status === 1 && `, round ${r + 1} of ${list.length}`}.
          </p>
        )}
      </div>

      {isNew && <p className={a.ok} style={{ marginBottom: 24 }}>Your pot is live. Send the invite to your people.</p>}

      <div className={a.grid}>
        <section className={a.panel} aria-labelledby="members-title">
          <h2 id="members-title" style={{ fontSize: "var(--t-lg)" }}>
            Members {list.length}/{String(maxMembers ?? "")}
          </h2>
          <ul className={a.members}>
            {list.map((m, i) => {
              const now = status === 1 && i === r;
              const tag = m.collected
                ? "Collected"
                : now
                  ? "Collecting now"
                  : status === 1
                    ? `Collects round ${i + 1}`
                    : `Round ${i + 1}`;
              return (
                <li key={m.account}>
                  <span className={a.seat} data-now={now}>
                    {i + 1}
                  </span>
                  <span>
                    <strong>{i === myIndex ? "You" : shortAddr(m.account)}</strong>
                    {i === 0 && <span className={a.meta}> captain</span>}
                    <br />
                    <span className={a.meta}>
                      {tag}
                      {m.collected && m.locked > 0n && `, ${tok(m.locked)} frozen`}
                      {m.hasPermission ? ", pays automatically" : ""}
                    </span>
                  </span>
                  {status === 1 && (
                    <span className={a.tag} data-kind={paid[i] ? "paid" : "due"}>
                      {paid[i] ? "Paid" : "Due"}
                    </span>
                  )}
                </li>
              );
            })}
            {Array.from({ length: Math.max(0, Number(maxMembers ?? 0n) - list.length) }, (_, k) => (
              <li key={`open-${k}`}>
                <span className={a.seat} style={{ borderStyle: "dashed" }}>
                  {list.length + k + 1}
                </span>
                <span className={a.meta}>Open seat</span>
                <span />
              </li>
            ))}
          </ul>
          {status === 1 && deadline !== undefined && (
            <p className={a.help}>
              Round {r + 1} settles when everyone has paid, or after {new Date(Number(deadline) * 1000).toLocaleString()}
              . Settlement waits for a live stock price, so weekend rounds settle on Monday.
            </p>
          )}
        </section>

        <aside className={`${a.panel} ${a.summary}`} aria-label="Your actions">
          {!isConnected && (
            <>
              <h2>Sign in to join or pay</h2>
              <ConnectButton label="Sign in" />
            </>
          )}

          {isConnected && !me && status === 0 && (
            <>
              <h2>Join this pot</h2>
              <p className={a.help}>
                You&apos;ll collect in round {list.length + 1}.
                {isBaseAccount &&
                  ` Auto-pay lets the pot take up to ${usd(contribution ? contribution * 2n : undefined)} per ${days === 1 ? "day" : "period"}, only for this pot.`}
              </p>
              <div className={a.actions}>
                {isBaseAccount ? (
                  <>
                    <button className="btn btn-primary" onClick={joinAuto} disabled={!!busy}>
                      {busy === "join" ? "Confirm in your wallet…" : "Join with auto-pay"}
                    </button>
                    <button className="btn btn-ghost" onClick={joinManual} disabled={!!busy}>
                      Join, I&apos;ll pay each round
                    </button>
                  </>
                ) : (
                  <button className="btn btn-primary" onClick={joinManual} disabled={!!busy}>
                    {busy === "join" ? "Confirm in your wallet…" : "Join this pot"}
                  </button>
                )}
              </div>
              {!isBaseAccount && (
                <p className={a.help}>You&apos;ll tap Pay once each round. Auto-pay needs a Base Account.</p>
              )}
            </>
          )}

          {isConnected && !me && status !== 0 && <h2>This pot is full</h2>}

          {me && (
            <>
              <h2>{myIndex === r && status === 1 ? "It's your turn this round" : "Your seat"}</h2>
              <dl className={a.rows}>
                <div>
                  <dt>Your turn</dt>
                  <dd>Round {myIndex + 1}</dd>
                </div>
                <div>
                  <dt>Withdrawable</dt>
                  <dd>{tok(me.claimableStock)}</dd>
                </div>
                <div>
                  <dt>Frozen as collateral</dt>
                  <dd>{tok(me.locked)}</dd>
                </div>
                {me.claimableUsdc > 0n && (
                  <div>
                    <dt>USDC owed to you</dt>
                    <dd>{usd(me.claimableUsdc)}</dd>
                  </div>
                )}
              </dl>
              <div className={a.actions}>
                {status === 1 && !paid[myIndex] && (
                  <button className="btn btn-primary" onClick={pay} disabled={!!busy}>
                    {busy === "pay" ? "Paying…" : `Pay ${usd(contribution)} for round ${r + 1}`}
                  </button>
                )}
                {(me.claimableStock > 0n || me.claimableUsdc > 0n) && (
                  <button className="btn btn-ghost" onClick={claim} disabled={!!busy}>
                    {busy === "claim" ? "Withdrawing…" : "Withdraw to my wallet"}
                  </button>
                )}
                {isCaptain && status === 0 && list.length >= 3 && (
                  <button className="btn btn-ghost" onClick={startNow} disabled={!!busy}>
                    {busy === "start" ? "Starting…" : `Start with ${list.length} people`}
                  </button>
                )}
              </div>
            </>
          )}

          {error && <p className={a.error}>{error}</p>}

          {status === 0 && (
            <div className={a.field}>
              <span className={a.label}>Invite your people</span>
              <div className={a.actions}>
                <a
                  className="btn btn-primary"
                  href={`https://wa.me/?text=${encodeURIComponent(invite)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Share on WhatsApp
                </a>
                <button
                  className="btn btn-ghost"
                  onClick={() => {
                    navigator.clipboard.writeText(url);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                >
                  {copied ? "Link copied" : "Copy link"}
                </button>
              </div>
            </div>
          )}
          <p className={a.help}>
            Pot contract{" "}
            <a href={`https://basescan.org/address/${pot}`} target="_blank" rel="noreferrer">
              {shortAddr(pot)}
            </a>
          </p>
        </aside>
      </div>
    </div>
  );
}
