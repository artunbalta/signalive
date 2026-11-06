import { describe, expect, it } from "vitest";
import shipped from "../../public/research/neural.json";
import fixture from "./__fixtures__/neural.json";
import { NeuralAttentionDecoder, erf, gelu, type NeuralDecoderModel } from "./neural";

/**
 * The learned decoder as the phone runs it, against the reference chain in
 * research/aad/deep_export.py: eight seconds of one person's raw ear EEG and
 * the two stories' envelopes, streamed sample by sample, must land on the
 * same embeddings and the same window scores as the Python code computes
 * from the same float32 weights.
 */
const model = shipped as unknown as NeuralDecoderModel;

function run(m: NeuralDecoderModel, opts: { adaptScale?: boolean; eegGain?: number; envGain?: number; nanAt?: [number, number] } = {}) {
  // The reference export has no movement gate, so the port is compared without it.
  const decoder = new NeuralAttentionDecoder(m, 2, { adaptScale: opts.adaptScale ?? false, gate: false });
  const frame = new Float64Array(m.inputs.length);
  const g = opts.eegGain ?? 1;
  fixture.codes.forEach((codes, i) => {
    for (let c = 0; c < frame.length; c++) frame[c] = g * (codes[c] * fixture.lsbUv + fixture.offsetsUv[c]);
    if (opts.nanAt && opts.nanAt[0] === i) frame[opts.nanAt[1]] = NaN;
    decoder.pushRaw(frame);
  });
  for (let j = 0; j < fixture.samples; j++) {
    for (let k = 0; k < 2; k++) decoder.pushEnvelope(k, (opts.envGain ?? 1) * fixture.envelopes[k][j]);
  }
  return decoder;
}

function worst(a: ArrayLike<number> | null, b: ArrayLike<number>): number {
  if (!a) return Infinity;
  let w = 0;
  for (let i = 0; i < b.length; i++) w = Math.max(w, Math.abs(a[i] - b[i]));
  return w;
}

describe("erf and gelu", () => {
  it("match the reference to about 1e-15, across the switch from series to fraction", () => {
    const ref: [number, number][] = [
      [0.1, 0.1124629160182849],
      [0.5, 0.5204998778130465],
      [1, 0.8427007929497148],
      [1.5, 0.9661051464753108],
      [2, 0.9953222650189527],
      [2.5, 0.999593047982555],
      [2.9999999, 0.9999779094890762],
      [3, 0.9999779095030015],
      [3.0000001, 0.9999779095169268],
      [3.5, 0.9999992569016276],
      [4, 0.9999999845827421],
      [5, 0.9999999999984626],
      [-0.7, -0.6778011938374184],
      [-3.2, -0.9999939742388482],
    ];
    for (const [x, y] of ref) expect(Math.abs(erf(x) - y)).toBeLessThan(2e-15);
    expect(erf(0)).toBe(0);
    expect(erf(7)).toBe(1);
    expect(erf(-7)).toBe(-1);
    expect(gelu(0)).toBe(0);
    expect(gelu(1)).toBeCloseTo(0.8413447460685429, 14);
    expect(gelu(-1)).toBeCloseTo(-0.15865525393145707, 14);
  });
});

describe("the learned decoder against the research pipeline", () => {
  const m = { ...model, scale: fixture.scale };

  it("reads the weights the fixture was made with", () => {
    fixture.weightsHead.forEach((head, n) => {
      const bin = atob(model.weights[n]);
      const view = new DataView(new ArrayBuffer(16));
      for (let i = 0; i < 16; i++) view.setUint8(i, bin.charCodeAt(i));
      head.forEach((v, i) => expect(view.getFloat32(i * 4, true)).toBe(v));
    });
    expect(model.weights.length).toBe(fixture.weightsHead.length);
  });

  it("streams to the same embeddings, 0.44 s behind its input", () => {
    const d = run(m);
    expect(d.lag).toBe(28);
    expect(d.count).toBeGreaterThanOrEqual(fixture.final);
    let we = 0;
    let ws = 0;
    fixture.eeg.forEach((row, i) => {
      we = Math.max(we, worst(d.eegEmbedding(i * fixture.every), row));
    });
    fixture.env.forEach((rows, k) =>
      rows.forEach((row, i) => {
        ws = Math.max(ws, worst(d.envEmbedding(k, i * fixture.every), row));
      }),
    );
    expect(we).toBeLessThan(1e-9);
    expect(ws).toBeLessThan(1e-9);
  });

  it("scores windows as the reference does, averaged over its networks", () => {
    const d = run(m);
    for (const w of fixture.windows) {
      const got = d.decideRange(w.start, w.length);
      expect(got).not.toBeNull();
      expect(worst(got!.r, w.scores)).toBeLessThan(1e-9);
      const best = w.scores[0] >= w.scores[1] ? 0 : 1;
      expect(got!.talker).toBe(best);
      expect(got!.margin).toBeCloseTo(Math.abs(w.scores[0] - w.scores[1]), 9);
    }
  });

  it("decides over the newest window where everything is final, and not before", () => {
    const d = new NeuralAttentionDecoder(m, 2, { adaptScale: false });
    expect(d.decide(1)).toBeNull();
    const full = run(m);
    const dec = full.decide(2);
    expect(dec).not.toBeNull();
    expect(dec!.end).toBe(Math.min(full.count, fixture.samples - full.lag));
    expect(full.decideRange(0, full.count + 1)).toBeNull();
  });

  it("repeats an electrode's last good value over a lost sample", () => {
    const i = 1000;
    const c = 3;
    const lost = run(m, { nanAt: [i, c] });
    // The same stream with the lost sample filled in by hand.
    const decoder = new NeuralAttentionDecoder(m, 2, { adaptScale: false, gate: false });
    const frame = new Float64Array(m.inputs.length);
    let prev = 0;
    fixture.codes.forEach((codes, j) => {
      for (let k = 0; k < frame.length; k++) frame[k] = codes[k] * fixture.lsbUv + fixture.offsetsUv[k];
      if (j === i) frame[c] = prev;
      prev = frame[c];
      decoder.pushRaw(frame);
    });
    for (let j = 0; j < fixture.samples; j++) for (let k = 0; k < 2; k++) decoder.pushEnvelope(k, fixture.envelopes[k][j]);
    for (let t = 0; t < fixture.final; t += 16) expect(worst(lost.eegEmbedding(t), decoder.eegEmbedding(t)!)).toBeLessThan(1e-12);
  });

  it("learns the wearer's scale, so a louder EEG gives the same embeddings", () => {
    const a = run(m, { adaptScale: true });
    const b = run(m, { adaptScale: true, eegGain: 10 });
    // From a second in, both scales are the spread so far, so the scaled EEG is the same;
    // the networks reach 28 samples back and ahead of that.
    let w = 0;
    for (let t = 64 + 2 * 28; t < fixture.final; t++) w = Math.max(w, worst(a.eegEmbedding(t), b.eegEmbedding(t)!));
    expect(w).toBeLessThan(1e-9);
    for (let c = 0; c < a.channels; c++) expect(b.channelScale[c] * 10).toBeCloseTo(a.channelScale[c], 9);
    // Without it, the louder EEG reads differently.
    const c0 = run(m, { adaptScale: false });
    const c1 = run(m, { adaptScale: false, eegGain: 10 });
    expect(worst(c0.eegEmbedding(200), c1.eegEmbedding(200)!)).toBeGreaterThan(1e-3);
  });

  it("scales each envelope by its own spread, so a louder voice gives the same embedding", () => {
    const a = run(m);
    const b = run(m, { envGain: 5 });
    let w = 0;
    for (let t = 0; t < fixture.final; t++) for (let k = 0; k < 2; k++) w = Math.max(w, worst(a.envEmbedding(k, t), b.envEmbedding(k, t)!));
    expect(w).toBeLessThan(1e-9);
  });

  it("starts over on reset", () => {
    const d = run(m);
    d.reset();
    expect(d.count).toBe(0);
    expect(d.envelopeCount(0)).toBe(0);
    const again = run(m);
    const frame = new Float64Array(m.inputs.length);
    fixture.codes.forEach((codes) => {
      for (let c = 0; c < frame.length; c++) frame[c] = codes[c] * fixture.lsbUv + fixture.offsetsUv[c];
      d.pushRaw(frame);
    });
    for (let j = 0; j < fixture.samples; j++) for (let k = 0; k < 2; k++) d.pushEnvelope(k, fixture.envelopes[k][j]);
    expect(worst(d.eegEmbedding(300), again.eegEmbedding(300)!)).toBe(0);
  });

  it("refuses a model it cannot run", () => {
    expect(() => new NeuralAttentionDecoder({ ...m, version: 1 } as unknown as NeuralDecoderModel, 2)).toThrow();
    expect(() => new NeuralAttentionDecoder({ ...m, scale: [1, 2] }, 2)).toThrow(/scale/);
    expect(() => new NeuralAttentionDecoder({ ...m, weights: [m.weights[0].slice(0, 40)] }, 2)).toThrow(/weights/);
    expect(() => new NeuralAttentionDecoder(m, 0)).toThrow(/talkers/);
  });

  it("ships the fusion weight fitted on held out people", () => {
    expect(model.eegWeight).not.toBeNull();
    expect(model.eegWeight!).toBeGreaterThan(0);
    expect(model.decisionSeconds).toBe(10);
    expect(new NeuralAttentionDecoder(model, 2).eegWeight).toBe(model.eegWeight);
  });
});
