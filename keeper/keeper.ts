/**
 * Stockpot keeper: one tick = walk every pot and push it forward.
 *
 *   1. pullAll()      collect this round from members who use auto-pay
 *   2. settleRound()  once everyone paid (or the deadline passed) and the price feed is live:
 *                     route swapAmount() USDC → stock via Hydrex (fallback 0x), then settle with that calldata
 *   3. claimFor()     push withdrawable stock / USDC to members' wallets
 *
 * Everything here is permissionless on the contracts: the keeper is a convenience, never trusted.
 * Every transaction carries the Builder Code suffix so Base attributes the activity to Stockpot.
 *
 * Run on a schedule (e.g. every 10 minutes via GitHub Actions or Vercel Cron):
 *   KEEPER_PRIVATE_KEY=0x… FACTORY_ADDRESS=0x… ZEROX_API_KEY=… BUILDER_CODE=… npm run tick
 */
import { Attribution } from "ox/erc8021";
import { createPublicClient, createWalletClient, decodeFunctionData, erc20Abi, formatUnits, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { potAbi } from "./Pot.js";
import { potFactoryAbi } from "./PotFactory.js";

const env = (k: string, required = true) => {
  const v = process.env[k];
  if (!v && required) throw new Error(`Missing env ${k}`);
  return v ?? "";
};

const USDC: Address = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const FACTORY = (env("FACTORY_ADDRESS", false) || "0x7Dfcb2Ca510afE1766D63c2CA6EE67C6e7Be1313") as Address; // Base mainnet PotFactory
const account = privateKeyToAccount(env("KEEPER_PRIVATE_KEY") as Hex);
const transport = http(env("BASE_RPC_URL", false) || undefined);
const pub = createPublicClient({ chain: base, transport });
const wallet = createWalletClient({ chain: base, transport, account });
const BUILDER_CODE = env("BUILDER_CODE", false);
const dataSuffix: Hex | undefined = BUILDER_CODE ? Attribution.toDataSuffix({ codes: [BUILDER_CODE] }) : undefined;
const DRY = process.env.DRY_RUN === "1";

const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

async function send(pot: Address, functionName: string, args: readonly unknown[] = []) {
  // Simulate first so a revert costs nothing and the reason is logged.
  const { request } = await pub.simulateContract({
    account,
    address: pot,
    abi: potAbi,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    functionName: functionName as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    args: args as any,
    dataSuffix,
  });
  if (DRY) return log("  dry-run", functionName);
  const hash = await wallet.writeContract(request);
  await pub.waitForTransactionReceipt({ hash });
  log("  sent", functionName, hash);
}

type SwapRoute = { venue: string; target: Address; spender: Address; data: Hex; buyAmount: bigint };

/**
 * Hydrex (Base-native MetaDEX, Stocks Maxxing partner): GET /prepare/swap returns an optional
 * approve step (whose calldata names the spender) and the swap step (router + calldata).
 * The pot does its own approve inside settleRound, so we only take the spender and the swap call.
 * Docs: docs.base.org/agents/plugins/native/hydrex
 */
async function quoteHydrex(sellAmount: bigint, buyToken: Address, taker: Address): Promise<SwapRoute> {
  const qs = new URLSearchParams({
    tokenIn: USDC,
    tokenOut: buyToken,
    amount: formatUnits(sellAmount, 6),
    decimals: "6",
    recipient: taker,
    slippage: "50",
  });
  const res = await fetch(`https://hydrex-agent.com/prepare/swap?${qs}`);
  if (!res.ok) throw new Error(`Hydrex ${res.status}: ${await res.text()}`);
  const j = (await res.json()) as {
    ok: boolean;
    error?: string;
    quote?: { amountOut: string; source?: string };
    transactions?: { step: string; to: Address; data: Hex }[];
  };
  if (!j.ok || !j.quote || !j.transactions) throw new Error(`Hydrex: ${j.error ?? "no route"}`);
  const swap = j.transactions.find((t) => t.step === "swap");
  if (!swap) throw new Error("Hydrex: no swap step");
  let spender = swap.to;
  const approve = j.transactions.find((t) => t.step.startsWith("approve"));
  if (approve) {
    const { functionName, args } = decodeFunctionData({ abi: erc20Abi, data: approve.data });
    if (functionName === "approve") spender = args[0] as Address;
  }
  return { venue: `hydrex/${j.quote.source ?? "?"}`, target: swap.to, spender, data: swap.data, buyAmount: BigInt(j.quote.amountOut) };
}

/** 0x Swap API v2 (allowance-holder flow): the pot approves and calls the AllowanceHolder. Fallback venue. */
async function quote0x(sellAmount: bigint, buyToken: Address, taker: Address): Promise<SwapRoute> {
  const qs = new URLSearchParams({
    chainId: "8453",
    sellToken: USDC,
    buyToken,
    sellAmount: sellAmount.toString(),
    taker,
    slippageBps: "50",
  });
  const res = await fetch(`https://api.0x.org/swap/allowance-holder/quote?${qs}`, {
    headers: { "0x-api-key": env("ZEROX_API_KEY"), "0x-version": "v2" },
  });
  if (!res.ok) throw new Error(`0x quote ${res.status}: ${await res.text()}`);
  const q = (await res.json()) as { transaction: { to: Address; data: Hex }; buyAmount: string };
  return { venue: "0x", target: q.transaction.to, spender: q.transaction.to, data: q.transaction.data, buyAmount: BigInt(q.buyAmount) };
}

/**
 * Routes are tried in order (SWAP_VENUES, default "hydrex,0x"). A route is only used if both its
 * target and spender are allowlisted on the factory and it beats the pot's onchain price guard.
 */
async function bestRoute(pot: Address, amount: bigint, stock: Address, minOut: bigint): Promise<SwapRoute | null> {
  const venues = (process.env.SWAP_VENUES || "hydrex,0x").split(",").map((v) => v.trim());
  for (const v of venues) {
    try {
      const r = v === "hydrex" ? await quoteHydrex(amount, stock, pot) : await quote0x(amount, stock, pot);
      const [okT, okS] = await Promise.all([
        pub.readContract({ address: FACTORY, abi: potFactoryAbi, functionName: "isRouter", args: [r.target] }),
        pub.readContract({ address: FACTORY, abi: potFactoryAbi, functionName: "isRouter", args: [r.spender] }),
      ]);
      if (!okT || !okS) {
        log(`  ${r.venue}: router ${r.target} / spender ${r.spender} not allowlisted on the factory, skipping`);
        continue;
      }
      if (r.buyAmount < minOut) {
        log(`  ${r.venue}: quote ${r.buyAmount} below guard ${minOut}, skipping`);
        continue;
      }
      return r;
    } catch (e) {
      log(`  ${v} failed:`, (e as Error).message.slice(0, 200));
    }
  }
  return null;
}

async function tickPot(pot: Address) {
  const c = { address: pot, abi: potAbi } as const;
  const [status, round, members, deadline, stock] = await Promise.all([
    pub.readContract({ ...c, functionName: "status" }),
    pub.readContract({ ...c, functionName: "round" }),
    pub.readContract({ ...c, functionName: "members" }),
    pub.readContract({ ...c, functionName: "roundDeadline" }),
    pub.readContract({ ...c, functionName: "stock" }),
  ]);
  const name = await pub.readContract({ ...c, functionName: "name" });
  log(`pot ${pot} "${name}" status=${status} round=${round}`);

  if (status === 1) {
    const paid = await Promise.all(
      members.map((_, i) => pub.readContract({ ...c, functionName: "paid", args: [round, BigInt(i)] })),
    );
    const pullable = members.some((m, i) => m.hasPermission && !paid[i]);
    if (pullable) await send(pot, "pullAll").catch((e) => log("  pullAll failed", e.shortMessage ?? e.message));

    const paidCount = await pub.readContract({ ...c, functionName: "paidCount", args: [round] });
    const now = BigInt(Math.floor(Date.now() / 1000));
    if (paidCount === BigInt(members.length) || now >= deadline) {
      try {
        // Reverts with StalePrice on weekends / holidays: we simply try again next tick.
        await pub.readContract({ ...c, functionName: "quoteMinOut", args: [1_000_000n] });
        const amount = await pub.readContract({ ...c, functionName: "swapAmount" });
        if (amount > 0n) {
          const minOut = await pub.readContract({ ...c, functionName: "quoteMinOut", args: [amount] });
          const route = await bestRoute(pot, amount, stock, minOut);
          if (!route) {
            log("  no venue beat the price guard; trying again next tick");
          } else {
            log(`  settling via ${route.venue}`);
            await send(pot, "settleRound", [route.target, route.spender, route.data]);
          }
        } else {
          await send(pot, "settleRound", ["0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000", "0x"]);
        }
      } catch (e) {
        log("  settle skipped:", (e as { shortMessage?: string }).shortMessage ?? (e as Error).message);
      }
    }
  }

  // Push withdrawable balances to members (pull-claim stays available if a transfer is blocked).
  const fresh = await pub.readContract({ ...c, functionName: "members" });
  for (const m of fresh) {
    if (m.claimableStock > 0n || m.claimableUsdc > 0n) {
      await send(pot, "claimFor", [m.account]).catch((e) => log("  claimFor failed", m.account, e.shortMessage ?? e.message));
    }
  }
}

async function main() {
  const count = await pub.readContract({ address: FACTORY, abi: potFactoryAbi, functionName: "potCount" });
  log(`keeper ${account.address} · ${count} pots${DRY ? " · dry run" : ""}`);
  for (let i = 0n; i < count; i++) {
    const pot = await pub.readContract({ address: FACTORY, abi: potFactoryAbi, functionName: "allPots", args: [i] });
    const status = await pub.readContract({ address: pot, abi: potAbi, functionName: "status" });
    if (status === 0) continue;
    await tickPot(pot).catch((e) => log(`pot ${pot} error`, e.message));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
