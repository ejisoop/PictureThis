// Maths helpers exposed as lp.ode / lp.surface / lp.vectorField / lp.trace.
import * as THREE from 'three';

export type Rhs = (t: number, y: number[], out: number[]) => number[] | void;

/** RK4 integrator over a state vector. `rhs` may return dy or fill `out`. */
export function ode(rhs: Rhs, state: number[]) {
  const n = state.length;
  const k = [0, 1, 2, 3].map(() => new Array(n).fill(0));
  const tmp = new Array(n).fill(0);
  const f = (t: number, y: number[], out: number[]) => {
    const r = rhs(t, y, out);
    if (r) for (let i = 0; i < n; i++) out[i] = r[i];
    return out;
  };
  const api: { y: number[]; t: number; step(dt: number, substeps?: number): number[]; set(y: number[], t?: number): void } = {
    y: state.slice(),
    t: 0,
    /** advance by dt, split into substeps (dt is clamped to 1/20 s) */
    step(dt: number, substeps = 4) {
      const h = Math.min(dt, 0.05) / substeps;
      for (let s = 0; s < substeps; s++) {
        const y = api.y, t = api.t;
        f(t, y, k[0]);
        for (let i = 0; i < n; i++) tmp[i] = y[i] + (h / 2) * k[0][i];
        f(t + h / 2, tmp, k[1]);
        for (let i = 0; i < n; i++) tmp[i] = y[i] + (h / 2) * k[1][i];
        f(t + h / 2, tmp, k[2]);
        for (let i = 0; i < n; i++) tmp[i] = y[i] + h * k[2][i];
        f(t + h, tmp, k[3]);
        for (let i = 0; i < n; i++) y[i] += (h / 6) * (k[0][i] + 2 * k[1][i] + 2 * k[2][i] + k[3][i]);
        api.t += h;
      }
      return api.y;
    },
    set(y: number[], t = api.t) {
      for (let i = 0; i < n; i++) api.y[i] = y[i];
      api.t = t;
    },
  };
  return api;
}

export interface SurfaceDomain {
  x: [number, number];
  y: [number, number];
  res?: number;
  /** world units per maths unit along x, y (page, "up the page" = −z) and f (height) */
  scale?: [number, number, number];
}

/**
 * z = f(x, y) as a BufferGeometry. Maths x → world x, maths y → world −z,
 * f → world y (up, out of the page). Centred on the domain's middle.
 * geometry.userData.update(fn) recomputes heights in place.
 */
export function surface(fn: (x: number, y: number) => number, d: SurfaceDomain) {
  const res = Math.max(4, Math.min(200, d.res ?? 64));
  const [sx, sy, sz] = d.scale ?? [1, 1, 1];
  const geo = new THREE.PlaneGeometry(1, 1, res, res);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const cx = (d.x[0] + d.x[1]) / 2, cy = (d.y[0] + d.y[1]) / 2;
  const update = (f: (x: number, y: number) => number) => {
    for (let i = 0; i <= res; i++) {
      for (let j = 0; j <= res; j++) {
        const k = i * (res + 1) + j;
        const x = d.x[0] + ((d.x[1] - d.x[0]) * j) / res;
        const y = d.y[1] - ((d.y[1] - d.y[0]) * i) / res;
        let z = f(x, y);
        if (!Number.isFinite(z)) z = 0;
        pos.setXYZ(k, (x - cx) * sx, z * sz, -(y - cy) * sy);
      }
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
  };
  update(fn);
  geo.userData.update = update;
  return geo;
}

export type Field2 = (x: number, y: number) => [number, number];
export type Field3 = (x: number, y: number, z: number) => [number, number, number];

/** samples a 2D field on a grid: [{ p: [x, y], v: [vx, vy], m: |v| }] */
export function vectorField(fn: Field2, d: { x: [number, number]; y: [number, number]; n?: number | [number, number] }) {
  const [nx, ny] = Array.isArray(d.n) ? d.n : [d.n ?? 9, d.n ?? 9];
  const out: { p: [number, number]; v: [number, number]; m: number }[] = [];
  for (let i = 0; i < ny; i++) {
    for (let j = 0; j < nx; j++) {
      const x = d.x[0] + ((d.x[1] - d.x[0]) * (j + 0.5)) / nx;
      const y = d.y[0] + ((d.y[1] - d.y[0]) * (i + 0.5)) / ny;
      const v = fn(x, y);
      const m = Math.hypot(v[0], v[1]);
      if (Number.isFinite(m)) out.push({ p: [x, y], v, m });
    }
  }
  return out;
}

export interface TraceOpts {
  step?: number;
  maxSteps?: number;
  /** stop outside this box ([x0,x1],[y0,y1]); 2D only */
  bounds?: { x: [number, number]; y: [number, number] };
  /** trace both directions from each seed */
  both?: boolean;
  /** stop when the field magnitude drops below this */
  minSpeed?: number;
  /** stop predicate (e.g. reached a pole) */
  stop?: (p: number[]) => boolean;
}

/**
 * Streamlines through a 2D or 3D field from each seed, RK4 with unit-speed
 * normalisation. Returns arrays of points ([x,y] or [x,y,z]).
 */
export function trace(field: Field2 | Field3, seeds: number[][], o: TraceOpts = {}) {
  const h = o.step ?? 0.02, max = o.maxSteps ?? 400, minS = o.minSpeed ?? 1e-6;
  const dir = (p: number[]): number[] | null => {
    const v = (field as (...a: number[]) => number[])(...p);
    const m = Math.hypot(...v);
    if (!Number.isFinite(m) || m < minS) return null;
    return v.map((c) => c / m);
  };
  const inside = (p: number[]) => !o.bounds || (p[0] >= o.bounds.x[0] && p[0] <= o.bounds.x[1] && p[1] >= o.bounds.y[0] && p[1] <= o.bounds.y[1]);
  const run = (seed: number[], sgn: number) => {
    const pts = [seed.slice()];
    let p = seed.slice();
    for (let s = 0; s < max; s++) {
      const add = (a: number[], b: number[], k: number) => a.map((c, i) => c + b[i] * k * sgn);
      const k1 = dir(p);
      if (!k1) break;
      const k2 = dir(add(p, k1, h / 2));
      if (!k2) break;
      const k3 = dir(add(p, k2, h / 2));
      if (!k3) break;
      const k4 = dir(add(p, k3, h));
      if (!k4) break;
      p = p.map((c, i) => c + (sgn * h * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i])) / 6);
      if (!p.every(Number.isFinite) || !inside(p)) break;
      pts.push(p);
      if (o.stop?.(p)) break;
    }
    return pts;
  };
  return seeds.map((s) => {
    const fwd = run(s, 1);
    if (!o.both) return fwd;
    const back = run(s, -1).reverse();
    return [...back.slice(0, -1), ...fwd];
  });
}
