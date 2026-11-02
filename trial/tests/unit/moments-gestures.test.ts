import { describe, expect, it } from "vitest";
import { Endpointer } from "@/lib/client/agent-voice";
import { formatDue, nowForModel, parseDue, shortWhen } from "@/lib/client/moments-format";
import { en } from "@/lib/i18n/messages/en";
import { tr } from "@/lib/i18n/messages/tr";
import { KEY_GESTURES } from "@/lib/gestures/keyboard";
import { COMMANDS, DEFAULT_BINDINGS, GESTURE_TYPES, JAW_GESTURES, momentTrigger } from "@/lib/gestures/types";

describe("gestures for moments", () => {
  it("binds a clench to keeping a moment, a double clench to Rewind, a held clench to asking", () => {
    expect(DEFAULT_BINDINGS.jaw_clench).toBe("capture_moment");
    expect(DEFAULT_BINDINGS.jaw_double_clench).toBe("rewind");
    expect(DEFAULT_BINDINGS.jaw_hold).toBe("ask_agent");
    expect(JAW_GESTURES).toEqual(["jaw_clench", "jaw_double_clench", "jaw_hold"]);
  });

  it("binds every gesture to a known command, and names both in both languages", () => {
    for (const g of GESTURE_TYPES) {
      expect(COMMANDS).toContain(DEFAULT_BINDINGS[g]);
      expect(en.gestures.gestureNames[g]).toBeTruthy();
      expect(tr.gestures.gestureNames[g]).toBeTruthy();
    }
    for (const c of COMMANDS) {
      expect(en.gestures.commands[c]).toBeTruthy();
      expect(tr.gestures.commands[c]).toBeTruthy();
    }
  });

  it("lets J, K and H stand in for the jaw", () => {
    expect(KEY_GESTURES).toMatchObject({ j: "jaw_clench", k: "jaw_double_clench", h: "jaw_hold" });
  });

  it("records how a moment was asked for", () => {
    expect(momentTrigger("sensor")).toBe("clench");
    expect(momentTrigger("keyboard")).toBe("key");
    expect(momentTrigger("media_key")).toBe("button");
    expect(momentTrigger(undefined)).toBe("button");
  });
});

/** Feeds 20 ms chunks at a level; returns the events with the time they happened. */
function feed(e: Endpointer, db: number, ms: number, start: number, out: [string, number][]) {
  for (let t = 0; t < ms; t += 20) {
    const ev = e.push(db, 20);
    if (ev) out.push([ev, start + t + 20]);
  }
  return start + ms;
}

describe("the end of a spoken question", () => {
  it("starts with speech and ends a little over a second after it", () => {
    const e = new Endpointer();
    const out: [string, number][] = [];
    let t = feed(e, -70, 800, 0, out);
    t = feed(e, -25, 1500, t, out);
    feed(e, -70, 2000, t, out);
    expect(out.map(([ev]) => ev)).toEqual(["speech", "end"]);
    expect(out[0]![1]).toBeGreaterThanOrEqual(800 + 150);
    expect(out[1]![1]).toBeGreaterThanOrEqual(2300 + 1100);
    expect(out[1]![1]).toBeLessThan(2300 + 1300);
  });

  it("gives up when nobody speaks, and stops at twenty seconds whatever happens", () => {
    const quiet = new Endpointer();
    const out: [string, number][] = [];
    feed(quiet, -70, 8000, 0, out);
    expect(out).toEqual([["no_speech", 6000]]);

    // Someone who never stops: syllables with the short dips speech always has.
    const endless = new Endpointer();
    const out2: [string, number][] = [];
    let t = 0;
    while (t < 25_000) {
      t = feed(endless, -20, 200, t, out2);
      t = feed(endless, -48, 60, t, out2);
    }
    expect(out2.map(([ev]) => ev)).toEqual(["speech", "max"]);
    expect(out2[1]![1]).toBe(20_000);
  });

  it("hears speech that was already going when it started listening", () => {
    const e = new Endpointer();
    const out: [string, number][] = [];
    let t = 0;
    for (let i = 0; i < 8; i++) {
      t = feed(e, -22, 240, t, out);
      t = feed(e, -50, 80, t, out);
    }
    feed(e, -60, 1500, t, out);
    expect(out.map(([ev]) => ev)).toEqual(["speech", "end"]);
  });

  it("takes a cough for nothing", () => {
    const e = new Endpointer();
    const out: [string, number][] = [];
    let t = feed(e, -65, 600, 0, out);
    t = feed(e, -20, 200, t, out);
    feed(e, -65, 1500, t, out);
    expect(out.map(([ev]) => ev)).toEqual(["speech", "no_speech"]);
  });

  it("does not take a steady noisy room for speech, but hears a voice over it", () => {
    const e = new Endpointer();
    const out: [string, number][] = [];
    let t = feed(e, -38, 3000, 0, out);
    expect(out).toEqual([]);
    t = feed(e, -18, 1000, t, out);
    feed(e, -38, 2000, t, out);
    expect(out.map(([ev]) => ev)).toEqual(["speech", "end"]);
  });

  it("treats digital silence as quiet", () => {
    const e = new Endpointer();
    const out: [string, number][] = [];
    feed(e, -Infinity, 7000, 0, out);
    expect(out.map(([ev]) => ev)).toEqual(["no_speech"]);
  });
});

describe("dates as moments use them", () => {
  it("reads due dates as the model writes them", () => {
    expect(parseDue("2026-11-06")).toEqual({ at: new Date(2026, 10, 6), allDay: true });
    expect(parseDue("2026-11-06T15:00:00+03:00")).toEqual({ at: new Date("2026-11-06T12:00:00Z"), allDay: false });
    expect(parseDue("Friday")).toBeNull();
    expect(parseDue(null)).toBeNull();
    expect(parseDue("2026-13-45")).toBeNull();
  });

  it("formats due dates and times in the interface language", () => {
    const now = new Date(2026, 10, 2, 12, 0);
    expect(formatDue("2026-11-06", "en", now)).toBe("Fri 6 Nov");
    expect(formatDue("2026-11-06T15:00:00", "en", now)).toBe("Fri 6 Nov, 15:00");
    expect(formatDue("2026-11-06T15:00:00", "tr", now)).toMatch(/6 Kas.*15:00/);
    expect(formatDue("2027-01-04", "en", now)).toContain("2027");
    expect(formatDue(null, "en", now)).toBeNull();
    expect(shortWhen(new Date(2026, 10, 2, 9, 5).toISOString(), "en", now)).toBe("09:05");
    expect(shortWhen(new Date(2026, 10, 1, 9, 5).toISOString(), "en", now)).toMatch(/1 Nov.*09:05/);
  });

  it("tells the model the time in words, with the exact moment and offset, in at most 80 characters", () => {
    for (const d of [new Date(2026, 8, 30, 23, 59), new Date(2026, 10, 2, 9, 5)]) {
      for (const lang of ["en", "tr"] as const) {
        const s = nowForModel(lang, d);
        expect(s.length).toBeLessThanOrEqual(80);
        expect(s).toMatch(/\(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}[+-]\d{2}:\d{2}\)$/);
      }
    }
    expect(nowForModel("en", new Date(2026, 10, 2, 9, 5))).toContain("2026-11-02T09:05");
  });
});
