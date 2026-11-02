import { describe, expect, it } from "vitest";
import fixture from "./__fixtures__/e2e.json";
import { AttentionDecoder, type DecoderModel } from "./decoder";

/**
 * The whole chain on a real recording: six seconds of one person's raw ear
 * EEG, as the research page streams it, through band pass, resampling, each
 * ear referenced to itself, scaling and the decoder trained in
 * research/aad. The reference reconstruction comes from the Python pipeline
 * (export.py); the browser has to land on the same numbers.
 */
describe("end to end against the research pipeline", () => {
  it("rebuilds the same envelope from raw microvolts", () => {
    const model = fixture.model as unknown as DecoderModel;
    const decoder = new AttentionDecoder(model, 1);
    const frame = new Float64Array(model.inputs.length);
    for (const codes of fixture.codes) {
      for (let c = 0; c < frame.length; c++) frame[c] = codes[c] * fixture.lsbUv + fixture.offsetsUv[c];
      decoder.pushRaw(frame);
    }
    const expected = fixture.recon;
    expect(decoder.count).toBeGreaterThanOrEqual(expected.length);
    const { recon } = decoder.recent(decoder.count);
    const scale = Math.max(...expected.map(Math.abs));
    let worst = 0;
    for (let i = 0; i < expected.length; i++) worst = Math.max(worst, Math.abs(recon[i] - expected[i]));
    expect(worst / scale).toBeLessThan(1e-9);
  });
});
