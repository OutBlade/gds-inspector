import type { GdsPath, GdsRef } from "./types";

/** 2D affine transform: x' = a x + c y + tx, y' = b x + d y + ty. */
export interface Affine {
  a: number;
  b: number;
  c: number;
  d: number;
  tx: number;
  ty: number;
}

export const IDENTITY: Affine = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };

export function compose(p: Affine, q: Affine): Affine {
  // p after q
  return {
    a: p.a * q.a + p.c * q.b,
    b: p.b * q.a + p.d * q.b,
    c: p.a * q.c + p.c * q.d,
    d: p.b * q.c + p.d * q.d,
    tx: p.a * q.tx + p.c * q.ty + p.tx,
    ty: p.b * q.tx + p.d * q.ty + p.ty,
  };
}

export function invert(m: Affine): Affine {
  const det = m.a * m.d - m.b * m.c;
  const a = m.d / det;
  const b = -m.b / det;
  const c = -m.c / det;
  const d = m.a / det;
  return { a, b, c, d, tx: -(a * m.tx + c * m.ty), ty: -(b * m.tx + d * m.ty) };
}

const cosd = (deg: number) => {
  const r = ((deg % 360) + 360) % 360;
  if (r === 0) return 1;
  if (r === 90 || r === 270) return 0;
  if (r === 180) return -1;
  return Math.cos((r * Math.PI) / 180);
};
const sind = (deg: number) => cosd(deg - 90);

/** Transform of one reference element (without the AREF lattice offset), in the given scale. */
export function refTransform(r: GdsRef, scale: number): Affine {
  const cs = cosd(r.angle) * r.mag;
  const sn = sind(r.angle) * r.mag;
  const f = r.reflect ? -1 : 1;
  // rotate(angle) * scale(mag) * reflectX
  return { a: cs, b: sn, c: -sn * f, d: cs * f, tx: r.x * scale, ty: r.y * scale };
}

export function applyX(m: Affine, x: number, y: number) {
  return m.a * x + m.c * y + m.tx;
}
export function applyY(m: Affine, x: number, y: number) {
  return m.b * x + m.d * y + m.ty;
}

export type BBox = [number, number, number, number];

export const emptyBox = (): BBox => [Infinity, Infinity, -Infinity, -Infinity];
export const boxValid = (b: BBox) => b[0] <= b[2] && b[1] <= b[3];

export function ringBox(xy: ArrayLike<number>, out: BBox = emptyBox()): BBox {
  for (let i = 0; i < xy.length; i += 2) {
    const x = xy[i];
    const y = xy[i + 1];
    if (x < out[0]) out[0] = x;
    if (y < out[1]) out[1] = y;
    if (x > out[2]) out[2] = x;
    if (y > out[3]) out[3] = y;
  }
  return out;
}

export function transformBox(m: Affine, b: BBox, out: BBox = emptyBox()): BBox {
  const xs = [b[0], b[2], b[2], b[0]];
  const ys = [b[1], b[1], b[3], b[3]];
  for (let i = 0; i < 4; i++) {
    const x = applyX(m, xs[i], ys[i]);
    const y = applyY(m, xs[i], ys[i]);
    if (x < out[0]) out[0] = x;
    if (y < out[1]) out[1] = y;
    if (x > out[2]) out[2] = x;
    if (y > out[3]) out[3] = y;
  }
  return out;
}

export function unionBox(a: BBox, b: BBox): BBox {
  a[0] = Math.min(a[0], b[0]);
  a[1] = Math.min(a[1], b[1]);
  a[2] = Math.max(a[2], b[2]);
  a[3] = Math.max(a[3], b[3]);
  return a;
}

/** Signed shoelace area. */
export function ringArea(xy: ArrayLike<number>): number {
  let s = 0;
  const n = xy.length;
  for (let i = 0; i < n; i += 2) {
    const j = (i + 2) % n;
    s += xy[i] * xy[j + 1] - xy[j] * xy[i + 1];
  }
  return s / 2;
}

export function ringMinEdge(xy: ArrayLike<number>): number {
  const n = xy.length;
  let m = Infinity;
  for (let i = 0; i < n; i += 2) {
    const j = (i + 2) % n;
    const l = Math.hypot(xy[j] - xy[i], xy[j + 1] - xy[i + 1]);
    if (l > 0 && l < m) m = l;
  }
  return m === Infinity ? 0 : m;
}

export function pointInRing(xy: ArrayLike<number>, px: number, py: number): boolean {
  let inside = false;
  const n = xy.length;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    const xi = xy[i];
    const yi = xy[i + 1];
    const xj = xy[j];
    const yj = xy[j + 1];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function isRectangle(xy: ArrayLike<number>): boolean {
  if (xy.length !== 8) return false;
  return (
    (xy[0] === xy[2] && xy[3] === xy[5] && xy[4] === xy[6] && xy[7] === xy[1]) ||
    (xy[1] === xy[3] && xy[2] === xy[4] && xy[5] === xy[7] && xy[6] === xy[0])
  );
}

/**
 * Outline of a GDSII PATH as a closed ring in the path's own units.
 * Pathtype 0 flush, 1 round, 2 half-width extension, 4 custom extension.
 */
export function pathToRing(p: GdsPath): number[] | null {
  const hw = Math.abs(p.width) / 2;
  if (hw === 0) return null;
  const pts: number[] = [];
  for (let i = 0; i < p.xy.length; i += 2) {
    const x = p.xy[i];
    const y = p.xy[i + 1];
    const n = pts.length;
    if (n >= 2 && pts[n - 2] === x && pts[n - 1] === y) continue;
    pts.push(x, y);
  }
  const count = pts.length / 2;
  if (count < 2) return null;

  let ext0 = 0;
  let ext1 = 0;
  if (p.pathtype === 2) ext0 = ext1 = hw;
  else if (p.pathtype === 4) {
    ext0 = p.bgnextn;
    ext1 = p.endextn;
  }

  const ux: number[] = [];
  const uy: number[] = [];
  for (let i = 0; i < count - 1; i++) {
    const dx = pts[2 * i + 2] - pts[2 * i];
    const dy = pts[2 * i + 3] - pts[2 * i + 1];
    const l = Math.hypot(dx, dy);
    ux.push(dx / l);
    uy.push(dy / l);
  }
  const last = count - 2;
  pts[0] -= ux[0] * ext0;
  pts[1] -= uy[0] * ext0;
  pts[2 * count - 2] += ux[last] * ext1;
  pts[2 * count - 1] += uy[last] * ext1;

  const left: number[] = [];
  const right: number[] = [];
  for (let i = 0; i < count; i++) {
    const x = pts[2 * i];
    const y = pts[2 * i + 1];
    if (i === 0 || i === count - 1) {
      const s = i === 0 ? 0 : last;
      const nx = -uy[s] * hw;
      const ny = ux[s] * hw;
      left.push(x + nx, y + ny);
      right.push(x - nx, y - ny);
      continue;
    }
    const n0x = -uy[i - 1];
    const n0y = ux[i - 1];
    const n1x = -uy[i];
    const n1y = ux[i];
    let mx = n0x + n1x;
    let my = n0y + n1y;
    const ml = Math.hypot(mx, my);
    const cosHalf = ml / 2;
    if (ml < 1e-9 || cosHalf < 0.25) {
      // Too sharp for a miter: bevel both sides.
      left.push(x + n0x * hw, y + n0y * hw, x + n1x * hw, y + n1y * hw);
      right.push(x - n0x * hw, y - n0y * hw, x - n1x * hw, y - n1y * hw);
      continue;
    }
    mx /= ml;
    my /= ml;
    const k = hw / cosHalf;
    left.push(x + mx * k, y + my * k);
    right.push(x - mx * k, y - my * k);
  }

  const ring = left;
  if (p.pathtype === 1) appendArc(ring, pts[2 * count - 2], pts[2 * count - 1], ux[last], uy[last], hw);
  for (let i = right.length - 2; i >= 0; i -= 2) ring.push(right[i], right[i + 1]);
  if (p.pathtype === 1) appendArc(ring, pts[0], pts[1], -ux[0], -uy[0], hw);
  return ring;
}

function appendArc(out: number[], cx: number, cy: number, dx: number, dy: number, r: number) {
  // Half circle from the left normal through the direction to the right normal.
  const start = Math.atan2(dx, -dy);
  const steps = 12;
  for (let i = 1; i < steps; i++) {
    const t = start - (Math.PI * i) / steps;
    out.push(cx + Math.cos(t) * r, cy + Math.sin(t) * r);
  }
}
