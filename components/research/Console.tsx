"use client";

import { useEffect, useRef, useState } from "react";
import MaskHeadline from "@/components/ui/MaskHeadline";
import { research } from "@/lib/copy";
import type { ClenchEvent } from "@/lib/sense/clench";
import type { DecoderModel } from "@/lib/sense/decoder";
import { PhoneSession } from "@/lib/sense/session";
import { DigitalTwin } from "@/lib/sense/twin";

/**
 * The earbuds as a byte stream. A DigitalTwin plays a real recording as two
 * earbuds would send it: SSP frames, one per Bluetooth notification, each
 * earbud with its own clock, the left one also sending how loud each voice
 * is. Everything after the bytes is lib/sense's PhoneSession, the phone side
 * as it will ship: decode the frames, line the two ears up, run the attention
 * decoder and the clench detector on raw microvolts, weigh head against EEG,
 * and send the earbuds a STEER back. Swap the twin for Bluetooth and none of
 * that changes.
 */

type Bud = "left" | "right";
const BUDS: Bud[] = ["left", "right"];
/** Where the two stories play, degrees, as the data set presented them. */
const AZIMUTHS = [-90, 90];
const TRACE_S = 2;

type Meta = {
  fsRaw: number;
  channels: string[];
  lsbUv: number;
  offsetsUv: number[];
  samples: number;
  leadSamples: number;
  envelopes: [number[], number[]];
  model: DecoderModel;
};

type Snapshot = {
  stats: Record<Bud, { frames: number; lost: number; rate: number; drift: number | null; battery: number | null }>;
  yaw: number | null;
  eeg: { talker: number; margin: number } | null;
  posterior: number[];
  steer: { azimuthDeg: number; gainDb: number } | null;
  events: { kind: ClenchEvent["kind"]; latency: number; id: number }[];
};

const EMPTY: Snapshot = {
  stats: {
    left: { frames: 0, lost: 0, rate: 0, drift: null, battery: null },
    right: { frames: 0, lost: 0, rate: 0, drift: null, battery: null },
  },
  yaw: null,
  eeg: null,
  posterior: [0.5, 0.5],
  steer: null,
  events: [],
};

/**
 * The page's view of a PhoneSession: the last two seconds of each ear for
 * drawing, and clenches timed against the button that caused them.
 */
class Phone {
  readonly session: PhoneSession;
  readonly trace: Record<Bud, Float32Array>;
  readonly traceAt: Record<Bud, number> = { left: 0, right: 0 };
  presses: number[] = [];
  events: Snapshot["events"] = [];
  private eventId = 0;

  constructor(
    model: DecoderModel,
    private readonly twin: DigitalTwin,
    private readonly fs: number,
  ) {
    this.session = new PhoneSession({ fs, perEar: 4, model, azimuths: AZIMUTHS, now: () => twin.time });
    const n = TRACE_S * fs * 4;
    this.trace = { left: new Float32Array(n), right: new Float32Array(n) };
    this.session.onSamples((ear, uv) => {
      const t = this.trace[ear];
      for (const v of uv) t[this.traceAt[ear]++ % t.length] = v;
    });
    this.session.onClench((e) => {
      const at = (this.session.processed / this.fs) * 1000;
      const press = this.presses.filter((p) => p <= at).pop();
      this.events = [{ kind: e.kind, latency: Math.max(0, Math.round(at - (press ?? at))), id: this.eventId++ }, ...this.events].slice(0, 5);
    });
  }

  snapshot(): Snapshot {
    const s = this.session.snapshot();
    const ear = (e: Bud) => ({ frames: s.ears[e].frames, lost: s.ears[e].lost, rate: s.ears[e].rate, drift: s.ears[e].driftPpm, battery: s.ears[e].battery });
    return { stats: { left: ear("left"), right: ear("right") }, yaw: s.yaw, eeg: s.eeg, posterior: s.posterior, steer: this.twin.steering("left"), events: this.events };
  }

  /** Tells both earbuds which direction to bring forward, and by how much. */
  steer(posterior: number[]) {
    this.twin.command("single", this.session.steer(posterior));
  }
}

const fill = (s: string, n: string | number, m?: string | number) => s.replace("{n}", String(n)).replace("{m}", String(m ?? ""));

export default function Console() {
  const c = research.console;
  const [status, setStatus] = useState<"idle" | "loading" | "running" | "error">("idle");
  const [snap, setSnap] = useState<Snapshot>(EMPTY);
  const [yaw, setYaw] = useState(0);
  const run = useRef<{ twin: DigitalTwin; phone: Phone; timer: number; raf: number } | null>(null);
  const canvases = useRef<Record<Bud, HTMLCanvasElement | null>>({ left: null, right: null });

  useEffect(() => () => stop(), []);

  async function start() {
    setStatus("loading");
    try {
      const [meta, buf] = await Promise.all([
        fetch("/research/people/clearest.json").then((r) => {
          if (!r.ok) throw new Error(String(r.status));
          return r.json() as Promise<Meta>;
        }),
        fetch("/research/people/clearest.bin").then((r) => {
          if (!r.ok) throw new Error(String(r.status));
          return r.arrayBuffer();
        }),
      ]);
      const codes = new Int16Array(buf);
      const C = meta.channels.length;
      const data = Array.from({ length: C }, (_, ch) => {
        const out = new Float32Array(meta.samples);
        for (let k = 0; k < meta.samples; k++) out[k] = codes[k * C + ch] * meta.lsbUv + meta.offsetsUv[ch];
        return out;
      });
      // The voices' loudness at 64 Hz over the same span, silent before the stories start.
      const n64 = Math.floor((meta.samples * 64) / meta.fsRaw);
      const lead = Math.round((meta.leadSamples * 64) / meta.fsRaw);
      const audio = meta.envelopes.map((env) => {
        const out = new Float32Array(n64);
        for (let i = 0; i < env.length && lead + i < n64; i++) out[lead + i] = env[i];
        return out;
      });
      const twin = new DigitalTwin({
        recording: { fs: meta.fsRaw, labels: meta.channels, data },
        sides: { left: [0, 1, 2, 3], right: [4, 5, 6, 7] },
        audio: { azimuths: AZIMUTHS, data: audio },
      });
      const phone = new Phone(meta.model, twin, meta.fsRaw);
      twin.start((bytes, side) => phone.session.bytes(bytes, side));
      twin.setYaw(yaw);
      const timer = window.setInterval(() => {
        const s = phone.snapshot();
        phone.steer(s.posterior);
        setSnap(s);
      }, 250);
      const draw = () => {
        for (const bud of BUDS) paint(canvases.current[bud], phone.trace[bud], phone.traceAt[bud]);
        if (run.current) run.current.raf = requestAnimationFrame(draw);
      };
      run.current = { twin, phone, timer, raf: requestAnimationFrame(draw) };
      setStatus("running");
    } catch {
      setStatus("error");
    }
  }

  function stop() {
    const r = run.current;
    if (!r) return;
    r.twin.stop();
    window.clearInterval(r.timer);
    cancelAnimationFrame(r.raf);
    run.current = null;
  }

  function press(kind: "single" | "double" | "hold") {
    const r = run.current;
    if (!r) return;
    r.phone.presses.push(r.twin.time);
    r.twin.clench(kind);
  }

  function turn(deg: number) {
    setYaw(deg);
    run.current?.twin.setYaw(deg);
  }

  const running = status === "running";
  const storyName = [c.leftVoice, c.rightVoice];

  return (
    <div className="border-t border-hairline pt-12">
      <div className="grid12">
        <div className="col-span-12 lg:col-span-5">
          <p className="t-mono text-fog">{c.eyebrow}</p>
          <MaskHeadline as="h3" lines={c.headlineLines} className="t-h2 mt-5" />
          <p className="mt-6 text-body text-mist">{c.body}</p>
          <p className="mt-6 text-small leading-relaxed text-fog">{c.note}</p>
        </div>
        <div className="col-span-12 mt-10 flex flex-col gap-6 lg:col-span-7 lg:mt-0">
          <div className="flex flex-wrap gap-2.5">
            {running ? (
              <button
                type="button"
                className="room-pill"
                onClick={() => {
                  stop();
                  setStatus("idle");
                }}
              >
                {c.stop}
              </button>
            ) : (
              <button type="button" className="room-pill" onClick={() => void start()} disabled={status === "loading"}>
                <span aria-hidden="true" className="room-dot" data-on={running || undefined} />
                {status === "loading" ? c.starting : c.start}
              </button>
            )}
            <button type="button" className="room-pill" disabled={!running} onClick={() => press("single")}>
              {c.clench}
            </button>
            <button type="button" className="room-pill" disabled={!running} onClick={() => press("double")}>
              {c.double}
            </button>
            <button type="button" className="room-pill" disabled={!running} onClick={() => press("hold")}>
              {c.hold}
            </button>
          </div>
          {status === "error" ? <p className="text-small text-mist">{c.error}</p> : null}

          <label className="flex flex-col gap-2">
            <span className="flex justify-between text-small text-mist">
              <span>{c.turn}</span>
              <span className="tabular-nums text-fog">{fill(c.turnValue, yaw > 0 ? `+${yaw}` : yaw)}</span>
            </span>
            <input type="range" min={-90} max={90} step={5} value={yaw} onChange={(e) => turn(Number(e.target.value))} className="research-range" />
          </label>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {BUDS.map((bud) => {
              const st = snap.stats[bud];
              return (
                <div key={bud} className="rounded-[var(--radius-card)] border border-hairline p-4">
                  <p className="flex items-center gap-2 text-small text-paper">
                    <span aria-hidden="true" className="room-dot" data-on={(running && st.frames > 0) || undefined} />
                    {c.sides[bud]}
                  </p>
                  <canvas
                    ref={(el) => {
                      canvases.current[bud] = el;
                    }}
                    aria-hidden="true"
                    className="mt-3 h-16 w-full"
                  />
                  <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-small">
                    <dt className="text-fog">{c.frames}</dt>
                    <dd className="text-right tabular-nums text-mist">{st.frames}</dd>
                    <dt className="text-fog">{c.lost}</dt>
                    <dd className="text-right tabular-nums text-mist">{st.lost}</dd>
                    <dt className="text-fog">{c.rate}</dt>
                    <dd className="text-right tabular-nums text-mist">{st.rate}</dd>
                    <dt className="text-fog">{c.drift}</dt>
                    <dd className="text-right tabular-nums text-mist">{st.drift === null ? "" : fill(c.driftValue, `${st.drift > 0 ? "+" : ""}${st.drift.toFixed(0)}`)}</dd>
                    <dt className="text-fog">{c.battery}</dt>
                    <dd className="text-right tabular-nums text-mist">{st.battery === null ? "" : `${st.battery}%`}</dd>
                  </dl>
                </div>
              );
            })}
          </div>

          <div className="rounded-[var(--radius-card)] border border-hairline p-4">
            <p className="t-mono text-fog">{c.phone}</p>
            <p className="mt-4 text-small text-mist">{c.attention}</p>
            <div className="mt-3 flex flex-col gap-2" aria-live="off">
              {[0, 1].map((k) => (
                <div key={k} className="flex items-center gap-3 text-small">
                  <span className="w-24 shrink-0 text-fog">{storyName[k]}</span>
                  <span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--color-slate)]">
                    <span
                      className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-[240ms]"
                      style={{
                        width: `${Math.round(snap.posterior[k] * 100)}%`,
                        background: snap.posterior[k] >= snap.posterior[1 - k] && running ? "var(--color-signal)" : "var(--color-fog)",
                      }}
                    />
                  </span>
                  <span className="w-10 text-right tabular-nums text-mist">{Math.round(snap.posterior[k] * 100)}%</span>
                </div>
              ))}
            </div>
            <dl className="mt-5 grid grid-cols-1 gap-x-4 gap-y-2 text-small sm:grid-cols-[12rem_1fr]">
              <dt className="text-fog">{c.headYaw}</dt>
              <dd className="tabular-nums text-mist">{snap.yaw === null ? "" : fill(c.turnValue, Math.round(snap.yaw))}</dd>
              <dt className="text-fog">{c.eegVerdict}</dt>
              <dd className="text-mist">{snap.eeg ? storyName[snap.eeg.talker] : running ? c.eegPending : ""}</dd>
              <dt className="text-fog">{c.steering}</dt>
              <dd className="tabular-nums text-mist">
                {snap.steer ? fill(c.steerValue, snap.steer.azimuthDeg, snap.steer.gainDb.toFixed(1)) : c.steerNone}
              </dd>
            </dl>
          </div>

          <div className="flex flex-col gap-2">
            <p className="t-mono text-fog">{c.heard}</p>
            <ul className="flex flex-col gap-1 text-small" aria-live="polite">
              {snap.events.length ? (
                snap.events.map((e) => (
                  <li key={e.id} className="flex justify-between border-b border-hairline py-2">
                    <span className="text-paper">{c.kinds[e.kind]}</span>
                    <span className="tabular-nums text-fog">{fill(c.latency, e.latency)}</span>
                  </li>
                ))
              ) : (
                <li className="py-2 text-fog">{c.none}</li>
              )}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The last two seconds of one earbud's four electrodes, stacked, each scaled to itself. */
function paint(cv: HTMLCanvasElement | null, ring: Float32Array, written: number) {
  if (!cv) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = cv.clientWidth;
  const h = cv.clientHeight;
  if (cv.width !== Math.round(w * dpr)) {
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
  }
  const ctx = cv.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  // Sample major, four values a sample; the newest sample is written / 4 - 1.
  const n = ring.length / 4;
  const total = written / 4;
  const have = Math.min(n, total);
  if (have < 2) return;
  const at = (i: number, ch: number) => ring[((total - have + i) % n) * 4 + ch];
  ctx.strokeStyle = "rgba(255,255,249,0.55)";
  ctx.lineWidth = 1;
  for (let ch = 0; ch < 4; ch++) {
    // Samples lost on the air are NaN: left out of the scale, and a break in the line.
    let mean = 0;
    let count = 0;
    for (let i = 0; i < have; i++) {
      const v = at(i, ch);
      if (Number.isFinite(v)) (mean += v), count++;
    }
    if (count < 2) continue;
    mean /= count;
    let sd = 0;
    for (let i = 0; i < have; i++) {
      const v = at(i, ch);
      if (Number.isFinite(v)) sd += (v - mean) ** 2;
    }
    sd = Math.sqrt(sd / count) || 1;
    const mid = (h / 4) * (ch + 0.5);
    ctx.beginPath();
    let pen = false;
    for (let i = 0; i < have; i++) {
      const v = at(i, ch);
      if (!Number.isFinite(v)) {
        pen = false;
        continue;
      }
      const x = ((i + n - have) / (n - 1)) * w;
      const y = mid - Math.max(-2.5, Math.min(2.5, (v - mean) / sd)) * (h / 12);
      if (pen) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
      pen = true;
    }
    ctx.stroke();
  }
}
