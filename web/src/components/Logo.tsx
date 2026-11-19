/** A circle of seats with one member collecting: the whole idea in a mark. */
export function LogoMark({ size = 28 }: { size?: number }) {
  const seats = Array.from({ length: 6 }, (_, i) => {
    const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
    return { x: 16 + Math.cos(a) * 11, y: 16 + Math.sin(a) * 11 };
  });
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="11" fill="none" stroke="var(--frost-edge)" strokeWidth="1.5" />
      <circle cx="16" cy="16" r="4.5" fill="var(--cobalt)" />
      {seats.map((s, i) => (
        <circle key={i} cx={s.x} cy={s.y} r={i === 0 ? 3.6 : 2.6} fill={i === 0 ? "var(--iris)" : "var(--harbor)"} />
      ))}
    </svg>
  );
}

export function Wordmark() {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
      <LogoMark />
      <span style={{ fontFamily: "var(--font-display)", fontWeight: 650, fontSize: 19, letterSpacing: "-0.02em" }}>
        stockpot
      </span>
    </span>
  );
}
