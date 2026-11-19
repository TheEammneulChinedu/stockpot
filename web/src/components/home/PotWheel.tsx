"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LAUNCH_STOCKS } from "@/lib/stocks";
import { money, newMembers, runRound, type RoundResult, type SimMember } from "@/lib/potMath";
import s from "./PotWheel.module.css";

const NAMES = ["Ada", "Bayo", "Chidi", "Dami", "Efe", "Funmi", "Gbenga", "Halima", "Ifeoma", "Jide"];
const VB = 520;
const C = VB / 2;
const R = 182; // seat ring radius
const SEAT = 30;
const ARC_R = 41;
const ARC_L = 2 * Math.PI * ARC_R;

type Phase = "idle" | "flow" | "payout";
type LogEntry = { id: number; lines: string[] };

function seatPos(i: number, n: number) {
  const a = (i / n) * Math.PI * 2 - Math.PI / 2;
  return { x: C + Math.cos(a) * R, y: C + Math.sin(a) * R, deg: (i / n) * 360 };
}

function describe(res: RoundResult, members: SimMember[], ticker: string, n: number, c: number): string[] {
  const who = (i: number) => members[i].name;
  const lines: string[] = [];
  for (const e of res.events) {
    if (e.kind === "skip-covered")
      lines.push(
        e.shortfall > 0
          ? `${who(e.member)} skipped. Only ${money(e.amount)} of frozen ${ticker} was left to cover it.`
          : `${who(e.member)} skipped, so ${money(e.amount)} of ${who(e.member)}'s frozen ${ticker} went into the pot.`,
      );
    if (e.kind === "skip-debt")
      lines.push(`${who(e.member)} skipped before collecting. ${money(e.amount)} will come out of ${who(e.member)}'s own payout.`);
    if (e.kind === "repaid")
      lines.push(`${who(e.member)} repaid ${who(e.creditor)} ${money(e.amount)} in USDC before collecting.`);
  }
  const col = who(res.collector);
  const head = `Round ${res.round + 1}: ${col} collected ${money(res.payout)} of ${ticker}.`;
  const lock =
    res.locked > 0
      ? `${money(res.locked)} stays frozen until ${col} finishes paying. ${money(res.free)} can be withdrawn now.`
      : `Nothing left to owe, so all of it can be withdrawn now.`;
  const lockLine =
    res.locked > 0 && res.free <= 0
      ? `All of it stays frozen until ${col} finishes paying, and melts a slice with every payment.`
      : lock;
  lines.unshift(head, lockLine);
  if (res.round === n - 1) lines.push(`Pot complete. Each member paid ${money(n * c)} in total, and every lock has melted.`);
  return lines;
}

export function PotWheel() {
  const reduce = useReducedMotion();
  const [n, setN] = useState(5);
  const [c, setC] = useState(5);
  const [ticker, setTicker] = useState("NVDAc");
  const [members, setMembers] = useState<SimMember[]>(() => newMembers(NAMES.slice(0, 5)));
  const [round, setRound] = useState(0);
  const [phase, setPhase] = useState<Phase>("idle");
  const [pending, setPending] = useState<{ members: SimMember[]; result: RoundResult } | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const logId = useRef(0);
  const timers = useRef<number[]>([]);

  const finished = round >= n;
  const pot = n * c;
  const seats = useMemo(() => Array.from({ length: n }, (_, i) => seatPos(i, n)), [n]);
  const collector = Math.min(round, n - 1);

  const clearTimers = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  };
  useEffect(() => clearTimers, []);

  const reset = useCallback(
    (nextN = n) => {
      clearTimers();
      setMembers(newMembers(NAMES.slice(0, nextN)));
      setRound(0);
      setPhase("idle");
      setPending(null);
      setLog([]);
    },
    [n],
  );

  const commit = useCallback(
    (next: { members: SimMember[]; result: RoundResult }) => {
      setMembers(next.members);
      setRound((r) => r + 1);
      setPhase("idle");
      setPending(null);
      setLog((l) => [{ id: ++logId.current, lines: describe(next.result, next.members, ticker, n, c) }, ...l].slice(0, 5));
    },
    [ticker, n, c],
  );

  const run = () => {
    if (phase !== "idle") return;
    if (finished) return reset();
    const next = runRound(members, round, c);
    if (reduce) return commit(next);
    setPending(next);
    setPhase("flow");
    timers.current.push(window.setTimeout(() => setPhase("payout"), 950));
    timers.current.push(window.setTimeout(() => commit(next), 1750));
  };

  const toggleSkip = (i: number) => {
    if (phase !== "idle" || finished) return;
    setMembers((ms) => ms.map((m, j) => (j === i ? { ...m, skipNext: !m.skipNext } : m)));
  };

  const changeN = (d: number) => {
    const v = Math.max(3, Math.min(10, n + d));
    if (v === n) return;
    setN(v);
    reset(v);
  };

  const flowEvents = pending?.result.events ?? [];
  const payers = flowEvents.filter((e) => e.kind === "paid").map((e) => e.member);
  const shards = flowEvents.filter((e) => e.kind === "skip-covered" && e.amount > 0).map((e) => e.member);
  const roundPot = members.filter((m) => !m.skipNext).length * c;

  return (
    <div className={s.root}>
      <div className={s.stage}>
        <svg viewBox={`0 0 ${VB} ${VB}`} className={s.svg} role="group" aria-label="Stockpot savings circle demo">
          <defs>
            <radialGradient id="pw-ice" cx="50%" cy="45%" r="60%">
              <stop offset="0%" stopColor="#ffffff" />
              <stop offset="100%" stopColor="#dcebff" />
            </radialGradient>
            <pattern id="pw-frost" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
              <rect width="6" height="6" fill="var(--frost)" />
              <line x1="0" y1="0" x2="0" y2="6" stroke="#ffffff" strokeWidth="2" opacity="0.7" />
            </pattern>
          </defs>

          <circle cx={C} cy={C} r={R} fill="none" stroke="var(--frost-edge)" strokeWidth="1.25" strokeDasharray="2 7" />
          <circle cx={C} cy={C} r={118} fill="url(#pw-ice)" />

          {/* pointer to this round's collector */}
          {!finished && (
            <motion.g
              style={{ transformOrigin: `${C}px ${C}px`, transformBox: "view-box" }}
              animate={{ rotate: seats[collector].deg }}
              transition={{ type: "spring", stiffness: 90, damping: 16 }}
            >
              <path d={`M ${C - 11} ${C - 100} L ${C} ${C - 122} L ${C + 11} ${C - 100} Z`} fill="var(--iris)" />
            </motion.g>
          )}

          {/* centre pot */}
          <motion.g
            animate={phase === "payout" ? { scale: [1, 1.06, 1] } : { scale: 1 }}
            transition={{ duration: 0.5 }}
            style={{ transformOrigin: `${C}px ${C}px`, transformBox: "view-box" }}
          >
            <circle cx={C} cy={C} r={88} fill="var(--snow)" stroke="var(--frost-edge)" strokeWidth="1.5" />
            <text x={C} y={C - 4} textAnchor="middle" className={s.potAmount}>
              {finished ? "Done" : money(phase === "idle" ? roundPot : pending?.result.payout ?? roundPot)}
            </text>
            <text x={C} y={C + 20} textAnchor="middle" className={s.potLabel}>
              {finished ? "every lock melted" : `round ${round + 1} of ${n}`}
            </text>
            <rect x={C - 38} y={C + 34} width={76} height={24} rx={12} fill="var(--iris)" opacity={0.14} />
            <text x={C} y={C + 50.5} textAnchor="middle" className={s.ticker}>
              {ticker}
            </text>
          </motion.g>

          {/* seats */}
          {members.map((m, i) => {
            const p = seats[i];
            const freeFrac = m.collected ? Math.min(1, m.free / pot) : 0;
            const lockFrac = m.collected ? Math.min(1 - freeFrac, m.locked / pot) : 0;
            const isCollector = !finished && i === collector;
            return (
              <g
                key={m.name}
                className={s.seat}
                transform={`translate(${p.x} ${p.y})`}
                onClick={() => toggleSkip(i)}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), toggleSkip(i))}
                tabIndex={0}
                role="button"
                aria-pressed={m.skipNext}
                aria-label={`${m.name}${m.collected ? `, collected, ${money(m.free)} withdrawable, ${money(m.locked)} frozen` : ""}. ${m.skipNext ? "Skipping next payment." : "Press to make them skip the next payment."}`}
              >
                <circle r={ARC_R} fill="none" stroke="var(--line)" strokeWidth="7" />
                <motion.circle
                  r={ARC_R}
                  fill="none"
                  stroke="var(--cobalt)"
                  strokeWidth="7"
                  transform="rotate(-90)"
                  initial={false}
                  animate={{ strokeDasharray: `${freeFrac * ARC_L} ${ARC_L}` }}
                  transition={{ duration: 0.6 }}
                />
                <motion.circle
                  r={ARC_R}
                  fill="none"
                  stroke="url(#pw-frost)"
                  strokeWidth="7"
                  transform={`rotate(${-90 + freeFrac * 360})`}
                  initial={false}
                  animate={{ strokeDasharray: `${lockFrac * ARC_L} ${ARC_L}` }}
                  transition={{ duration: 0.6 }}
                />
                <circle
                  r={SEAT}
                  fill={isCollector ? "#ebe8ff" : "var(--snow)"}
                  stroke={m.skipNext ? "var(--harbor-3)" : isCollector ? "var(--iris)" : "var(--frost-edge)"}
                  strokeWidth={isCollector ? 2 : 1.25}
                  strokeDasharray={m.skipNext ? "4 4" : undefined}
                  opacity={m.skipNext ? 0.6 : 1}
                />
                <text y={6} textAnchor="middle" className={s.initial} opacity={m.skipNext ? 0.5 : 1}>
                  {m.name[0]}
                </text>
                <text y={SEAT + 26} textAnchor="middle" className={s.name}>
                  {m.skipNext ? `${m.name} skips` : m.name}
                </text>
              </g>
            );
          })}

          {/* contributions flowing in, frozen stock seized, payout flowing out */}
          <AnimatePresence>
            {phase === "flow" &&
              payers.map((i, k) => (
                <motion.circle
                  key={`in-${round}-${i}`}
                  r={7}
                  fill="var(--lagoon)"
                  initial={{ cx: seats[i].x, cy: seats[i].y, opacity: 0 }}
                  animate={{ cx: C, cy: C, opacity: [0, 1, 1, 0] }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.7, delay: k * 0.04, ease: "easeIn" }}
                />
              ))}
            {phase === "flow" &&
              shards.map((i) => (
                <motion.rect
                  key={`shard-${round}-${i}`}
                  width={13}
                  height={13}
                  fill="url(#pw-frost)"
                  stroke="var(--frost-edge)"
                  initial={{ x: seats[i].x - 6, y: seats[i].y - 6, rotate: 0, opacity: 0 }}
                  animate={{ x: C - 6, y: C - 6, rotate: 180, opacity: [0, 1, 1, 0] }}
                  transition={{ duration: 0.85, ease: "easeInOut" }}
                />
              ))}
            {phase === "payout" && (
              <motion.g
                key={`out-${round}`}
                initial={{ x: C, y: C, opacity: 0, scale: 0.6 }}
                animate={{ x: seats[collector].x, y: seats[collector].y, opacity: [0, 1, 1, 0], scale: 1 }}
                transition={{ duration: 0.75, ease: "easeOut" }}
              >
                <rect x={-34} y={-13} width={68} height={26} rx={13} fill="var(--iris)" />
                <text y={5} textAnchor="middle" className={s.chip}>
                  {ticker}
                </text>
              </motion.g>
            )}
          </AnimatePresence>
        </svg>

        <ul className={s.legend} aria-label="Legend">
          <li>
            <i style={{ background: "var(--lagoon)" }} /> Paying in
          </li>
          <li>
            <i style={{ background: "var(--cobalt)" }} /> Withdrawable stock
          </li>
          <li>
            <i className={s.frostSwatch} /> Frozen as collateral
          </li>
        </ul>
      </div>

      <div className={s.panel}>
        <div className={s.controls}>
          <div className={s.control}>
            <span className={s.controlLabel} id="pw-members">
              Members
            </span>
            <div className={s.stepper} role="group" aria-labelledby="pw-members">
              <button onClick={() => changeN(-1)} aria-label="Fewer members" disabled={n <= 3}>
                −
              </button>
              <output aria-live="polite">{n}</output>
              <button onClick={() => changeN(1)} aria-label="More members" disabled={n >= 10}>
                +
              </button>
            </div>
          </div>
          <label className={s.control}>
            <span className={s.controlLabel}>Each round</span>
            <span className={s.rangeRow}>
              <input
                type="range"
                min={1}
                max={25}
                value={c}
                onChange={(e) => {
                  setC(Number(e.target.value));
                  reset();
                }}
              />
              <output className={s.rangeValue}>{money(c)}</output>
            </span>
          </label>
          <div className={s.control}>
            <span className={s.controlLabel} id="pw-stock">
              Pays out in
            </span>
            <div className={s.tickers} role="radiogroup" aria-labelledby="pw-stock">
              {LAUNCH_STOCKS.slice(0, 5).map((st) => (
                <label key={st.ticker} className={s.tickerOpt} data-on={st.ticker === ticker}>
                  <input
                    type="radio"
                    name="pw-ticker"
                    value={st.ticker}
                    checked={st.ticker === ticker}
                    onChange={() => setTicker(st.ticker)}
                    className="visually-hidden"
                  />
                  {st.company}
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className={s.actions}>
          <button className="btn btn-primary" onClick={run} disabled={phase !== "idle"}>
            {finished ? "Run it again" : `Run round ${round + 1}`}
          </button>
          {round > 0 && !finished && (
            <button className="btn btn-ghost" onClick={() => reset()} disabled={phase !== "idle"}>
              Reset
            </button>
          )}
        </div>
        <p className={s.hint}>Tap a member to make them skip the next payment, then see what happens.</p>

        <ol className={s.log} aria-live="polite">
          {log.length === 0 && (
            <li className={s.logEmpty}>
              {n} friends, {money(c)} each round. Every round one of them collects {money(pot)} of {ticker}.
            </li>
          )}
          <AnimatePresence initial={false}>
            {log.map((e) => (
              <motion.li
                key={e.id}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                transition={{ duration: 0.3 }}
                className={s.logItem}
              >
                {e.lines.map((l, k) => (
                  <p key={k} className={k === 0 ? s.logHead : undefined}>
                    {l}
                  </p>
                ))}
              </motion.li>
            ))}
          </AnimatePresence>
        </ol>
      </div>
    </div>
  );
}
