"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { decodeEventLog, keccak256, parseUnits, toHex, type Address } from "viem";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { requestSpendPermission } from "@base-org/account/spend-permission/browser";
import { ConnectButton } from "@/components/ConnectButton";
import { potFactoryAbi } from "@/lib/abi/PotFactory";
import { EMPTY_PERMISSION, toContractPermission } from "@/lib/pot";
import { lockFor, money } from "@/lib/potMath";
import { PAYOUT_CHOICES } from "@/lib/stocks";
import { useStockAddresses } from "@/lib/useStockAddresses";
import { useWallet } from "@/lib/useWallet";
import { dataSuffix, FACTORY_ADDRESS, USDC_ADDRESS } from "@/lib/wagmi";
import a from "../app.module.css";

const RHYTHMS = [
  { label: "Daily", seconds: 86_400, days: 1, help: "Rounds settle on weekdays, when stock prices are live. A round that lands on a weekend waits until Monday, and everyone always gets at least 24 hours to pay once a round opens." },
  { label: "Weekly", seconds: 604_800, days: 7, help: "One round a week. Everyone always gets at least 24 hours to pay once a round opens." },
];

type Step = "idle" | "permission" | "creating" | "error";


export default function StartPage() {
  const router = useRouter();
  const { address, connector, isConnected } = useAccount();
  const client = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const stocks = useStockAddresses();
  const { isBaseAccount, ensureBase } = useWallet();

  const [name, setName] = useState("");
  const [members, setMembers] = useState(5);
  const [amount, setAmount] = useState(5);
  const [ticker, setTicker] = useState("NVDAc");
  const [rhythm, setRhythm] = useState(0);
  const [autoPay, setAutoPay] = useState(true);
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState("");

  const pot = members * amount;
  const stockAddress = stocks[ticker];
  const ready = Boolean(FACTORY_ADDRESS && stockAddress && name.trim().length > 0 && isConnected);
  const firstLock = useMemo(() => lockFor(0, members, amount), [members, amount]);

  async function create() {
    if (!ready || !client || !address || !FACTORY_ADDRESS || !stockAddress) return;
    setError("");
    try {
      await ensureBase();
      const params = {
        name: name.trim(),
        stock: stockAddress,
        contribution: parseUnits(String(amount), 6),
        maxMembers: BigInt(members),
        interval: BigInt(RHYTHMS[rhythm].seconds),
      };
      const salt = keccak256(toHex(`${address}-${Date.now()}`));
      let permission = EMPTY_PERMISSION;
      let signature: `0x${string}` = "0x";

      if (autoPay && isBaseAccount) {
        setStep("permission");
        const predicted = await client.readContract({
          address: FACTORY_ADDRESS as Address,
          abi: potFactoryAbi,
          functionName: "predictPotAddress",
          args: [address, params, salt],
        });
        const provider = await connector?.getProvider();
        const sp = await requestSpendPermission({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          provider: provider as any,
          account: address,
          spender: predicted,
          token: USDC_ADDRESS,
          chainId: 8453,
          allowance: params.contribution * 2n, // periods aren't aligned to rounds
          periodInDays: RHYTHMS[rhythm].days,
          end: new Date(Date.now() + (members + 4) * RHYTHMS[rhythm].seconds * 1000 + 14 * 86_400_000),
        });
        permission = toContractPermission(sp);
        signature = sp.signature as `0x${string}`;
      }

      setStep("creating");
      const hash = await writeContractAsync({
        address: FACTORY_ADDRESS as Address,
        abi: potFactoryAbi,
        functionName: "createPot",
        args: [params, salt, permission, signature],
        dataSuffix,
      });
      const receipt = await client.waitForTransactionReceipt({ hash });
      let potAddress: Address | undefined;
      for (const log of receipt.logs) {
        try {
          const ev = decodeEventLog({ abi: potFactoryAbi, data: log.data, topics: log.topics });
          if (ev.eventName === "PotCreated") potAddress = ev.args.pot;
        } catch {}
      }
      router.push(`/pot/?address=${potAddress}&new=1`);
    } catch (e) {
      setStep("error");
      setError(e instanceof Error ? e.message.split("\n")[0] : "Creating the pot failed. Try again.");
    }
  }

  const busy = step === "permission" || step === "creating";

  return (
    <div className={`wrap ${a.page}`}>
      <div className={a.head}>
        <h1>Start a pot</h1>
        <p>You collect first. Your friends join from a link, and every round one of you collects the whole pot as stock.</p>
      </div>

      <div className={a.grid}>
        <form
          className={a.panel}
          onSubmit={(e) => {
            e.preventDefault();
            create();
          }}
        >
          <label className={a.field}>
            <span className={a.label}>Pot name</span>
            <input
              className={a.input}
              value={name}
              maxLength={48}
              placeholder="Lekki Ladies Pot"
              onChange={(e) => setName(e.target.value)}
              required
            />
            <span className={a.help}>Your members see this on the invite.</span>
          </label>

          <div className={a.field}>
            <span className={a.label} id="f-members">
              People in the pot, including you
            </span>
            <div className={a.options} role="radiogroup" aria-labelledby="f-members">
              {[3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                <label key={n} className={a.option} data-on={members === n}>
                  <input type="radio" className="visually-hidden" checked={members === n} onChange={() => setMembers(n)} />
                  {n}
                </label>
              ))}
            </div>
          </div>

          <label className={a.field}>
            <span className={a.label}>Each person pays per round: {money(amount)}</span>
            <input
              type="range"
              min={1}
              max={25}
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              style={{ accentColor: "var(--cobalt)" }}
            />
            <span className={a.help}>In USDC on Base. $1 to $25 during the beta.</span>
          </label>

          <div className={a.field}>
            <span className={a.label} id="f-stock">
              Pays out in
            </span>
            <div className={a.options} role="radiogroup" aria-labelledby="f-stock">
              {PAYOUT_CHOICES.map((s) => (
                <label key={s.ticker} className={a.option} data-on={ticker === s.ticker}>
                  <input type="radio" className="visually-hidden" checked={ticker === s.ticker} onChange={() => setTicker(s.ticker)} />
                  {s.company}
                </label>
              ))}
            </div>
          </div>

          <div className={a.field}>
            <span className={a.label} id="f-rhythm">
              How often
            </span>
            <div className={a.options} role="radiogroup" aria-labelledby="f-rhythm">
              {RHYTHMS.map((r, i) => (
                <label key={r.label} className={a.option} data-on={rhythm === i}>
                  <input type="radio" className="visually-hidden" checked={rhythm === i} onChange={() => setRhythm(i)} />
                  {r.label}
                </label>
              ))}
            </div>
            <span className={a.help}>{RHYTHMS[rhythm].help}</span>
          </div>

          {isBaseAccount || !isConnected ? (
            <label className={a.toggle}>
              <input type="checkbox" checked={autoPay} onChange={(e) => setAutoPay(e.target.checked)} />
              <span>
                <strong>Pay automatically.</strong> One approval lets this pot take up to {money(amount * 2)} of USDC
                per {RHYTHMS[rhythm].days === 1 ? "day" : "week"}, only for this pot. Needs a Base Account; you can
                revoke it any time.
              </span>
            </label>
          ) : (
            <p className={a.help}>
              With this wallet you&apos;ll tap <strong>Pay</strong> once each round. Auto-pay is available when you sign in
              with a Base Account.
            </p>
          )}

          {!FACTORY_ADDRESS && (
            <p className={a.notice}>Pots open on Base mainnet soon. The contracts are being deployed.</p>
          )}
          {FACTORY_ADDRESS && !stockAddress && (
            <p className={a.notice}>Loading the {ticker} contract address…</p>
          )}
          {error && <p className={a.error}>{error}</p>}

          <div className={a.actions}>
            {isConnected ? (
              <button type="submit" className="btn btn-primary" disabled={!ready || busy}>
                {step === "permission" ? "Approve in your wallet…" : step === "creating" ? "Creating your pot…" : "Create pot"}
              </button>
            ) : (
              <ConnectButton label="Sign in to create" />
            )}
          </div>
        </form>

        <aside className={`${a.panel} ${a.summary}`} aria-label="Pot summary">
          <h2>{name.trim() || "Your pot"}</h2>
          <dl className={a.rows}>
            <div>
              <dt>Pot each round</dt>
              <dd>{money(pot)} of {ticker}</dd>
            </div>
            <div>
              <dt>You pay in total</dt>
              <dd>{money(pot)}</dd>
            </div>
            <div>
              <dt>Rounds</dt>
              <dd>
                {members} ({RHYTHMS[rhythm].label.toLowerCase()})
              </dd>
            </div>
            <div>
              <dt>Your turn</dt>
              <dd>Round 1</dd>
            </div>
            <div>
              <dt>Frozen at your turn</dt>
              <dd>{money(firstLock)}</dd>
            </div>
          </dl>
          <p className={a.help}>
            As first collector you owe {money(pot - amount)} more, so {money(firstLock)} of your stock stays frozen and melts
            a slice with each payment you make. Stock prices move; only put in what you are comfortable holding in
            stocks.
          </p>
        </aside>
      </div>
    </div>
  );
}
