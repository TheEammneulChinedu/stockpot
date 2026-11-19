"use client";

import { motion } from "motion/react";
import { useState } from "react";
import { lockFor, money } from "@/lib/potMath";
import s from "./LockExplainer.module.css";

const N = 5;
const C = 5;
const POT = N * C;
const BAR_H = 132;

export function LockExplainer() {
  const [turn, setTurn] = useState(0); // 0-based round you collect in
  const locked = lockFor(turn, N, C);
  const free = POT - locked;
  const remaining = N - 1 - turn;
  const tranche = remaining > 0 ? locked / remaining : 0;
  const frozenAfter = (j: number) => (j < turn ? null : j === N - 1 ? 0 : locked - tranche * (j - turn));

  return (
    <section className={s.section} id="lock" aria-labelledby="lock-title">
      <div className={`wrap ${s.grid}`}>
        <div className={s.copy}>
          <h2 id="lock-title">The stock you collect is your collateral.</h2>
          <p>
            In a normal ajo, the risk is someone collecting early and then disappearing. In Stockpot, part of your
            payout stays frozen in the pot until you have paid in everything you owe.
          </p>
          <p>
            Each payment you make melts a slice of it. If you skip a round after collecting, that round&apos;s
            collector gets your frozen stock instead. Nobody has to chase anyone.
          </p>
          <p className={s.small}>
            Frozen amount = what you still owe × 1.25, so a price dip doesn&apos;t leave the pot short. It can never be
            more than your payout.
          </p>
        </div>

        <div className={s.demo}>
          <div className={s.demoHead}>
            <p>
              A pot of {N} people, {money(C)} each round
            </p>
            <div className={s.turns} role="radiogroup" aria-label="Round you collect in">
              {Array.from({ length: N }, (_, i) => (
                <button
                  key={i}
                  role="radio"
                  aria-checked={turn === i}
                  data-on={turn === i}
                  onClick={() => setTurn(i)}
                >
                  {i + 1}
                </button>
              ))}
            </div>
            <p className={s.turnLabel}>You collect in round {turn + 1}</p>
          </div>

          <div className={s.payout} aria-label={`Payout ${money(POT)}: ${money(free)} withdrawable now, ${money(locked)} frozen`}>
            <motion.div className={s.free} style={{ paddingInline: free > 0 ? 14 : 0 }} animate={{ flexGrow: free }} initial={false} transition={{ type: "spring", stiffness: 140, damping: 20 }}>
              {free > 0 && <span>{money(free)} yours now</span>}
            </motion.div>
            <motion.div className={s.locked} style={{ paddingInline: locked > 0 ? 14 : 0, borderLeft: free > 0 && locked > 0 ? "3px solid var(--snow)" : "none" }} animate={{ flexGrow: locked }} initial={false} transition={{ type: "spring", stiffness: 140, damping: 20 }}>
              {locked > 0 && <span>{money(locked)} frozen</span>}
            </motion.div>
          </div>

          <div className={s.thaw}>
            <p className={s.thawTitle}>Still frozen after each round</p>
            <div className={s.cols}>
              {Array.from({ length: N }, (_, j) => {
                const v = frozenAfter(j);
                return (
                  <div key={j} className={s.col}>
                    <div className={s.well} style={{ height: BAR_H }}>
                      {v === null ? (
                        <span className={s.paying}>paying in</span>
                      ) : (
                        <motion.div
                          className={s.ice}
                          initial={false}
                          animate={{ height: (v / POT) * BAR_H }}
                          transition={{ type: "spring", stiffness: 120, damping: 18 }}
                        />
                      )}
                    </div>
                    <span className={s.colValue}>{v === null ? "" : money(v)}</span>
                    <span className={s.colRound} data-you={j === turn}>
                      {j === turn ? "You collect" : `Round ${j + 1}`}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
