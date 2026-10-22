import { describe, expect, it } from "vitest";
import { SourceStage } from "@/lib/audio/source-stage";
import { nullAttentionProvider, type AttendedSource } from "@/lib/extensions/attention-provider";
import { emitSensorGesture, NullSensorProvider } from "@/lib/extensions/sensor-provider";
import { GestureBus, gestureBus } from "@/lib/gestures/bus";
import type { GestureEvent } from "@/lib/gestures/types";

describe("extension points", () => {
  it("the null sensor provider connects to nothing and emits nothing", async () => {
    const p = new NullSensorProvider();
    expect(p.capabilities).toEqual({ channels: [], gestures: [], attention: false, transport: "none" });
    await p.connect();
    const frames = [];
    for await (const f of p.stream()) frames.push(f);
    expect(frames).toEqual([]);
    await p.disconnect();
  });

  it("the null attention provider never reports a source", () => {
    expect(nullAttentionProvider.currentAttendedSource()).toBeNull();
  });

  it("sensor gestures reach gesture bus subscribers like any other gesture", () => {
    const seen: GestureEvent[] = [];
    const off = gestureBus.subscribe((e) => seen.push(e));
    emitSensorGesture("jaw_clench", "emg-left", 0.93);
    off();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ type: "jaw_clench", source: "sensor", detail: { sensorId: "emg-left", confidence: 0.93 } });
  });

  it("one failing subscriber does not stop the others", () => {
    const bus = new GestureBus();
    const seen: string[] = [];
    bus.subscribe(() => {
      throw new Error("boom");
    });
    bus.subscribe((e) => seen.push(e.type));
    const err = console.error;
    console.error = () => {};
    bus.emit({ type: "tap", source: "keyboard", at: 0 });
    console.error = err;
    expect(seen).toEqual(["tap"]);
    expect(bus.history()[0]?.type).toBe("tap");
  });
});

describe("attention weighting", () => {
  /** A stand-in for the Web Audio parts SourceStage touches. */
  function fakeContext() {
    const gains: { gain: { target: number; setTargetAtTime(v: number): void }; connect(): void }[] = [];
    const ctx = {
      currentTime: 0,
      createGain() {
        const g = { gain: { target: 1, setTargetAtTime(v: number) { g.gain.target = v; } }, connect() {} };
        gains.push(g);
        return g;
      },
    };
    return ctx as unknown as BaseAudioContext;
  }
  const db = (stage: SourceStage, id: string) => Math.round(20 * Math.log10((stage.input(id).gain as unknown as { target: number }).target));

  it("raises the attended voice and lowers only the voices it was asked about", () => {
    let attended: AttendedSource | null = { sourceId: "focus:left", confidence: 0.9 };
    const stage = new SourceStage(fakeContext(), {} as AudioNode, { id: "test", currentAttendedSource: () => attended });
    const among = ["focus:left", "focus:center", "focus:right"];
    stage.input("assistant");
    expect(stage.applyAttention({ among, boostDb: 0, cutDb: -16, minConfidence: 0.5, neutralDb: -4 })).toBe("focus:left");
    expect([db(stage, "focus:left"), db(stage, "focus:center"), db(stage, "focus:right")]).toEqual([0, -16, -16]);
    expect(db(stage, "assistant")).toBe(0);

    // Nobody faced: everyone back to the neutral mix.
    attended = null;
    expect(stage.applyAttention({ among, boostDb: 0, cutDb: -16, minConfidence: 0.5, neutralDb: -4 })).toBeNull();
    expect([db(stage, "focus:left"), db(stage, "focus:center"), db(stage, "focus:right")]).toEqual([-4, -4, -4]);

    // Too unsure counts as nobody.
    attended = { sourceId: "focus:right", confidence: 0.3 };
    expect(stage.applyAttention({ among, minConfidence: 0.5, neutralDb: -4 })).toBeNull();
  });
});
