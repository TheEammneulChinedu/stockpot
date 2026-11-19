import Link from "next/link";
import { PotWheel } from "@/components/home/PotWheel";
import { LockExplainer } from "@/components/home/LockExplainer";
import { StockStrip } from "@/components/home/StockStrip";
import s from "./page.module.css";

const STEPS = [
  {
    title: "Start a pot",
    body: "Pick 3 to 10 people, an amount from $1 to $25, and the stock it pays out in. You collect first.",
  },
  {
    title: "Drop the link in your group",
    body: "Share it on WhatsApp, X or the Base app. Members join with a passkey. No seed phrase, no gas.",
  },
  {
    title: "Pay without thinking about it",
    body: "One approval covers every round. Contributions are collected each weekday while US markets are open.",
  },
  {
    title: "Collect your turn",
    body: "The pot buys the stock at a fair price and it lands in your wallet, with part frozen until you finish paying.",
  },
];

const FAQ = [
  {
    q: "What do I actually own?",
    a: "Coinbase Tokenized Stocks: tokens on Base backed 1:1 by real shares held in regulated custody. They follow the share price and dividends, but they do not give you voting rights.",
  },
  {
    q: "Who can join a pot?",
    a: "Anyone 18 or older in a country where Coinbase tokenized stocks are offered. That excludes the United States and sanctioned countries.",
  },
  {
    q: "What if someone stops paying?",
    a: "If they already collected, their frozen stock pays their share. If they haven't collected yet, what they missed is taken out of their own payout and given to whoever was short.",
  },
  {
    q: "Who holds the money?",
    a: "Each pot is its own smart contract on Base. Nobody, including us, can move funds out of it except to members by the pot's rules. During the beta, pots are capped at $25 a round and 10 members.",
  },
  {
    q: "What does it cost?",
    a: "Nothing during the beta. You pay the swap's normal trading cost, and the pot refuses any trade more than 1% worse than the Chainlink reference price.",
  },
  {
    q: "Can the stock go down?",
    a: "Yes. You are buying shares, and their price moves. Only put in what you are comfortable holding in stocks.",
  },
];

export default function Home() {
  return (
    <>
      <section className={s.hero} aria-labelledby="hero-title">
        <div className={`wrap ${s.heroTop}`}>
          <h1 id="hero-title" className={s.headline}>
            Your ajo, paid out in real stocks.
          </h1>
          <div className={s.heroAside}>
            <p className={s.lede}>
              Save with your people, a few dollars a round. Each round one of you collects the whole pot as NVIDIA,
              Apple or Tesla stock on Base.
            </p>
            <div className={s.ctas}>
              <Link href="/start" className="btn btn-primary">
                Start a pot
              </Link>
              <a href="#lock" className="btn btn-ghost">
                How the lock works
              </a>
            </div>
          </div>
        </div>
        <div className={`wrap ${s.demo}`}>
          <PotWheel />
        </div>
      </section>

      <LockExplainer />

      <section className={s.how} id="how" aria-labelledby="how-title">
        <div className="wrap">
          <h2 id="how-title" className={s.sectionTitle}>
            How a pot runs
          </h2>
          <ol className={s.steps}>
            {STEPS.map((st, i) => (
              <li key={st.title} className={s.step}>
                <span className={s.stepNum} aria-hidden="true">
                  {i + 1}
                </span>
                <h3>{st.title}</h3>
                <p>{st.body}</p>
              </li>
            ))}
          </ol>
          <p className={s.aside}>
            Sprint pots run one round per weekday, so a 5-person pot finishes in a week. Ajo, esusu, susu, chama, tanda,
            tontine, stokvel: same circle, new payout.
          </p>
        </div>
      </section>

      <StockStrip />

      <section className={s.faq} aria-labelledby="faq-title">
        <div className={`wrap ${s.faqGrid}`}>
          <h2 id="faq-title" className={s.sectionTitle}>
            Questions people ask in the group chat
          </h2>
          <div className={s.faqList}>
            {FAQ.map((f) => (
              <details key={f.q} className={s.qa}>
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className={s.cta} aria-labelledby="cta-title">
        <div className={`wrap ${s.ctaRow}`}>
          <h2 id="cta-title">Whose turn is it this week?</h2>
          <Link href="/start" className={`btn ${s.ctaBtn}`}>
            Start a pot
          </Link>
        </div>
      </section>
    </>
  );
}
