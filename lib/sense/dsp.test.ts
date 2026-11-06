import { describe, expect, it } from "vitest";
import fixture from "./__fixtures__/dsp.json";
import { ArtifactGate, butterBandpass, LinearResampler, SosFilter, type Sos } from "./dsp";

const TOL = 1e-9;

function expectClose(actual: ArrayLike<number>, expected: ArrayLike<number>, tol = TOL) {
  expect(actual.length).toBe(expected.length);
  let worst = 0;
  for (let i = 0; i < expected.length; i++) worst = Math.max(worst, Math.abs(actual[i] - expected[i]));
  expect(worst).toBeLessThan(tol);
}

function expectSosClose(actual: Sos, expected: number[][]) {
  expect(actual.length).toBe(expected.length);
  actual.forEach((section, i) => expectClose(section, expected[i]));
}

describe("butterBandpass", () => {
  for (const d of fixture.designs) {
    it(`matches scipy.signal.butter(${d.order}, [${d.band}], fs=${d.fs})`, () => {
      expectSosClose(butterBandpass(d.order, d.band as [number, number], d.fs), d.sos);
    });
  }

  // Odd orders put real poles through the pairing, which the fixture designs
  // do not. Numbers printed by scipy 1.13.1:
  // butter(order, band, btype="bandpass", fs=fs, output="sos").tolist()
  const odd: { order: number; band: [number, number]; fs: number; sos: number[][] }[] = [
    {
      order: 3,
      band: [1, 100],
      fs: 500,
      sos: [
        [0.09621775086412146, 0.19243550172824292, 0.09621775086412146, 1.0, -0.4260056848921169, 0.3617447409154462],
        [1.0, 0.0, -1.0, 1.0, -1.1542450164048759, 0.16483174423392852],
        [1.0, -2.0, 1.0, 1.0, -1.987464234005394, 0.9876225015961702],
      ],
    },
    {
      order: 5,
      band: [0.5, 200],
      fs: 500,
      sos: [
        [0.3503500190363243, 0.7007000380726486, 0.3503500190363243, 1.0, 1.0958215435192822, 0.35528405558166315],
        [1.0, 2.0, 1.0, 1.0, 1.369559163603517, 0.6930087037059794],
        [1.0, 0.0, -1.0, 1.0, -0.4849559389336686, -0.5055745598211988],
        [1.0, -2.0, 1.0, 1.0, -1.9898393707680493, 0.98987875437018],
        [1.0, -2.0, 1.0, 1.0, -1.9960913016064517, 0.9961307188297907],
      ],
    },
    {
      order: 3,
      band: [5, 6],
      fs: 500,
      sos: [
        [2.449622763746046e-7, 4.899245527492092e-7, 2.449622763746046e-7, 1.0, -1.982805896708519, 0.9875119299073144],
        [1.0, 0.0, -1.0, 1.0, -1.9877172620443802, 0.9932449064082066],
        [1.0, -2.0, 1.0, 1.0, -1.9901969669052415, 0.9942285265805492],
      ],
    },
  ];
  for (const d of odd) {
    it(`matches scipy for odd order ${d.order}, [${d.band}] at ${d.fs} Hz`, () => {
      expectSosClose(butterBandpass(d.order, d.band, d.fs), d.sos);
    });
  }

  it("rejects bands outside (0, fs / 2)", () => {
    expect(() => butterBandpass(2, [0, 9], 500)).toThrow(RangeError);
    expect(() => butterBandpass(2, [9, 1], 500)).toThrow(RangeError);
    expect(() => butterBandpass(2, [30, 250], 500)).toThrow(RangeError);
    expect(() => butterBandpass(0, [1, 9], 500)).toThrow(RangeError);
  });
});

describe("SosFilter", () => {
  const { sos, input, output } = fixture.sosfilt;

  it("reproduces scipy.signal.sosfilt sample by sample", () => {
    const filter = new SosFilter(sos as Sos, input.length);
    const got = input.map(() => [] as number[]);
    // Interleaved, as frames arrive: channel states must stay independent.
    for (let t = 0; t < input[0].length; t++) {
      for (let c = 0; c < input.length; c++) got[c].push(filter.step(c, input[c][t]));
    }
    input.forEach((_, c) => expectClose(got[c], output[c]));
  });

  it("reproduces sosfilt in place, in blocks, and with the designed coefficients", () => {
    const filter = new SosFilter(butterBandpass(2, [1, 9], 500), input.length);
    for (let c = 0; c < input.length; c++) {
      const data = Float64Array.from(input[c]);
      filter.processInPlace(c, data.subarray(0, 250));
      filter.processInPlace(c, data.subarray(250));
      expectClose(data, output[c]);
    }
  });

  it("starts again from rest after reset", () => {
    const filter = new SosFilter(sos as Sos, 1);
    const first = input[0].slice(0, 50).map((x) => filter.step(0, x));
    filter.reset();
    const again = input[0].slice(0, 50).map((x) => filter.step(0, x));
    expect(again).toEqual(first);
  });
});

describe("LinearResampler", () => {
  const { fsIn, fsOut, input, output } = fixture.decimate;

  it("reproduces pipeline.decimate, emitting each output as soon as it can", () => {
    const rs = new LinearResampler(fsIn, fsOut, 1);
    const got: number[] = [];
    input.forEach((x, n) => {
      rs.push([x], (frame) => {
        // Output k needs input floor(k * fsIn / fsOut) + 1, which is n.
        expect(Math.floor((got.length * fsIn) / fsOut) + 1).toBe(n);
        got.push(frame[0]);
      });
    });
    expect(got.length).toBeGreaterThanOrEqual(output.length);
    expectClose(got.slice(0, output.length), output);
  });

  it("keeps channels apart and upsamples by emitting several frames per input", () => {
    const rs = new LinearResampler(2, 8, 2);
    const got: number[][] = [];
    for (let n = 0; n < 3; n++) rs.push([n, -10 * n], (f) => got.push([f[0], f[1]]));
    expect(got).toEqual([
      [0, -0],
      [0.25, -2.5],
      [0.5, -5],
      [0.75, -7.5],
      [1, -10],
      [1.25, -12.5],
      [1.5, -15],
      [1.75, -17.5],
    ]);
  });

  it("does not drift over long streams", () => {
    const rs = new LinearResampler(500, 64, 1);
    let count = 0;
    let last = 0;
    const n = 500 * 3600;
    for (let i = 0; i < n; i++) rs.push([i], (f) => {
      last = f[0];
      count++;
    });
    // A ramp resamples to k * 500 / 64 exactly, an hour in.
    expect(count).toBe(Math.floor((n - 2) * 64 / 500) + 1);
    expect(last).toBeCloseTo(((count - 1) * 500) / 64, 9);
  });
});

describe("ArtifactGate", () => {
  it("leaves frames under the threshold alone", () => {
    const g = new ArtifactGate(64);
    const f = Float64Array.from([1, -4.9, 3]);
    expect(g.apply(f)).toBe(false);
    expect(Array.from(f)).toEqual([1, -4.9, 3]);
  });

  it("blanks every channel from a crossing for half a second, then opens", () => {
    const g = new ArtifactGate(64);
    expect(g.holdSamples).toBe(32);
    const jolt = Float64Array.from([0.5, 6, -1]);
    expect(g.apply(jolt)).toBe(true);
    expect(Array.from(jolt)).toEqual([0, 0, 0]);
    let blanked = 1;
    for (let i = 0; i < 40; i++) {
      const f = Float64Array.from([1, 1, 1]);
      if (g.apply(f)) {
        blanked++;
        expect(Array.from(f)).toEqual([0, 0, 0]);
      } else {
        expect(Array.from(f)).toEqual([1, 1, 1]);
      }
    }
    expect(blanked).toBe(32);
  });

  it("starts the half second again at a later crossing", () => {
    const g = new ArtifactGate(64);
    g.apply(Float64Array.from([10]));
    for (let i = 0; i < 20; i++) g.apply(Float64Array.from([0]));
    g.apply(Float64Array.from([-7]));
    expect(g.closing).toBe(31);
  });

  it("rejects settings that cannot work", () => {
    expect(() => new ArtifactGate(64, 0)).toThrow(RangeError);
    expect(() => new ArtifactGate(64, 5, -1)).toThrow(RangeError);
  });
});
