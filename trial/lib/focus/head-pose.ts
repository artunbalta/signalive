/**
 * Head direction for the Focus screen, from MediaPipe's facial transformation
 * matrix: the rotation (and translation) that takes the canonical face model
 * to the face seen by the camera, as a column-major 4x4. Yaw is its rotation
 * about the vertical axis. Measured on a rendered scanned head turned 38
 * degrees each way, it reads about 34. Zero is facing the camera; a
 * "straight ahead" the user sets absorbs a camera placed off to one side.
 *
 * (Reading the turn from where the nose sits between the cheeks in the image
 * was tried first and saturates past about 30 degrees: the nose tip moves
 * beyond the far cheek's outline.)
 */

/** Degrees the head is turned, right positive; null for an unusable matrix. */
export function headYaw(matrix: ArrayLike<number>): number | null {
  if (matrix.length < 11) return null;
  const s = matrix[8]!;
  const c = matrix[10]!;
  if (!Number.isFinite(s) || !Number.isFinite(c) || (s === 0 && c === 0)) return null;
  return (-Math.atan2(s, c) * 180) / Math.PI;
}

/** A comfortable turn, while still seeing the screen, reaches the side voices. */
export const STEER_GAIN = 1.6;
export const STEER_MAX = 80;

/** The angle the scene and the audio follow, from a head yaw and the straight-ahead yaw. */
export function steering(yawDeg: number, straightDeg: number): number {
  return Math.max(-STEER_MAX, Math.min(STEER_MAX, (yawDeg - straightDeg) * STEER_GAIN));
}

export function median(values: readonly number[]): number {
  const s = [...values].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}
