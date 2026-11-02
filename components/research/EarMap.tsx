/**
 * Where the electrodes sit on a cEEGrid, the arc around each ear used in the
 * recordings, seen from the side: the face is toward the outer edge of each
 * panel. Positions are the data set's own coordinates (electrodes.tsv, x
 * forward, z up); the filled ones are the four per ear the decoder leaned on
 * most. Server rendered, no script.
 */

const POS: Record<string, [number, number]> = {
  "01": [0.3, -0.21],
  "02": [0.16, -0.03],
  "03": [-0.16, -0.03],
  "04": [-0.3, -0.21],
  "04a": [-0.31, -0.33],
  "04b": [-0.3, -0.42],
  "05": [-0.26, -0.53],
  "06": [-0.12, -0.67],
  "07": [0.12, -0.67],
  "08": [0.26, -0.53],
};

const LEFT = ["01", "02", "03", "04", "04a", "04b", "05", "06", "07", "08"];
const RIGHT = ["01", "02", "03", "04", "05", "06", "07", "08"];

/** viewBox units per data set unit, and the ring's centre in the panel. */
const S = 210;
const CX = 100;
const CY = 26;

function Ear({ side, chosen, label }: { side: "L" | "R"; chosen: string[]; label: string }) {
  const ids = side === "L" ? LEFT : RIGHT;
  // Seen from the left the face points left, seen from the right it points right.
  const flip = side === "L" ? -1 : 1;
  return (
    <figure className="m-0 flex flex-col items-center gap-3">
      <svg viewBox="0 0 200 190" className="ear-map w-full max-w-[220px]" role="img" aria-label={label}>
        {/* A plain ear outline inside the ring, for orientation only. */}
        <path
          className="ear-outline"
          transform={`translate(100 92) scale(${flip} 1)`}
          d="M-14 -38 C 12 -46, 30 -26, 26 0 C 23 20, 10 26, 6 40 C 3 50, -10 52, -14 44 C -20 32, -26 18, -24 -6 C -23 -22, -22 -34, -14 -38 Z M -6 -22 C 8 -26, 14 -10, 8 4 C 4 12, -2 12, -4 20"
        />
        {ids.map((id) => {
          const [x, z] = POS[id];
          const on = chosen.includes(`${side}${id}`);
          return (
            <circle key={id} cx={CX + flip * x * S} cy={CY - z * S} r={on ? 7.5 : 6} data-on={on || undefined}>
              <title>{`${side}${id}`}</title>
            </circle>
          );
        })}
      </svg>
      <figcaption className="t-mono text-fog">{label}</figcaption>
    </figure>
  );
}

export default function EarMap({ left, right, leftLabel, rightLabel }: { left: string[]; right: string[]; leftLabel: string; rightLabel: string }) {
  return (
    <div className="grid grid-cols-2 gap-6">
      <Ear side="L" chosen={left} label={leftLabel} />
      <Ear side="R" chosen={right} label={rightLabel} />
    </div>
  );
}
