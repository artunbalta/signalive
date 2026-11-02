import { describe, expect, it } from "vitest";
import fixture from "./__fixtures__/decoder.json";
import { AttentionDecoder, type DecoderModel } from "./decoder";
import { butterBandpass, LinearResampler, SosFilter } from "./dsp";

const TOL = 1e-9;

/** The fixture's decoder: identity montage, unit scale, features fed directly. */
function fixtureModel(): DecoderModel {
  const C = fixture.channels;
  return {
    version: 1,
    fsRaw: 500,
    fs: 64,
    inputs: Array.from({ length: C }, (_, c) => `ch${c}`),
    sosRaw: butterBandpass(2, [1, 9], 500),
    sosEnv: butterBandpass(2, [1, 9], 64),
    montage: Array.from({ length: C }, (_, r) => Array.from({ length: C }, (_, c) => (r === c ? 1 : 0))),
    scale: new Array(C).fill(1),
    lags: fixture.lags,
    weights: fixture.weights,
  };
}

function feedFixture(dec: AttentionDecoder) {
  const { eeg, envelopes } = fixture;
  const frame = new Float64Array(fixture.channels);
  for (let t = 0; t < eeg[0].length; t++) {
    for (let c = 0; c < frame.length; c++) frame[c] = eeg[c][t];
    dec.pushFeatures(frame);
  }
  envelopes.forEach((env, s) => env.forEach((v) => dec.pushEnvelope(s, v, true)));
}

function maxAbs(a: ArrayLike<number>, b: ArrayLike<number>) {
  let worst = 0;
  for (let i = 0; i < b.length; i++) worst = Math.max(worst, Math.abs(a[i] - b[i]));
  return worst;
}

describe("AttentionDecoder against the reference chain", () => {
  it("reconstructs the envelope exactly as lagged(eeg) @ w", () => {
    const dec = new AttentionDecoder(fixtureModel(), 2);
    feedFixture(dec);
    // recon[t] exists once feature t + lags - 1 does.
    expect(dec.count).toBe(fixture.eeg[0].length - fixture.lags + 1);
    const { recon } = dec.recent(dec.count);
    expect(maxAbs(recon, fixture.recon)).toBeLessThan(TOL);
  });

  it("reproduces window_correlations over every fixture window", () => {
    const dec = new AttentionDecoder(fixtureModel(), 2);
    feedFixture(dec);
    const win = fixture.window;
    fixture.correlations.forEach((expected, w) => {
      const d = dec.decideRange(w * win, win);
      expect(d).not.toBeNull();
      expect(maxAbs(d!.r, expected)).toBeLessThan(TOL);
      const best = expected[0] >= expected[1] ? 0 : 1;
      expect(d!.talker).toBe(best);
      expect(d!.margin).toBeCloseTo(Math.abs(expected[0] - expected[1]), 9);
      expect(d!.end).toBe((w + 1) * win);
    });
  });

  it("decides over the newest window where every stream exists", () => {
    const dec = new AttentionDecoder(fixtureModel(), 2);
    feedFixture(dec);
    // Envelopes end at 640, the reconstruction at 641: the window ends at 640.
    const d = dec.decide(fixture.window / 64);
    expect(d).not.toBeNull();
    expect(d!.end).toBe(640);
    const expected = fixture.correlations[fixture.correlations.length - 1];
    expect(maxAbs(d!.r, expected)).toBeLessThan(TOL);
  });

  it("returns null until a window is complete, and for windows it no longer keeps", () => {
    const dec = new AttentionDecoder(fixtureModel(), 2, { historySeconds: 4 });
    expect(dec.decide(2)).toBeNull();
    feedFixture(dec);
    expect(dec.capacity).toBe(256);
    expect(dec.decideRange(0, 128)).toBeNull();
    // 641 reconstruction samples, 256 kept: the oldest is 385.
    expect(dec.decideRange(384, 128)).toBeNull();
    expect(dec.decideRange(385, 128)).not.toBeNull();
    expect(dec.decideRange(600, 128)).toBeNull();
    expect(dec.decide(5)).toBeNull();
    // Kept samples are still exact after the ring has wrapped.
    const d = dec.decideRange(512, 128)!;
    expect(maxAbs(d.r, fixture.correlations[4])).toBeLessThan(TOL);
    const { recon, envelopes, end } = dec.recent(1000);
    expect(end).toBe(641);
    expect(recon.length).toBe(256);
    expect(maxAbs(recon.subarray(0, 255), fixture.recon.slice(641 - 256))).toBeLessThan(TOL);
    // The envelopes stop at 640: the newest reconstruction sample has none yet.
    expect(Number.isNaN(envelopes[0][255])).toBe(true);
    expect(envelopes[1][254]).toBeCloseTo(fixture.envelopes[1][639], 12);
  });

  it("starts over after reset", () => {
    const dec = new AttentionDecoder(fixtureModel(), 2);
    feedFixture(dec);
    dec.reset();
    expect(dec.count).toBe(0);
    expect(dec.decide(1)).toBeNull();
    feedFixture(dec);
    expect(maxAbs(dec.decideRange(0, 128)!.r, fixture.correlations[0])).toBeLessThan(TOL);
  });
});

describe("AttentionDecoder decisions", () => {
  it("ranks three talkers and reports the margin over the runner up", () => {
    const model = { ...fixtureModel(), lags: 1, weights: fixture.weights.map((w) => [w[0]]) };
    const dec = new AttentionDecoder(model, 3);
    const n = 256;
    const recon: number[] = [];
    for (let t = 0; t < n; t++) {
      const x = Math.sin(t / 5) + 0.3 * Math.sin(t / 1.7);
      dec.pushFeatures([x / model.weights[0][0], 0, 0, 0]);
      recon.push(x);
    }
    recon.forEach((x, t) => {
      dec.pushEnvelope(0, Math.cos(t / 3), true);
      dec.pushEnvelope(1, x + 0.5 * Math.sin(t * 1.3), true);
      dec.pushEnvelope(2, x + 0.1 * Math.sin(t * 1.3), true);
    });
    const d = dec.decide(4)!;
    expect(d.talker).toBe(2);
    expect(d.r[2]).toBeGreaterThan(d.r[1]);
    expect(d.r[1]).toBeGreaterThan(d.r[0]);
    expect(d.margin).toBeCloseTo(d.r[2] - d.r[1], 12);
  });

  it("rejects envelopes for talkers it does not have", () => {
    const dec = new AttentionDecoder(fixtureModel(), 2);
    expect(() => dec.pushEnvelope(2, 0)).toThrow(RangeError);
    expect(() => dec.pushEnvelope(-1, 0)).toThrow(RangeError);
  });

  it("rejects models whose shapes disagree", () => {
    expect(() => new AttentionDecoder({ ...fixtureModel(), scale: [1] }, 2)).toThrow(RangeError);
    expect(() => new AttentionDecoder({ ...fixtureModel(), lags: 31 }, 2)).toThrow(RangeError);
    expect(() => new AttentionDecoder({ ...fixtureModel(), montage: [[1, 0]] }, 2)).toThrow(RangeError);
  });
});

describe("AttentionDecoder raw path", () => {
  /** Three electrodes, two derived channels: each against the third, then scaled. */
  function rawModel(): DecoderModel {
    const lags = 8;
    return {
      version: 1,
      fsRaw: 500,
      fs: 64,
      inputs: ["L1", "L2", "R1"],
      sosRaw: butterBandpass(2, [1, 9], 500),
      sosEnv: butterBandpass(2, [1, 9], 64),
      montage: [
        [1, 0, -1],
        [0, 1, -1],
      ],
      scale: [0.5, 2],
      lags,
      weights: [
        Array.from({ length: lags }, (_, k) => Math.cos(k / 3) * 0.1),
        Array.from({ length: lags }, (_, k) => Math.sin(k / 2) * 0.1),
      ],
    };
  }

  function rawFrame(n: number): number[] {
    const t = n / 500;
    // Microvolts: electrode offsets, a 5 Hz rhythm, line noise.
    return [
      120 + 20 * Math.sin(2 * Math.PI * 5 * t) + 3 * Math.sin(2 * Math.PI * 50 * t),
      -80 + 15 * Math.sin(2 * Math.PI * 5 * t + 1) + 3 * Math.sin(2 * Math.PI * 50 * t),
      10 + 5 * Math.sin(2 * Math.PI * 7 * t),
    ];
  }

  it("filters, resamples, mixes and scales into finite reconstructions", () => {
    const model = rawModel();
    const dec = new AttentionDecoder(model, 2);
    const N = 5000;
    for (let n = 0; n < N; n++) dec.pushRaw(rawFrame(n));
    // Output k needs input floor(k * 500 / 64) + 1.
    const frames = Math.floor((N - 2) * 64 / 500) + 1;
    expect(dec.featureCount).toBe(frames);
    expect(dec.count).toBe(frames - model.lags + 1);
    const { recon } = dec.recent(dec.count);
    expect(recon.length).toBe(dec.count);
    expect(recon.every(Number.isFinite)).toBe(true);
    expect(recon.some((x) => x !== 0)).toBe(true);
  });

  it("matches the chain run step by step with the dsp blocks", () => {
    const model = rawModel();
    const dec = new AttentionDecoder(model, 1);
    const ref = new AttentionDecoder(model, 1);
    const filter = new SosFilter(model.sosRaw, 3);
    const rs = new LinearResampler(model.fsRaw, model.fs, 3);
    const N = 3000;
    for (let n = 0; n < N; n++) {
      const x = rawFrame(n);
      dec.pushRaw(x);
      const y = x.map((v, i) => filter.step(i, v));
      rs.push(y, (f) => {
        const derived = model.montage.map((row, c) => row.reduce((acc, m, i) => acc + m * f[i], 0) * model.scale[c]);
        ref.pushFeatures(derived);
      });
    }
    expect(dec.count).toBe(ref.count);
    expect(maxAbs(dec.recent(dec.count).recon, ref.recent(ref.count).recon)).toBeLessThan(1e-12);
  });

  it("holds the last good value over samples that are not finite", () => {
    const model = rawModel();
    const dec = new AttentionDecoder(model, 1);
    const ref = new AttentionDecoder(model, 1);
    for (let n = 0; n < 2000; n++) {
      const x = rawFrame(n);
      if (n === 700) {
        dec.pushRaw([NaN, x[1], x[2]]);
        ref.pushRaw([rawFrame(699)[0], x[1], x[2]]);
      } else {
        dec.pushRaw(x);
        ref.pushRaw(x);
      }
    }
    const a = dec.recent(dec.count).recon;
    expect(a.every(Number.isFinite)).toBe(true);
    expect(maxAbs(a, ref.recent(ref.count).recon)).toBe(0);
  });

  it("bridges a lost envelope sample instead of poisoning the filter", () => {
    const model = {
      version: 1 as const,
      fsRaw: 500,
      fs: 64,
      inputs: ["a"],
      sosRaw: [[1, 0, 0, 1, 0, 0]] as [number, number, number, number, number, number][],
      sosEnv: [[0.2, 0.4, 0.2, 1, -0.5, 0.3]] as [number, number, number, number, number, number][],
      montage: [[1]],
      scale: [1],
      lags: 1,
      weights: [[1]],
    };
    const d = new AttentionDecoder(model, 1);
    for (let i = 0; i < 50; i++) {
      d.pushFeatures([Math.sin(i / 3)]);
      d.pushEnvelope(0, i === 20 ? NaN : Math.sin(i / 3));
    }
    const { envelopes } = d.recent(50);
    expect(envelopes[0].every(Number.isFinite)).toBe(true);
  });
});
