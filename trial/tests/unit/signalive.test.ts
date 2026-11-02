import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { DecoderModel } from "@sense/decoder";
import { encodeCommand, type Side } from "@sense/protocol";
import { manualClock } from "@sense/twin";
import { earbuds } from "@/lib/client/earbuds";
import { headTracker } from "@/lib/client/head-tracker";
import { SignaliveSensorProvider, syntheticBackground } from "@/lib/extensions/signalive-provider";
import { gestureBus } from "@/lib/gestures/bus";
import type { GestureEvent } from "@/lib/gestures/types";

/** The simulated earbuds on a clock the test drives: twin.tick(ms) delivers everything due, at once. */
function simulated() {
  return new SignaliveSensorProvider({ transport: "simulated", clock: manualClock });
}

function gestures() {
  const seen: GestureEvent[] = [];
  const off = gestureBus.subscribe((e) => seen.push(e));
  return { seen, off };
}

describe("Signalive earbuds, simulated", () => {
  it("publishes a twin clench as jaw_clench and a double as jaw_double_clench", async () => {
    const p = simulated();
    const { seen, off } = gestures();
    await p.connect();
    const twin = p.twin!;
    // The detector learns the background in its first second.
    twin.tick(1500);
    expect(p.view.get()).toMatchObject({ phase: "connected", listening: true });
    expect(seen).toEqual([]);

    twin.clench("single");
    twin.tick(1500);
    expect(seen.map((e) => e.type)).toEqual(["jaw_clench"]);

    twin.clench("double");
    twin.tick(2000);
    off();
    await p.disconnect();
    expect(seen.map((e) => e.type)).toEqual(["jaw_clench", "jaw_double_clench"]);
    for (const e of seen) {
      expect(e).toMatchObject({ source: "sensor", detail: { sensorId: "signalive" } });
      expect(e.detail!.confidence).toBeGreaterThan(0.5);
      expect(e.detail!.confidence).toBeLessThanOrEqual(1);
    }
  });

  it("stays silent on the background alone, and a hold is not published", async () => {
    const p = simulated();
    const { seen, off } = gestures();
    await p.connect();
    p.twin!.tick(20_000);
    p.twin!.clench("hold");
    p.twin!.tick(3000);
    off();
    await p.disconnect();
    expect(seen).toEqual([]);
  });

  it("lines up the two earbuds when frames arrive late by varying amounts, as over a radio", async () => {
    // Every frame reaches the phone 4 to 34 ms after its last sample, so each
    // earbud's clock map keeps moving while it finds the earliest arrivals.
    let seed = 12345;
    const late = () => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return 4 + (seed / 2 ** 32) * 30;
    };
    const p: SignaliveSensorProvider = new SignaliveSensorProvider({
      transport: "simulated",
      clock: manualClock,
      now: () => p.twin!.time + late(),
    });
    const { seen, off } = gestures();
    await p.connect();
    const twin = p.twin!;
    for (let ms = 0; ms < 1500; ms += 15) twin.tick(15);
    twin.clench("single");
    for (let ms = 0; ms < 1500; ms += 15) twin.tick(15);
    twin.clench("double");
    for (let ms = 0; ms < 2000; ms += 15) twin.tick(15);
    off();
    await p.disconnect();
    expect(seen.map((e) => e.type)).toEqual(["jaw_clench", "jaw_double_clench"]);
  });

  it("listens on one earbud until the other joins late, as the second Bluetooth pick does, then on both", async () => {
    const p = simulated();
    const { seen, off } = gestures();
    await p.connect();
    const twin = p.twin!;
    // The right earbud stops at once and starts again four and a half seconds later.
    twin.command("right", encodeCommand({ op: "stop" }, { side: "right" }));
    twin.tick(3000);
    expect(p.view.get()).toMatchObject({ listening: true, clench: "left" });
    twin.clench("single");
    twin.tick(1500);
    expect(seen.map((e) => e.type)).toEqual(["jaw_clench"]);
    twin.command("right", encodeCommand({ op: "start" }, { side: "right" }));
    twin.tick(1500);
    expect(p.view.get()).toMatchObject({ listening: true, clench: "both" });
    twin.clench("single");
    twin.tick(1500);
    twin.clench("double");
    twin.tick(2000);
    off();
    await p.disconnect();
    expect(seen.map((e) => e.type)).toEqual(["jaw_clench", "jaw_clench", "jaw_double_clench"]);
  });

  it("lines up the two earbuds even when the right one's frames are lost", async () => {
    const p = new SignaliveSensorProvider({ transport: "simulated", clock: manualClock, twin: { loss: 0.05 }, seed: 4 });
    const { seen, off } = gestures();
    await p.connect();
    p.twin!.tick(1500);
    p.twin!.clench("single");
    p.twin!.tick(1500);
    off();
    const v = p.view.get();
    await p.disconnect();
    expect(seen.map((e) => e.type)).toEqual(["jaw_clench"]);
    expect(v.lost).toBeGreaterThan(0);
  });

  /** The simulated earbuds behind a radio that delivers a frame only when keep(side, time) says so, fed in 20 ms steps. */
  function behindRadio(keep: (side: Side, t: number) => boolean) {
    const p = simulated();
    const twin = p.twin!;
    const start = twin.start.bind(twin);
    twin.start = (onBytes) =>
      start((bytes, side) => {
        if (keep(side, twin.time)) onBytes(bytes, side);
      });
    const run = (ms: number) => {
      for (let t = 0; t < ms; t += 20) twin.tick(20);
    };
    return { p, twin, run };
  }

  it("hears clenches on the left ear alone when the right earbud loses 70% of its frames", async () => {
    let seed = 99;
    const rand = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
    const { p, twin, run } = behindRadio((side) => side !== "right" || rand() > 0.7);
    const { seen, off } = gestures();
    await p.connect();
    run(5000);
    twin.clench("single");
    run(1500);
    twin.clench("double");
    run(2000);
    off();
    const v = p.view.get();
    await p.disconnect();
    expect(v).toMatchObject({ listening: true, clench: "left" });
    expect(seen.map((e) => e.type)).toEqual(["jaw_clench", "jaw_double_clench"]);
  });

  it("hears every clench while the right earbud's link goes on and off every 2.5 s", async () => {
    const { p, twin, run } = behindRadio((side, t) => side !== "right" || t % 5000 < 2500);
    const { seen, off } = gestures();
    await p.connect();
    // As the link comes back, while it is up, and after it has dropped again.
    run(5000);
    twin.clench("single");
    run(1500);
    twin.clench("double");
    run(2000);
    twin.clench("single");
    run(1500);
    off();
    await p.disconnect();
    expect(seen.map((e) => e.type)).toEqual(["jaw_clench", "jaw_double_clench", "jaw_clench"]);
  });

  it("reports both earbuds, their battery, the counts and the head yaw, and forgets them at disconnect", async () => {
    const p = simulated();
    await p.connect();
    const twin = p.twin!;
    twin.tick(500);
    twin.setYaw(30);
    twin.tick(1000);
    const v = p.view.get();
    expect(Object.keys(v.earbuds).sort()).toEqual(["left", "right"]);
    expect(v.earbuds.left).toMatchObject({ battery: 88, worn: true, leadOff: null, labels: ["L1", "L2", "L3", "L4"], eegRate: 500, imuRate: 100, simulated: true });
    expect(v.earbuds.right).toMatchObject({ battery: 91, labels: ["R1", "R2", "R3", "R4"] });
    // About 28 frames of EEG and 20 of IMU a second from each earbud.
    expect(v.frames).toBeGreaterThan(80);
    expect(v.lost).toBe(0);
    expect(p.yaw!).toBeCloseTo(30, 0);
    expect(v.yaw).toBe(30);

    await p.disconnect();
    expect(p.view.get()).toMatchObject({ phase: "off", earbuds: {}, frames: 0, yaw: null });
    expect(p.yaw).toBeNull();
  });

  it("streams every channel as it arrives and ends at disconnect", async () => {
    const p = simulated();
    await p.connect();
    const ids = new Set<string>();
    let samples = 0;
    const reading = (async () => {
      for await (const s of p.stream()) {
        ids.add(s.channelId);
        samples += s.values.length;
      }
    })();
    p.twin!.tick(1000);
    await p.disconnect();
    await reading;
    expect([...ids].sort()).toEqual(["left:L1", "left:L2", "left:L3", "left:L4", "left:yaw", "right:R1", "right:R2", "right:R3", "right:R4", "right:yaw"]);
    expect(samples).toBeGreaterThan(8 * 450);
  });

  it("describes what each transport really carries", () => {
    const sim = simulated().capabilities;
    expect(sim).toMatchObject({ transport: "simulated", gestures: ["jaw_clench", "jaw_double_clench"], attention: false });
    expect(sim.channels.filter((c) => c.kind === "eeg").map((c) => [c.id, c.rateHz, c.unit])).toEqual([
      ["left:L1", 500, "uV"],
      ["left:L2", 500, "uV"],
      ["left:L3", 500, "uV"],
      ["left:L4", 500, "uV"],
      ["right:R1", 500, "uV"],
      ["right:R2", 500, "uV"],
      ["right:R3", 500, "uV"],
      ["right:R4", 500, "uV"],
    ]);
    expect(sim.channels.filter((c) => c.kind === "imu").map((c) => c.id)).toEqual(["left:yaw", "right:yaw"]);

    const ble = new SignaliveSensorProvider({ transport: "bluetooth" }).capabilities;
    expect(ble).toMatchObject({ transport: "web-bluetooth", channels: [], attention: false });
    const cyton = new SignaliveSensorProvider({ transport: "cyton" }).capabilities;
    expect(cyton.transport).toBe("web-serial");
    expect(cyton.channels.map((c) => c.id)).toEqual(["L1", "L2", "L3", "L4", "R1", "R2", "R3", "R4"].map((l) => `single:${l}`));
    expect(cyton.channels.every((c) => c.kind === "eeg" && c.rateHz === 250)).toBe(true);
  });

  it("decodes attention only with a model and the earbuds' speech envelopes, and steers both earbuds", async () => {
    // The decoder trained in research/aad, from lib/sense's own end to end fixture.
    const fixture = JSON.parse(readFileSync(fileURLToPath(new URL("../../../lib/sense/__fixtures__/e2e.json", import.meta.url)), "utf8"));
    const model = fixture.model as DecoderModel;
    // Earbuds whose electrodes are the ones the model reads, sending two talkers' envelopes.
    const recording = { ...syntheticBackground(1, 20), labels: model.inputs };
    const envelopes = [0, 1].map((k) => Float32Array.from({ length: 20 * 64 }, (_, i) => 1 + Math.sin(i / (5 + k))));
    const audio = { azimuths: [-30, 40], data: envelopes };

    const without = new SignaliveSensorProvider({ transport: "simulated", clock: manualClock, twin: { recording, audio } });
    expect(without.capabilities.attention).toBe(false);

    const p = new SignaliveSensorProvider({ transport: "simulated", clock: manualClock, decoderModel: model, twin: { recording, audio } });
    expect(p.capabilities.attention).toBe(true);
    await p.connect();
    p.twin!.tick(4000);
    // The session decides over ten seconds of both, so the first decision waits for them.
    expect(p.view.get().attention).toBeNull();
    p.twin!.tick(8000);
    const a = p.view.get().attention!;
    expect(a).not.toBeNull();
    expect(a.azimuthDeg).toBe(audio.azimuths[a.talker]);
    expect(a.confidence).toBeGreaterThan(0);
    expect(p.attention.currentAttendedSource()).toEqual({ sourceId: `earbuds:talker${a.talker}`, confidence: a.confidence });
    for (const side of ["left", "right"] as const) expect(p.twin!.steering(side)?.azimuthDeg).toBe(a.azimuthDeg);
    await p.disconnect();
  });

  it("plays a background of 5 uV noise and a 10 Hz rhythm of 10 uV on eight electrodes", () => {
    const rec = syntheticBackground(1, 10);
    expect(rec).toMatchObject({ fs: 500, labels: ["L1", "L2", "L3", "L4", "R1", "R2", "R3", "R4"] });
    for (const d of rec.data) {
      expect(d.length).toBe(5000);
      // Remove the rhythm by projecting it out; what is left is the noise.
      let re = 0;
      let im = 0;
      d.forEach((v, i) => {
        re += v * Math.cos((2 * Math.PI * 10 * i) / 500);
        im += v * Math.sin((2 * Math.PI * 10 * i) / 500);
      });
      const amp = (2 * Math.hypot(re, im)) / d.length;
      expect(amp).toBeGreaterThan(9.5);
      expect(amp).toBeLessThan(10.5);
      const power = d.reduce((a, v) => a + v * v, 0) / d.length;
      expect(Math.sqrt(power - (amp * amp) / 2)).toBeCloseTo(5, 0);
    }
  });
});

describe("head direction from the earbuds", () => {
  afterEach(async () => {
    headTracker.stop();
    await earbuds.disconnect();
  });

  it("steers the head tracker with the twin's yaw, from where the head pointed at the start", async () => {
    await earbuds.connect("simulated", { clock: manualClock });
    expect(earbuds.view.get()).toMatchObject({ phase: "connected", transport: "simulated" });
    await headTracker.use("earbuds");
    expect(headTracker.view.get()).toMatchObject({ source: "earbuds", status: "starting" });

    const twin = earbuds.twin!;
    twin.tick(300);
    expect(headTracker.view.get().status).toBe("tracking");
    earbuds.turnHead();
    twin.tick(1000);
    for (let i = 0; i < 60; i++) headTracker.tick(0.05);
    // 30 degrees of head turn steer as far as with the camera: 48, toward the voice on the right.
    expect(headTracker.angle).toBeCloseTo(48, 0);

    earbuds.turnHead();
    earbuds.turnHead();
    twin.tick(1000);
    for (let i = 0; i < 60; i++) headTracker.tick(0.05);
    expect(headTracker.angle).toBeCloseTo(-48, 0);

    // Straight ahead is wherever the head points now.
    headTracker.recenter();
    twin.tick(100);
    for (let i = 0; i < 60; i++) headTracker.tick(0.05);
    expect(headTracker.angle).toBeCloseTo(0, 0);
  });

  it("is unavailable without connected earbuds, and stops following when they disconnect", async () => {
    await headTracker.use("earbuds");
    expect(headTracker.view.get().status).toBe("unavailable");

    await earbuds.connect("simulated", { clock: manualClock });
    await headTracker.use("earbuds");
    earbuds.twin!.tick(300);
    expect(headTracker.view.get().status).toBe("tracking");
    await earbuds.disconnect();
    expect(headTracker.view.get().status).toBe("unavailable");
  });
});
