// stockpot skill: zero-dependency chain access for Base (chain 8453).
// Raw JSON-RPC over fetch (node >= 18) with RPC fallback, a tiny ABI encoder/decoder for exactly the
// calls Stockpot needs, and unsigned-transaction builders. Nothing here signs or holds keys.

import { randomBytes } from "node:crypto";

export const CHAIN_ID = 8453;
export const APP = "https://usestockpot.vercel.app";
export const FACTORY = "0x7Dfcb2Ca510afE1766D63c2CA6EE67C6e7Be1313";
export const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // 6 decimals
export const RPCS = [
  ...(process.env.STOCKPOT_RPC ? [process.env.STOCKPOT_RPC] : []),
  "https://mainnet.base.org",
  "https://base-rpc.publicnode.com",
  "https://base.llamarpc.com",
  "https://base.drpc.org",
];

/**
 * Stocks a pot can pay out in. Only these four have Aerodrome USDC pools the Stockpot keeper buys
 * from; a pot in any other stock would never settle, so the scripts refuse it.
 */
export const STOCKS = {
  NVDA: { ticker: "NVDAc", company: "NVIDIA", address: "0xb20000000000000000000078ee7ce2fE4908108C" },
  AAPL: { ticker: "AAPLc", company: "Apple", address: "0xb200000000000000000000C2e324d24d7eEcd1fb" },
  META: { ticker: "METAc", company: "Meta", address: "0xb2000000000000000000008bC8786B856E61707C" },
  GOOGL: { ticker: "GOOGLc", company: "Alphabet", address: "0xb2000000000000000000002D0BA3164cc74f58B7" },
};
export const STOCK_DECIMALS = 8;

export const LIMITS = { minMembers: 3, maxMembers: 10, minUsd: 1, maxUsd: 25, nameMax: 48 };
export const RHYTHMS = { daily: 86_400, weekly: 604_800 };
export const STATUS = ["open", "active", "finished"];

export const SEL = {
  potCount: "0xcf72f230",
  allPots: "0xbae7262a",
  predictPotAddress: "0x25eb4b39",
  createPot: "0x3291878c",
  name: "0x06fdde03",
  stock: "0xbdf3c4ae",
  contribution: "0x50520b1f",
  maxMembers: "0xbf4386a0",
  memberCount: "0x11aee380",
  captain: "0xf55ebb8f",
  status: "0x200d2ed2",
  round: "0x146ca531",
  interval: "0x947a36fb",
  startTime: "0x78e97925",
  roundDeadline: "0xaf8532e3",
  members: "0xbdd4d18d",
  indexPlusOne: "0x80cb5491",
  paid: "0x8d42394d",
  paidCount: "0x32651b81",
  join: "0xb688a363",
  contribute: "0xd7bb99ba",
  claim: "0x4e71d92d",
  allowance: "0xdd62ed3e",
  balanceOf: "0x70a08231",
  approve: "0x095ea7b3",
};

// ---------- words ----------

export const strip0x = (h) => (h.startsWith("0x") ? h.slice(2) : h);
export const word = (hexNo0x) => hexNo0x.padStart(64, "0");
export const addrWord = (a) => word(strip0x(a).toLowerCase());
export const uintWord = (v) => word(BigInt(v).toString(16));
const wordAt = (d, i) => d.slice(i * 64, (i + 1) * 64);
const big = (w) => (w ? BigInt("0x" + w) : 0n);
const addr = (w) => "0x" + w.slice(24);

export function isAddress(a) {
  return typeof a === "string" && /^0x[0-9a-fA-F]{40}$/.test(a);
}

/** UTF-8 string as an ABI dynamic value: length word + right-padded data. */
function stringTail(s) {
  const hex = Buffer.from(s, "utf8").toString("hex");
  const len = hex.length / 2;
  const padded = hex.padEnd(Math.ceil(hex.length / 64) * 64 || 0, "0");
  return uintWord(len) + padded;
}

/** PotParams (string name, address stock, uint256 contribution, uint256 maxMembers, uint256 interval). */
function potParams(p) {
  return uintWord(5 * 32) + addrWord(p.stock) + uintWord(p.contribution) + uintWord(p.maxMembers) + uintWord(p.interval) + stringTail(p.name);
}

/** Empty SpendPermission (account = 0 means "pay each round manually") with empty extraData. */
function emptyPermission() {
  return uintWord(0).repeat(8) + uintWord(9 * 32) + uintWord(0);
}

export function encodeCreatePot(p, salt) {
  const params = potParams(p);
  const perm = emptyPermission();
  const offParams = 4 * 32;
  const offPerm = offParams + params.length / 2;
  const offSig = offPerm + perm.length / 2;
  return SEL.createPot + uintWord(offParams) + word(strip0x(salt)) + uintWord(offPerm) + uintWord(offSig) + params + perm + uintWord(0);
}

export function encodePredict(captain, p, salt) {
  return SEL.predictPotAddress + addrWord(captain) + uintWord(3 * 32) + word(strip0x(salt)) + potParams(p);
}

export const randomSalt = () => "0x" + randomBytes(32).toString("hex");

// ---------- RPC ----------

let rpcIndex = 0;
export async function rpc(method, params) {
  let lastErr;
  for (let attempt = 0; attempt < RPCS.length; attempt++) {
    const url = RPCS[(rpcIndex + attempt) % RPCS.length];
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(12_000),
      });
      const j = await res.json();
      if (j.error) {
        // A revert is an answer, not an RPC failure: don't fall through to other RPCs.
        const e = new Error(j.error.message || "rpc error");
        e.revert = true;
        e.data = j.error.data;
        throw e;
      }
      rpcIndex = (rpcIndex + attempt) % RPCS.length;
      return j.result;
    } catch (e) {
      if (e.revert) throw e;
      lastErr = e;
    }
  }
  throw new Error(`all Base RPCs failed: ${lastErr?.message}`);
}

export const call = (to, data, from) =>
  rpc("eth_call", [{ to, data, ...(from ? { from } : {}) }, "latest"]).then(strip0x);

export const ethBalance = async (a) => BigInt(await rpc("eth_getBalance", [a, "latest"]));

// ---------- typed reads ----------

export const readUint = async (to, data) => big(wordAt(await call(to, data), 0));
export const readAddr = async (to, data) => addr(wordAt(await call(to, data), 0));
export const readBool = async (to, data) => big(wordAt(await call(to, data), 0)) !== 0n;
export async function readString(to, data) {
  const d = await call(to, data);
  const off = Number(big(wordAt(d, 0))) / 32;
  const len = Number(big(wordAt(d, off)));
  return Buffer.from(d.slice((off + 1) * 64, (off + 1) * 64 + len * 2), "hex").toString("utf8");
}

/** members(): Member[] with 8 static fields each. */
export async function readMembers(pot) {
  const d = await call(pot, SEL.members);
  const off = Number(big(wordAt(d, 0))) / 32;
  const n = Number(big(wordAt(d, off)));
  const out = [];
  for (let i = 0; i < n; i++) {
    const b = off + 1 + i * 8;
    out.push({
      account: addr(wordAt(d, b)),
      collected: big(wordAt(d, b + 1)) !== 0n,
      hasPermission: big(wordAt(d, b + 2)) !== 0n,
      lockRoundsLeft: Number(big(wordAt(d, b + 3))),
      locked: big(wordAt(d, b + 4)),
      claimableStock: big(wordAt(d, b + 5)),
      claimableUsdc: big(wordAt(d, b + 6)),
      debt: big(wordAt(d, b + 7)),
    });
  }
  return out;
}

export async function readPot(pot) {
  const [name, stock, contribution, maxMembers, captain, status, round, interval, members] = await Promise.all([
    readString(pot, SEL.name),
    readAddr(pot, SEL.stock),
    readUint(pot, SEL.contribution),
    readUint(pot, SEL.maxMembers),
    readAddr(pot, SEL.captain),
    readUint(pot, SEL.status),
    readUint(pot, SEL.round),
    readUint(pot, SEL.interval),
    readMembers(pot),
  ]);
  const st = Number(status);
  let deadline = 0n;
  let paidFlags = [];
  if (st === 1) {
    [deadline, paidFlags] = await Promise.all([
      readUint(pot, SEL.roundDeadline),
      Promise.all(members.map((_, i) => readBool(pot, SEL.paid + uintWord(round) + uintWord(i)))),
    ]);
  }
  return { pot, name, stock, contribution, maxMembers: Number(maxMembers), captain, status: st, round: Number(round), interval: Number(interval), members, deadline, paidFlags };
}

export const stockMeta = (address) =>
  Object.values(STOCKS).find((s) => s.address.toLowerCase() === address.toLowerCase()) ?? { ticker: "stock", company: "stock", address };

// ---------- formatting ----------

export const usd = (raw6) => `$${(Number(raw6) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
export const shares = (raw8) => (Number(raw8) / 10 ** STOCK_DECIMALS).toLocaleString("en-US", { maximumFractionDigits: 6 });
export const link = (pot) => `${APP}/pot/?address=${pot}`;
export const sameAddr = (a, b) => a.toLowerCase() === b.toLowerCase();

export function when(unixSeconds) {
  const d = new Date(Number(unixSeconds) * 1000);
  return d.toUTCString().replace(" GMT", " UTC");
}

export const tx = (to, data, label) => ({ to, data, value: "0", chainId: CHAIN_ID, label });

// ---------- CLI ----------

export function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
      out[k] = v;
    } else out._.push(a);
  }
  return out;
}

export function done(obj, code = 0) {
  process.stdout.write(JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2) + "\n");
  process.exit(code);
}

export const fail = (gate, detail, extra = {}) => done({ ok: false, gate, detail, ...extra }, 1);

/** Turn a revert into a readable reason using Stockpot's custom errors. */
const ERRORS = {
  "0x8b0b1e7f": "OnlyCaptain",
  "0xddafad98": "NotOpen",
  "0x80cb55e2": "NotActive",
  "0xf36efb6f": "Full",
  "0x810074be": "AlreadyMember",
  "0x291fc442": "NotMember",
  "0xd70a0e30": "AlreadyPaid",
  "0x151f0f6a": "RoundNotDue",
  "0x90b8ec18": "TransferFailed",
  "0xdfdfd905": "TooFewMembers",
  "0x46ec278b": "StockNotSupported",
  "0x019af637": "BadParams",
};
export function revertReason(e) {
  const data = typeof e?.data === "string" ? e.data : e?.data?.data;
  const sel = typeof data === "string" ? data.slice(0, 10).toLowerCase() : "";
  if (ERRORS[sel]) return ERRORS[sel];
  return String(e?.message || e).slice(0, 160);
}
