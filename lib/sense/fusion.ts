/**
 * Who is being listened to, from two cues: where the head points and what
 * the EEG decoder says.
 *
 * People mostly face the person they listen to, but not always, so head
 * orientation is a prior: a von Mises bump around the yaw, exp(kappa *
 * cos(yaw - azimuth)), flat when the yaw is unknown. The decoder's decision
 * is evidence for one talker, exp(eegWeight * margin), margin being how far
 * its correlation beat the runner up. Their product, normalised, is the
 * posterior over talkers.
 *
 * Defaults:
 * - kappa 2: a talker 90 degrees off is e^-2, about 0.14 times as likely as
 *   one straight ahead, and one 60 degrees off about 0.37 times.
 * - eegWeight 10: a correlation margin of 0.1 multiplies the decoded
 *   talker's odds by e, about 2.7, and a margin of 0.2 by about 7.4, enough
 *   to overturn facing a talker 60 degrees away.
 */

export const DEFAULT_KAPPA = 2;
export const DEFAULT_EEG_WEIGHT = 10;

export interface FusionInput {
  /** Where each talker stands, degrees, in the same frame as the yaw. */
  azimuthsDeg: number[];
  /** Where the head points, degrees; undefined for no orientation cue. */
  yawDeg?: number;
  /** The decoder's latest decision, if any. */
  eeg?: { talker: number; margin: number } | null;
  /** Concentration of the orientation prior. Default DEFAULT_KAPPA. */
  kappa?: number;
  /** Log odds per unit of correlation margin. Default DEFAULT_EEG_WEIGHT. */
  eegWeight?: number;
}

const RAD = Math.PI / 180;

/** Posterior probability per talker, summing to 1; empty for no talkers. */
export function fuseAttention(input: FusionInput): number[] {
  const { azimuthsDeg, yawDeg, eeg } = input;
  const kappa = input.kappa ?? DEFAULT_KAPPA;
  const eegWeight = input.eegWeight ?? DEFAULT_EEG_WEIGHT;
  const n = azimuthsDeg.length;
  if (n === 0) return [];
  if (eeg && (!Number.isInteger(eeg.talker) || eeg.talker < 0 || eeg.talker >= n)) {
    throw new RangeError(`fusion: talker ${eeg.talker} out of range 0 to ${n - 1}`);
  }
  // Log weights, shifted by their maximum before exp so nothing overflows.
  const logw = azimuthsDeg.map((az, i) => {
    let w = yawDeg === undefined || !Number.isFinite(yawDeg) ? 0 : kappa * Math.cos((yawDeg - az) * RAD);
    if (eeg && i === eeg.talker && Number.isFinite(eeg.margin)) w += eegWeight * eeg.margin;
    return w;
  });
  const top = Math.max(...logw);
  const w = logw.map((l) => Math.exp(l - top));
  const total = w.reduce((a, b) => a + b, 0);
  return w.map((x) => x / total);
}
