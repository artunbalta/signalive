import { describe, expect, it } from "vitest";
import type { ClenchEvent } from "./clench";
import { decodeCommand, encodeCommand } from "./protocol";
import { PhoneSession } from "./session";
import { DigitalTwin, manualClock, type TwinOptions, type TwinRecording } from "./twin";

/**
 * The phone side end to end, fed by the digital twin the way it will be fed
 * by earbuds: bytes in, clenches, head direction, a posterior and a STEER
 * command out.
 */

const FS = 500;

/** Eight channels at 500 Hz: seeded noise of about 5 microvolts RMS on a 10 Hz rhythm. */
function recording(seconds = 20): TwinRecording {
  let seed = 12345;
  const rand = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());
  const n = seconds * FS;
  return {
    fs: FS,
    labels: ["L1", "L2", "L3", "L4", "R1", "R2", "R3", "R4"],
    data: Array.from({ length: 8 }, (_, c) => Float32Array.from({ length: n }, (_, i) => 5 * gauss() + 10 * Math.sin((2 * Math.PI * 10 * i) / FS + c))),
  };
}

function setup(opts: Partial<TwinOptions> = {}) {
  const twin = new DigitalTwin({ recording: recording(), sides: { left: [0, 1, 2, 3], right: [4, 5, 6, 7] }, clock: manualClock, seed: 3, ...opts });
  const session = new PhoneSession({ fs: FS, perEar: 4, now: () => twin.time });
  const events: ClenchEvent[] = [];
  const latencies: number[] = [];
  session.onClench((e, { latencyMs }) => {
    events.push(e);
    latencies.push(latencyMs);
  });
  twin.start((bytes, side) => session.bytes(bytes, side));
  // Deliver in 20 ms steps, roughly a BLE connection interval.
  const run = (ms: number) => {
    for (let t = 0; t < ms; t += 20) twin.tick(20);
  };
  return { twin, session, events, latencies, run };
}

describe("PhoneSession", () => {
  it("finds single, double and held clenches in the earbuds' frames", () => {
    const { twin, events, latencies, run } = setup();
    run(3000);
    expect(events).toHaveLength(0);
    twin.clench("single");
    run(1500);
    twin.clench("double");
    run(2000);
    twin.clench("hold");
    run(2500);
    expect(events.map((e) => e.kind)).toEqual(["single", "double", "hold"]);
    // Reported soon after the jaw activity began: a single waits out a possible double.
    expect(latencies[0]).toBeGreaterThan(400);
    expect(latencies[0]).toBeLessThan(800);
    expect(latencies[2]).toBeLessThan(900);
  });

  it("reads the head from the motion sensors and leans the posterior that way", () => {
    const { twin, session, run } = setup();
    run(1000);
    twin.setYaw(45);
    run(2000);
    expect(session.yaw).not.toBeNull();
    expect(Math.abs((session.yaw ?? 0) - 45)).toBeLessThan(2);
    const { posterior } = session.snapshot();
    expect(posterior[1]).toBeGreaterThan(posterior[0]);
  });

  it("writes a STEER the earbuds obey", () => {
    const { twin, session, run } = setup();
    run(500);
    const bytes = session.steer([0.1, 0.9]);
    const cmd = decodeCommand(bytes);
    expect(cmd?.command).toEqual({ op: "steer", azimuthDeg: 90, gainDb: 7.2 });
    twin.command("single", bytes);
    run(100);
    expect(twin.steering("left")).toEqual({ azimuthDeg: 90, gainDb: 7.2 });
    expect(twin.steering("right")).toEqual({ azimuthDeg: 90, gainDb: 7.2 });
  });

  it("keeps the ears paired when frames are lost on the air", () => {
    const { twin, session, events, run } = setup({ loss: 0.05 });
    run(10_000);
    const { ears } = session.snapshot();
    expect(ears.left.lost + ears.right.lost).toBeGreaterThan(0);
    // Every lost sample is filled, so pairs keep pace with time on both ears.
    expect(session.processed).toBeGreaterThan(10 * FS * 0.97);
    twin.clench("single");
    run(1500);
    expect(events.map((e) => e.kind)).toContain("single");
  });

  it("splits a dev kit carrying both ears into left and right", () => {
    const { twin, session, events, run } = setup({ sides: { single: [0, 1, 2, 3, 4, 5, 6, 7] } });
    run(3000);
    twin.clench("single");
    run(1500);
    expect(session.processed).toBeGreaterThan(4 * FS * 0.97);
    expect(events.map((e) => e.kind)).toEqual(["single"]);
  });

  it("pairs the ears by time when one earbud connects late", () => {
    const { twin, session, events, run } = setup({ driftPpm: { left: 300, right: -300 } });
    twin.command("right", encodeCommand({ op: "stop" }, { side: "right" }));
    run(5000);
    twin.command("right", encodeCommand({ op: "start" }, { side: "right" }));
    run(4000);
    // Both ears now share one timeline: the late ear does not shift the early one.
    expect(session.processed).toBeGreaterThan(8.5 * FS);
    twin.clench("single");
    run(1500);
    expect(events.map((e) => e.kind)).toEqual(["single"]);
  });
});
