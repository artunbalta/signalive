import { describe, expect, it } from "vitest";
import { dashboard, headline, splitRows } from "@/lib/shared/lab/aggregate";
import { csvCell, labResultsCsv, toCsv } from "@/lib/shared/csv";
import type { ChainId, Environment, LabResult, SttProviderId, VoiceStyle } from "@/lib/shared/types";

let n = 0;
function row(p: {
  take?: string;
  chain?: ChainId;
  provider?: SttProviderId;
  voice?: VoiceStyle;
  env?: Environment;
  errors?: number;
  words?: number;
  error?: string | null;
}): LabResult {
  const words = p.words ?? 10;
  const errors = p.errors ?? 0;
  n++;
  return {
    id: `r${n}`,
    runId: "run",
    takeId: p.take ?? `take${n}`,
    phraseId: "en-01",
    language: "en",
    voiceStyle: p.voice ?? "whisper",
    environment: p.env ?? "street",
    deviceLabel: "AirPods",
    chain: p.chain ?? "raw",
    provider: p.provider ?? "deepgram",
    model: "nova-3",
    reference: "a",
    hypothesis: "a",
    refWords: words,
    refChars: words * 5,
    substitutions: errors,
    deletions: 0,
    insertions: 0,
    charErrors: errors * 3,
    wer: p.error ? null : errors / words,
    cer: p.error ? null : (errors * 3) / (words * 5),
    sttLatencyMs: 400,
    audioMs: 2000,
    rmsDbfs: -30,
    snrDbEstimate: 20,
    lowFreqRatio: 0.1,
    audioObjectId: null,
    error: p.error ?? null,
    createdAt: "2026-10-21T10:00:00Z",
  };
}

describe("lab aggregation", () => {
  it("leaves mock and failed rows out, but counts them", () => {
    const s = splitRows([row({}), row({ provider: "mock" }), row({ error: "provider_timeout" })]);
    expect(s.usable).toHaveLength(1);
    expect(s.mock).toBe(1);
    expect(s.failed).toBe(1);
    expect(splitRows([row({ provider: "mock" })], true).usable).toHaveLength(1);
  });

  it("computes corpus WER per group with takes as clusters", () => {
    const rows = [
      row({ take: "t1", chain: "raw", errors: 2 }),
      row({ take: "t1", chain: "raw_rnnoise", errors: 1 }),
      row({ take: "t2", chain: "raw", errors: 4 }),
      row({ take: "t2", chain: "raw_rnnoise", errors: 1 }),
    ];
    const d = dashboard(rows);
    const raw = d.byChain.find((g) => g.key === "raw")!;
    expect(raw.wer.rate).toBeCloseTo(6 / 20);
    expect(raw.wer.n).toBe(2);
    expect(d.byChain.map((g) => g.key)).toEqual(["raw", "raw_rnnoise"]);
    const all = d.byProvider[0]!;
    expect(all.wer.rows).toBe(4);
    expect(all.wer.n).toBe(2);
    expect(all.cer.rate).toBeCloseTo((6 + 2) * 3 / (4 * 50));
  });

  it("orders conditions normal before whisper, then by environment", () => {
    const d = dashboard([row({ voice: "whisper", env: "cafe" }), row({ voice: "normal", env: "vehicle" }), row({ voice: "normal", env: "quiet_room" })]);
    expect(d.byCondition.map((g) => g.key)).toEqual(["normal|quiet_room", "normal|vehicle", "whisper|cafe"]);
  });

  it("headline: whisper in noise, best chain, with its best recognizer", () => {
    const rows = [
      row({ chain: "raw", errors: 5 }),
      row({ chain: "raw_rnnoise", errors: 2, provider: "openai" }),
      row({ chain: "raw_rnnoise", errors: 4, provider: "groq" }),
      row({ chain: "raw_rnnoise", errors: 0, voice: "normal" }),
      row({ chain: "raw_hpf_gate", errors: 0, env: "quiet_room" }),
    ];
    const h = headline(rows)!;
    expect(h.chain).toBe("raw_rnnoise");
    expect(h.stat.wer.rate).toBeCloseTo(6 / 20);
    expect(h.bestProvider?.key).toBe("openai|nova-3");
    expect(headline([row({ voice: "normal" })])).toBeNull();
    expect(headline([row({ env: "quiet_room" })])).toBeNull();
  });
});

describe("csv", () => {
  it("escapes quotes, commas and newlines", () => {
    expect(csvCell('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(0.25)).toBe("0.25");
    expect(csvCell(Number.NaN)).toBe("");
  });

  it("defuses spreadsheet formulas in text", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell(-5)).toBe("-5");
  });

  it("writes a BOM, CRLF and one row per result with Turkish intact", () => {
    const r = { ...row({}), reference: "Işıkları kapat", hypothesis: "ışıkları, kapat" };
    const csv = labResultsCsv([r], new Map([["run", { phraseSetVersion: "v1", dualCapture: true }]]));
    expect(csv.startsWith("﻿created_at,")).toBe(true);
    const lines = csv.trimEnd().split("\r\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("Işıkları kapat");
    expect(lines[1]).toContain('"ışıkları, kapat"');
    expect(lines[1]).toContain(",v1,");
    expect(toCsv(["a"], [])).toBe("﻿a\r\n");
  });
});
