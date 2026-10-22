"use client";

/**
 * Device discovery and the heuristics the setup wizard uses. Labels are only
 * available after microphone permission, and Safari lists no outputs.
 */

export interface AudioDevice {
  deviceId: string;
  label: string;
  groupId: string;
  /** Chrome's "default" and "communications" pseudo devices. */
  virtual: boolean;
}

const EARBUD_HINT =
  /airpods|buds|earbud|earphone|headset|headphone|hands-?free|bluetooth|\bbt\b|jabra|bose|sony|\bwf-|\bwh-|beats|pixel buds|galaxy|jbl|soundcore|anker|nothing ear|freebuds|redmi|sennheiser|shokz|powerbeats|marshall|skullcandy/i;
const HANDS_FREE_HINT = /hands-?free|\bhfp\b|\bag audio\b|\bsco\b/i;
const BUILT_IN_HINT = /built-?in|internal|macbook|iphone|ipad|default|dahili|array|realtek|integrated/i;

export const looksLikeEarbuds = (label: string) => EARBUD_HINT.test(label) && !BUILT_IN_HINT.test(label);
export const looksHandsFree = (label: string) => HANDS_FREE_HINT.test(label);
export const looksBuiltIn = (label: string) => BUILT_IN_HINT.test(label) && !EARBUD_HINT.test(label);

export async function listDevices(): Promise<{ inputs: AudioDevice[]; outputs: AudioDevice[] }> {
  const all = await navigator.mediaDevices.enumerateDevices();
  const map = (kind: MediaDeviceKind) =>
    all
      .filter((d) => d.kind === kind && d.deviceId)
      .map((d) => ({
        deviceId: d.deviceId,
        label: d.label,
        groupId: d.groupId,
        virtual: d.deviceId === "default" || d.deviceId === "communications",
      }));
  return { inputs: map("audioinput"), outputs: map("audiooutput") };
}

/** Earbuds first, then the system default, then the rest. */
export function pickInput(inputs: AudioDevice[], preferred?: string): AudioDevice | undefined {
  return (
    inputs.find((d) => d.deviceId === preferred) ??
    inputs.find((d) => !d.virtual && looksLikeEarbuds(d.label)) ??
    inputs.find((d) => d.deviceId === "default") ??
    inputs[0]
  );
}

/** A microphone to compare against: built in, and not the one in use. */
export function pickComparison(inputs: AudioDevice[], current: AudioDevice | undefined): AudioDevice | undefined {
  const others = inputs.filter((d) => !d.virtual && d.deviceId !== current?.deviceId && d.groupId !== current?.groupId);
  return others.find((d) => looksBuiltIn(d.label)) ?? others.find((d) => !looksLikeEarbuds(d.label)) ?? others[0];
}

export function outputSelectionSupported(): boolean {
  return typeof AudioContext !== "undefined" && "setSinkId" in AudioContext.prototype;
}

export type MicErrorCode = "mic_denied" | "mic_not_found" | "mic_in_use" | "mic_insecure" | "audio_unsupported";

export class MicError extends Error {
  constructor(readonly code: MicErrorCode) {
    super(code);
    this.name = "MicError";
  }
}

export function toMicError(err: unknown): MicError {
  if (err instanceof MicError) return err;
  if (typeof window !== "undefined" && !window.isSecureContext) return new MicError("mic_insecure");
  const name = err instanceof DOMException || err instanceof Error ? err.name : "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
    case "PermissionDeniedError":
      return new MicError("mic_denied");
    case "NotFoundError":
    case "OverconstrainedError":
    case "DevicesNotFoundError":
      return new MicError("mic_not_found");
    case "NotReadableError":
    case "AbortError":
    case "TrackStartError":
      return new MicError("mic_in_use");
    default:
      return new MicError("audio_unsupported");
  }
}
