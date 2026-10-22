import { describe, expect, it } from "vitest";
import { RingBuffer } from "@/lib/audio/ring-buffer";

const seq = (from: number, n: number) => Float32Array.from({ length: n }, (_, i) => from + i);

describe("RingBuffer", () => {
  it("returns what it holds, oldest first, before it is full", () => {
    const b = new RingBuffer(10);
    b.push(seq(0, 4));
    b.push(seq(4, 3));
    expect(b.length).toBe(7);
    expect([...b.latest(5)]).toEqual([2, 3, 4, 5, 6]);
    expect([...b.latest(100)]).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("keeps only the newest samples across the wrap", () => {
    const b = new RingBuffer(10);
    for (let i = 0; i < 7; i++) b.push(seq(i * 3, 3));
    expect(b.length).toBe(10);
    expect([...b.latest(10)]).toEqual([...seq(11, 10)]);
    expect([...b.latest(4)]).toEqual([17, 18, 19, 20]);
  });

  it("takes a chunk longer than itself", () => {
    const b = new RingBuffer(5);
    b.push(seq(0, 2));
    b.push(seq(100, 12));
    expect([...b.latest(5)]).toEqual([107, 108, 109, 110, 111]);
  });

  it("forgets everything on clear", () => {
    const b = new RingBuffer(5);
    b.push(seq(1, 5));
    b.clear();
    expect(b.length).toBe(0);
    expect(b.latest(5).length).toBe(0);
    b.push(seq(9, 2));
    expect([...b.latest(5)]).toEqual([9, 10]);
  });
});
