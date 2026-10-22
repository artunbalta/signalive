import { seededRandom } from "../shared/stats";

/**
 * The figure on the Rewind screen: a head-and-shoulders bust as a cloud of
 * points on the surface of a signed distance field (ellipsoids, capsules and
 * spheres blended smoothly). Built here, deterministically, so there is no
 * model file to license or load, and every region can move: the jaw lifts
 * and the masseter swells when the figure clenches.
 *
 * Units are about 10 cm: the head is some 2.3 tall. y is up, the face looks
 * toward +z, and the earbud sits in the ear on the +x side.
 */

/** Where the earbud sits, and the muscle that clenches, on the +x side. */
export const EARBUD: readonly [number, number, number] = [0.86, 0.17, -0.06];
export const MASSETER: readonly [number, number, number] = [0.53, -0.14, 0.14];

export interface HeadCloud {
  count: number;
  /** xyz per point. */
  positions: Float32Array;
  /** Unit surface normal per point. */
  normals: Float32Array;
  /** 0..1: how much the point moves with the lower jaw. */
  jaw: Float32Array;
  /** 0..1: closeness to the masseter, the muscle a clench tightens. */
  masseter: Float32Array;
  /** 0..1 per point, for shimmer and staggered effects. */
  seed: Float32Array;
}

function ellipsoid(px: number, py: number, pz: number, cx: number, cy: number, cz: number, rx: number, ry: number, rz: number) {
  const x = px - cx;
  const y = py - cy;
  const z = pz - cz;
  const k0 = Math.sqrt((x / rx) ** 2 + (y / ry) ** 2 + (z / rz) ** 2);
  const k1 = Math.sqrt((x / (rx * rx)) ** 2 + (y / (ry * ry)) ** 2 + (z / (rz * rz)) ** 2);
  return k1 === 0 ? -Math.min(rx, ry, rz) : (k0 * (k0 - 1)) / k1;
}

function sphere(px: number, py: number, pz: number, cx: number, cy: number, cz: number, r: number) {
  return Math.sqrt((px - cx) ** 2 + (py - cy) ** 2 + (pz - cz) ** 2) - r;
}

function capsule(px: number, py: number, pz: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number, r: number) {
  const pax = px - ax;
  const pay = py - ay;
  const paz = pz - az;
  const bax = bx - ax;
  const bay = by - ay;
  const baz = bz - az;
  const h = Math.min(1, Math.max(0, (pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz)));
  return Math.sqrt((pax - bax * h) ** 2 + (pay - bay * h) ** 2 + (paz - baz * h) ** 2) - r;
}

/** Smooth union and smooth subtraction (polynomial, radius k). */
function smin(a: number, b: number, k: number) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}
function smax(a: number, b: number, k: number) {
  return -smin(-a, -b, k);
}

/** Signed distance (approximately) to the bust: negative inside. */
export function headSdf(x: number, y: number, z: number): number {
  const ax = Math.abs(x);
  // Skull and face.
  let d = ellipsoid(x, y, z, 0, 0.62, -0.12, 0.76, 0.88, 0.96);
  d = smin(d, ellipsoid(x, y, z, 0, 0.26, 0.22, 0.64, 0.86, 0.72), 0.25);
  // Brow and cheekbones.
  d = smin(d, ellipsoid(x, y, z, 0, 0.47, 0.72, 0.52, 0.13, 0.19), 0.12);
  d = smin(d, ellipsoid(ax, y, z, 0.42, 0.12, 0.47, 0.22, 0.18, 0.22), 0.12);
  // Lower jaw: body, angles, chin.
  d = smin(d, ellipsoid(x, y, z, 0, -0.3, 0.28, 0.52, 0.36, 0.52), 0.2);
  d = smin(d, ellipsoid(ax, y, z, 0.47, -0.22, -0.04, 0.15, 0.3, 0.26), 0.15);
  d = smin(d, ellipsoid(x, y, z, 0, -0.57, 0.64, 0.24, 0.17, 0.17), 0.12);
  // Nose.
  d = smin(d, capsule(x, y, z, 0, 0.38, 0.87, 0, 0.03, 1.08, 0.092), 0.08);
  d = smin(d, ellipsoid(x, y, z, 0, -0.03, 0.95, 0.17, 0.085, 0.12), 0.06);
  // Lips, and the line between them.
  d = smin(d, ellipsoid(x, y, z, 0, -0.2, 0.87, 0.22, 0.075, 0.11), 0.05);
  d = smin(d, ellipsoid(x, y, z, 0, -0.33, 0.85, 0.2, 0.075, 0.11), 0.05);
  d = smax(d, -ellipsoid(x, y, z, 0, -0.265, 0.97, 0.21, 0.013, 0.08), 0.02);
  // Eye sockets, and eyes in them.
  d = smax(d, -sphere(ax, y, z, 0.27, 0.31, 0.88, 0.15), 0.08);
  d = smin(d, sphere(ax, y, z, 0.27, 0.29, 0.77, 0.12), 0.03);
  // Ears, with a hollow.
  d = smin(d, ellipsoid(ax, y, z, 0.77, 0.2, -0.1, 0.075, 0.3, 0.19), 0.06);
  d = smax(d, -ellipsoid(ax, y, z, 0.84, 0.18, -0.08, 0.05, 0.16, 0.1), 0.03);
  // Neck, shoulders, chest.
  d = smin(d, capsule(x, y, z, 0, -0.4, -0.18, 0, -1.5, -0.22, 0.4), 0.3);
  d = smin(d, ellipsoid(x, y, z, 0, -1.62, -0.28, 1.7, 0.4, 0.72), 0.45);
  d = smin(d, sphere(ax, y, z, 1.52, -1.78, -0.25, 0.42), 0.3);
  d = smin(d, ellipsoid(x, y, z, 0, -2.02, -0.08, 1.25, 0.6, 0.62), 0.3);
  // A clean cut under the bust.
  return smax(d, -(y + 2.2), 0.04);
}

const BOUNDS = { x0: -1.98, x1: 1.98, y0: -2.24, y1: 1.56, z0: -1.26, z1: 1.26 };
const CELL = 0.2;
/** Points are kept within this distance of the surface (about 1 mm). */
const BAND = 0.01;
const BOTTOM = -2.16;

const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/**
 * Samples `count` points evenly over the surface. Only coarse cells the
 * surface passes through are sampled, so most tries land near it.
 */
export function buildHead(count: number, seed = 7): HeadCloud {
  const rand = seededRandom(seed);
  const cells: number[] = [];
  const reach = (CELL * Math.sqrt(3)) / 2 + BAND + 0.04;
  for (let x = BOUNDS.x0; x < BOUNDS.x1; x += CELL) {
    for (let y = BOUNDS.y0; y < BOUNDS.y1; y += CELL) {
      for (let z = BOUNDS.z0; z < BOUNDS.z1; z += CELL) {
        if (Math.abs(headSdf(x + CELL / 2, y + CELL / 2, z + CELL / 2)) <= reach) cells.push(x, y, z);
      }
    }
  }
  const cellCount = cells.length / 3;

  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const jaw = new Float32Array(count);
  const masseter = new Float32Array(count);
  const seeds = new Float32Array(count);
  const h = 0.004;
  let n = 0;
  for (let tries = 0; n < count && tries < count * 200; tries++) {
    const c = Math.floor(rand() * cellCount) * 3;
    const x = cells[c]! + rand() * CELL;
    const y = cells[c + 1]! + rand() * CELL;
    const z = cells[c + 2]! + rand() * CELL;
    if (y < BOTTOM) continue;
    const d = headSdf(x, y, z);
    if (Math.abs(d) > BAND) continue;
    let nx = headSdf(x + h, y, z) - d;
    let ny = headSdf(x, y + h, z) - d;
    let nz = headSdf(x, y, z + h) - d;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    // Settle onto the surface along the normal.
    const px = x - nx * d;
    const py = y - ny * d;
    const pz = z - nz * d;
    positions.set([px, py, pz], n * 3);
    normals.set([nx, ny, nz], n * 3);
    jaw[n] = smoothstep(-0.08, -0.3, py) * (1 - smoothstep(-0.7, -0.86, py)) * smoothstep(-0.3, -0.04, pz);
    const mdx = Math.abs(px) - MASSETER[0];
    const mdy = py - MASSETER[1];
    const mdz = pz - MASSETER[2];
    masseter[n] = Math.exp(-(mdx * mdx + mdy * mdy + mdz * mdz) / (2 * 0.17 * 0.17));
    seeds[n] = rand();
    n++;
  }
  return {
    count: n,
    positions: positions.subarray(0, n * 3),
    normals: normals.subarray(0, n * 3),
    jaw: jaw.subarray(0, n),
    masseter: masseter.subarray(0, n),
    seed: seeds.subarray(0, n),
  };
}
