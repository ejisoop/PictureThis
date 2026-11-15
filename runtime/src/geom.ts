// Projective geometry shared by the sandbox stage, the host UI and the server.
// Normalised coordinates everywhere: (0,0) is the top-left of the photo/page,
// (1,1) the bottom-right.

export type Pt = [number, number];
/** Page corners in normalised photo coordinates: top-left, top-right, bottom-right, bottom-left. */
export type Quad = [Pt, Pt, Pt, Pt];
export type Mat3 = [number, number, number, number, number, number, number, number, number];

export const FULL_QUAD: Quad = [[0, 0], [1, 0], [1, 1], [0, 1]];

/** Solves A x = b (n×n) by Gaussian elimination with partial pivoting. */
function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c];
    if (Math.abs(d) < 1e-12) throw new Error('degenerate quad');
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / d;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((r, i) => r[n] / r[i]);
}

/**
 * Homography mapping the unit square (page u,v) onto the quad (photo x,y),
 * row-major. unit (0,0)→q[0], (1,0)→q[1], (1,1)→q[2], (0,1)→q[3].
 */
export function squareToQuad(q: Quad): Mat3 {
  const src: Pt[] = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [u, v] = src[i];
    const [x, y] = q[i];
    A.push([u, v, 1, 0, 0, 0, -u * x, -v * x]);
    b.push(x);
    A.push([0, 0, 0, u, v, 1, -u * y, -v * y]);
    b.push(y);
  }
  const h = solve(A, b);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

export function applyH(H: Mat3, u: number, v: number): Pt {
  const w = H[6] * u + H[7] * v + H[8];
  return [(H[0] * u + H[1] * v + H[2]) / w, (H[3] * u + H[4] * v + H[5]) / w];
}

const dist = (a: Pt, b: Pt, sx: number, sy: number) => Math.hypot((a[0] - b[0]) * sx, (a[1] - b[1]) * sy);

/** Width/height of the flattened page, estimated from the quad's edges in photo pixels. */
export function quadAspect(q: Quad, photoW: number, photoH: number): number {
  const w = (dist(q[0], q[1], photoW, photoH) + dist(q[3], q[2], photoW, photoH)) / 2;
  const h = (dist(q[0], q[3], photoW, photoH) + dist(q[1], q[2], photoW, photoH)) / 2;
  return h > 0 ? w / h : 0.75;
}

/** Axis-aligned box (normalised photo coords) enclosing a page-space box after warping. */
export function pageBoxToPhotoBox(q: Quad, box: { x0: number; y0: number; x1: number; y1: number }) {
  const H = squareToQuad(q);
  const pts = [applyH(H, box.x0, box.y0), applyH(H, box.x1, box.y0), applyH(H, box.x1, box.y1), applyH(H, box.x0, box.y1)];
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const c = (v: number) => Math.min(1, Math.max(0, v));
  return { x0: c(Math.min(...xs)), y0: c(Math.min(...ys)), x1: c(Math.max(...xs)), y1: c(Math.max(...ys)) };
}

export function isValidQuad(q: unknown): q is Quad {
  if (!Array.isArray(q) || q.length !== 4) return false;
  if (!q.every((p) => Array.isArray(p) && p.length === 2 && p.every((n) => Number.isFinite(n) && n > -0.2 && n < 1.2))) return false;
  // convex, consistently wound
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const [a, b, c] = [q[i], q[(i + 1) % 4], q[(i + 2) % 4]] as Pt[];
    const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cr) < 1e-6) return false;
    if (sign && Math.sign(cr) !== sign) return false;
    sign = Math.sign(cr);
  }
  return true;
}

/**
 * Is this a believable page outline for someone reading? Gemini sometimes
 * returns a tiny or wildly skewed quad (or swaps x/y); flattening through it
 * stretches the photo absurdly. Normalised photo coordinates.
 */
export function plausiblePageQuad(q: Quad, o: { minArea?: number; minAngle?: number; maxAngle?: number; maxSideRatio?: number } = {}) {
  if (!isValidQuad(q)) return false;
  const minArea = o.minArea ?? 0.2, minA = o.minAngle ?? 55, maxA = o.maxAngle ?? 125, maxR = o.maxSideRatio ?? 1.8;
  // signed area > 0 ⇔ tl, tr, br, bl run clockwise on screen (y down); negative = mirrored / x-y swapped
  const signed = q.reduce((s, p, i) => { const n = q[(i + 1) % 4]; return s + p[0] * n[1] - n[0] * p[1]; }, 0) / 2;
  if (signed < minArea) return false;
  for (let i = 0; i < 4; i++) {
    const p = q[i], a = q[(i + 3) % 4], b = q[(i + 1) % 4];
    const v1 = [a[0] - p[0], a[1] - p[1]], v2 = [b[0] - p[0], b[1] - p[1]];
    const ang = (Math.acos(Math.max(-1, Math.min(1, (v1[0] * v2[0] + v1[1] * v2[1]) / (Math.hypot(v1[0], v1[1]) * Math.hypot(v2[0], v2[1]))))) * 180) / Math.PI;
    if (ang < minA || ang > maxA) return false;
  }
  const d = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const ratio = (x: number, y: number) => Math.max(x, y) / Math.max(1e-6, Math.min(x, y));
  return ratio(d(q[0], q[1]), d(q[3], q[2])) <= maxR && ratio(d(q[0], q[3]), d(q[1], q[2])) <= maxR;
}

/** Gemini's corners if believable, else the same with x/y swapped, else the whole photo. */
export function sanePageQuad(q: Quad): { quad: Quad; fixed: 'ok' | 'swapped' | 'full-frame' } {
  if (plausiblePageQuad(q)) return { quad: q, fixed: 'ok' };
  const swapped = q.map(([x, y]) => [y, x]) as Quad;
  if (plausiblePageQuad(swapped)) return { quad: swapped, fixed: 'swapped' };
  return { quad: FULL_QUAD, fixed: 'full-frame' };
}
