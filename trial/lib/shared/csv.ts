import type { LabResult, LabRun } from "./types";

/**
 * RFC 4180 CSV with CRLF line ends and a UTF-8 byte order mark, so Turkish
 * text opens correctly in Excel. Text cells that a spreadsheet would read as
 * a formula (starting with = + - @ tab or CR) get a leading apostrophe:
 * transcripts come from recognizer output and are not trusted.
 */

type Cell = string | number | boolean | null | undefined;

export function csvCell(v: Cell): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  if (typeof v === "boolean") return v ? "true" : "false";
  let s = v;
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: Cell[][]): string {
  return `﻿${[headers, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

export const LAB_CSV_HEADERS = [
  "created_at", "participant", "run_id", "take_id", "phrase_id", "phrase_set_version", "language",
  "voice_style", "environment", "device_label", "dual_capture", "chain", "provider", "model",
  "reference", "hypothesis", "ref_words", "substitutions", "deletions", "insertions", "wer",
  "ref_chars", "char_errors", "cer", "stt_latency_ms", "audio_ms", "rms_dbfs", "snr_db_estimate",
  "low_freq_ratio", "audio_stored", "error",
];

export function labResultsCsv(
  rows: readonly (LabResult & { participant?: string })[],
  runs: ReadonlyMap<string, Pick<LabRun, "phraseSetVersion" | "dualCapture">> = new Map(),
): string {
  return toCsv(
    LAB_CSV_HEADERS,
    rows.map((r) => {
      const run = runs.get(r.runId);
      return [
        r.createdAt, r.participant ?? "", r.runId, r.takeId, r.phraseId, run?.phraseSetVersion ?? "", r.language,
        r.voiceStyle, r.environment, r.deviceLabel, run ? run.dualCapture : "", r.chain, r.provider, r.model,
        r.reference, r.hypothesis, r.refWords, r.substitutions, r.deletions, r.insertions, r.wer,
        r.refChars, r.charErrors, r.cer, r.sttLatencyMs, r.audioMs, r.rmsDbfs, r.snrDbEstimate,
        r.lowFreqRatio, r.audioObjectId !== null, r.error,
      ];
    }),
  );
}
