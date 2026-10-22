/**
 * A band of hairline bars, like a waveform seen from far away. One stretch is
 * amber: in the brand, amber marks the voice being attended to. Static markup
 * with a CSS breathing animation on the amber bars only, so it costs nothing
 * and stops entirely for reduced motion.
 */

const BARS = 112;
const ATTENDED = [46, 66] as const;

function height(i: number): number {
  // Deterministic envelope: two slow sines plus a hash for texture.
  const h = Math.sin(i * 0.19) * 0.35 + Math.sin(i * 0.051 + 1.3) * 0.4 + ((i * 2654435761) % 97) / 97 * 0.45;
  const inside = i >= ATTENDED[0] && i <= ATTENDED[1];
  return Math.max(0.08, Math.min(1, Math.abs(h) * (inside ? 1.25 : 0.7)));
}

export function SignalBand() {
  return (
    <div aria-hidden="true" className="relative h-24 w-full overflow-hidden sm:h-28">
      <style>{`
        @keyframes breathe { 0%,100% { transform: scaleY(1) } 50% { transform: scaleY(0.62) } }
        .sb-on { animation: breathe 2.4s ease-in-out infinite; transform-origin: center; }
        @media (prefers-reduced-motion: reduce) { .sb-on { animation: none } }
      `}</style>
      <svg viewBox={`0 0 ${BARS * 6} 100`} preserveAspectRatio="none" className="h-full w-full">
        {Array.from({ length: BARS }, (_, i) => {
          const h = height(i) * 92;
          const on = i >= ATTENDED[0] && i <= ATTENDED[1];
          return (
            <rect
              key={i}
              x={i * 6 + 2}
              y={50 - h / 2}
              width={1.6}
              height={h}
              rx={0.8}
              className={on ? "sb-on" : undefined}
              style={on ? { animationDelay: `${(i - ATTENDED[0]) * 70}ms` } : undefined}
              fill={on ? "var(--color-signal)" : "var(--color-fog)"}
              fillOpacity={on ? 1 : 0.32}
            />
          );
        })}
      </svg>
    </div>
  );
}
