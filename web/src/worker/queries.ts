import Flatbush from "flatbush";
import { applyX, applyY, invert, pointInRing, ringArea, ringBox, transformBox, emptyBox } from "../gds/geometry";
import type { Affine, BBox } from "../gds/geometry";
import { placement, placementPath, ringCoords, GALLERY_KEY, KIND_BOX, KIND_PATH } from "./model";
import type { Model, Placements } from "./model";
import type { Label, PickHit, SectionLayer } from "./protocol";

/** Labels of a cell appear once one placement spans at least this many pixels. */
const MIN_CELL_PX = 90;

export function localRadius(m: Affine, r: number) {
  const s = Math.hypot(m.a, m.b) || 1;
  return r / s;
}

export function worldRing(m: Affine, xy: Float64Array): Float64Array {
  const out = new Float64Array(xy.length);
  for (let i = 0; i < xy.length; i += 2) {
    out[i] = applyX(m, xy[i], xy[i + 1]);
    out[i + 1] = applyY(m, xy[i], xy[i + 1]);
  }
  return out;
}

/** Spatial queries over the flattened placements of one top cell. */
export class Queries {
  private instIndex: Flatbush | null = null;
  private instCell: Int32Array = new Int32Array(0);
  private instK: Int32Array = new Int32Array(0);
  private ringIndex = new Map<number, Flatbush>();

  constructor(
    readonly model: Model,
    readonly pl: Placements,
  ) {}

  private ensureInstIndex() {
    const m = this.model;
    const p = this.pl;
    if (this.instIndex) return;
    let n = 0;
    for (const c of m.cells) if (p.count[c.id] && (c.ringKey.length || c.texts.length)) n += p.count[c.id];
    const idx = new Flatbush(Math.max(1, n));
    this.instCell = new Int32Array(n);
    this.instK = new Int32Array(n);
    let i = 0;
    const box = emptyBox();
    for (const c of m.cells) {
      const cnt = p.count[c.id];
      if (!cnt || !(c.ringKey.length || c.texts.length)) continue;
      const own: BBox = [...c.ownBox] as BBox;
      for (const t of c.texts) {
        own[0] = Math.min(own[0], t.x);
        own[1] = Math.min(own[1], t.y);
        own[2] = Math.max(own[2], t.x);
        own[3] = Math.max(own[3], t.y);
      }
      for (let k = 0; k < cnt; k++) {
        box[0] = box[1] = Infinity;
        box[2] = box[3] = -Infinity;
        transformBox(placement(p, c.id, k), own, box);
        idx.add(box[0], box[1], box[2], box[3]);
        this.instCell[i] = c.id;
        this.instK[i] = k;
        i++;
      }
    }
    if (n === 0) idx.add(0, 0, 0, 0);
    idx.finish();
    this.instIndex = idx;
  }

  private cellRingIndex(cellId: number): Flatbush | null {
    const c = this.model.cells[cellId];
    if (!c.ringKey.length) return null;
    let idx = this.ringIndex.get(cellId);
    if (idx) return idx;
    idx = new Flatbush(c.ringKey.length);
    for (let i = 0; i < c.ringKey.length; i++) {
      const b = ringBox(ringCoords(c, i));
      idx.add(b[0], b[1], b[2], b[3]);
    }
    idx.finish();
    this.ringIndex.set(cellId, idx);
    return idx;
  }



  pick(x: number, y: number, tol: number, keys: Set<number>, hidden: Set<number>): PickHit[] {
    this.ensureInstIndex();
    const m = this.model;
    const p = this.pl;
    const hits: PickHit[] = [];
    const near: PickHit[] = [];
    const cands = this.instIndex!.search(x - tol, y - tol, x + tol, y + tol);
    for (const it of cands) {
      const cellId = this.instCell[it];
      if (hidden.has(cellId)) continue;
      const ri = this.cellRingIndex(cellId);
      if (!ri) continue;
      const cell = m.cells[cellId];
      const xf = placement(p, cellId, this.instK[it]);
      const inv = invert(xf);
      const lx = applyX(inv, x, y);
      const ly = applyY(inv, x, y);
      const lt = localRadius(xf, tol);
      for (const r of ri.search(lx - lt, ly - lt, lx + lt, ly + lt)) {
        const key = cell.ringKey[r];
        if (!keys.has(key)) continue;
        const xy = ringCoords(cell, r);
        const inside = pointInRing(xy, lx, ly);
        if (!inside && near.length > 32) continue;
        const ring = worldRing(xf, xy);
        const hit: PickHit = {
          key,
          cell: cell.name,
          path: placementPath(m, p, cellId, this.instK[it]),
          area: Math.abs(ringArea(ring)),
          box: ringBox(ring),
          ring,
          kind: cell.ringKind[r] === KIND_PATH ? "path" : cell.ringKind[r] === KIND_BOX ? "box" : "boundary",
        };
        (inside ? hits : near).push(hit);
        if (hits.length >= 64) return hits;
      }
    }
    if (hits.length) return hits;
    // Nothing under the cursor: offer the smallest shape within the tolerance.
    return near.sort((a, b) => a.area - b.area).slice(0, 1);
  }

  snap(x: number, y: number, r: number, keys: Set<number>) {
    this.ensureInstIndex();
    const m = this.model;
    const p = this.pl;
    let best: { x: number; y: number; kind: "vertex" | "edge" } | null = null;
    let bestD = r;
    let bestEdge: { x: number; y: number } | null = null;
    let bestEdgeD = r;
    for (const it of this.instIndex!.search(x - r, y - r, x + r, y + r)) {
      const cellId = this.instCell[it];
      const ri = this.cellRingIndex(cellId);
      if (!ri) continue;
      const cell = m.cells[cellId];
      const xf = placement(p, cellId, this.instK[it]);
      const inv = invert(xf);
      const lx = applyX(inv, x, y);
      const ly = applyY(inv, x, y);
      const lr = localRadius(xf, r);
      for (const ringId of ri.search(lx - lr, ly - lr, lx + lr, ly + lr)) {
        if (!keys.has(cell.ringKey[ringId])) continue;
        const xy = ringCoords(cell, ringId);
        const n = xy.length;
        for (let i = 0; i < n; i += 2) {
          const wx = applyX(xf, xy[i], xy[i + 1]);
          const wy = applyY(xf, xy[i], xy[i + 1]);
          const d = Math.hypot(wx - x, wy - y);
          if (d < bestD) {
            bestD = d;
            best = { x: wx, y: wy, kind: "vertex" };
          }
          const j = (i + 2) % n;
          const qx = applyX(xf, xy[j], xy[j + 1]);
          const qy = applyY(xf, xy[j], xy[j + 1]);
          const ex = qx - wx;
          const ey = qy - wy;
          const l2 = ex * ex + ey * ey;
          if (l2 === 0) continue;
          const t = Math.max(0, Math.min(1, ((x - wx) * ex + (y - wy) * ey) / l2));
          const px = wx + t * ex;
          const py = wy + t * ey;
          const de = Math.hypot(px - x, py - y);
          if (de < bestEdgeD) {
            bestEdgeD = de;
            bestEdge = { x: px, y: py };
          }
        }
      }
    }
    if (best) return best;
    if (bestEdge) return { ...bestEdge, kind: "edge" as const };
    return null;
  }

  section(x0: number, y0: number, x1: number, y1: number, keys: Set<number>): SectionLayer[] {
    this.ensureInstIndex();
    const m = this.model;
    const p = this.pl;
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (len === 0) return [];
    const spans = new Map<number, number[]>();
    const cands = this.instIndex!.search(Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1));
    for (const it of cands.slice(0, 400_000)) {
      const cellId = this.instCell[it];
      const ri = this.cellRingIndex(cellId);
      if (!ri) continue;
      const cell = m.cells[cellId];
      const xf = placement(p, cellId, this.instK[it]);
      const inv = invert(xf);
      const ax = applyX(inv, x0, y0);
      const ay = applyY(inv, x0, y0);
      const bx = applyX(inv, x1, y1);
      const by = applyY(inv, x1, y1);
      const dx = bx - ax;
      const dy = by - ay;
      for (const r of ri.search(Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by))) {
        const key = cell.ringKey[r];
        if (!keys.has(key)) continue;
        const xy = ringCoords(cell, r);
        const ts: number[] = [0, 1];
        const n = xy.length;
        for (let i = 0; i < n; i += 2) {
          const j = (i + 2) % n;
          const ex = xy[j] - xy[i];
          const ey = xy[j + 1] - xy[i + 1];
          const den = dx * ey - dy * ex;
          if (Math.abs(den) < 1e-18) continue;
          const t = ((xy[i] - ax) * ey - (xy[i + 1] - ay) * ex) / den;
          const u = ((xy[i] - ax) * dy - (xy[i + 1] - ay) * dx) / den;
          if (t > 0 && t < 1 && u >= 0 && u <= 1) ts.push(t);
        }
        ts.sort((a, b) => a - b);
        let list = spans.get(key);
        if (!list) spans.set(key, (list = []));
        for (let i = 0; i + 1 < ts.length; i++) {
          const a = ts[i];
          const b = ts[i + 1];
          if (b - a < 1e-12) continue;
          const mid = (a + b) / 2;
          if (pointInRing(xy, ax + dx * mid, ay + dy * mid)) list.push(a * len, b * len);
        }
      }
    }
    const out: SectionLayer[] = [];
    for (const [key, list] of spans) {
      const pairs: [number, number][] = [];
      for (let i = 0; i < list.length; i += 2) pairs.push([list[i], list[i + 1]]);
      pairs.sort((a, b) => a[0] - b[0]);
      const merged: number[] = [];
      for (const [a, b] of pairs) {
        const last = merged.length - 1;
        if (last > 0 && a <= merged[last] + 1e-9) merged[last] = Math.max(merged[last], b);
        else merged.push(a, b);
      }
      if (merged.length) out.push({ key, spans: merged });
    }
    return out;
  }


  labels(box: BBox, max: number, keys: Set<number>, ppu: number): Label[] {
    this.ensureInstIndex();
    const m = this.model;
    const p = this.pl;
    const out: Label[] = [];
    const cands = this.instIndex!.search(box[0], box[1], box[2], box[3]);
    // Higher levels of the hierarchy first: their labels are usually the interesting ones.
    cands.sort((a, b) => p.count[this.instCell[a]] - p.count[this.instCell[b]]);
    for (const it of cands) {
      const cell = m.cells[this.instCell[it]];
      if (!cell.texts.length) continue;
      const xf = placement(p, cell.id, this.instK[it]);
      if (cell.id !== p.top) {
        const fb = cell.fullBox;
        const size = Math.max(fb[2] - fb[0], fb[3] - fb[1]) * Math.hypot(xf.a, xf.b) * ppu;
        if (size < MIN_CELL_PX) continue;
      }
      for (const t of cell.texts) {
        if (!keys.has(t.key) && t.key !== GALLERY_KEY) continue;
        const x = applyX(xf, t.x, t.y);
        const y = applyY(xf, t.x, t.y);
        if (x < box[0] || x > box[2] || y < box[1] || y > box[3]) continue;
        out.push({ x, y, text: t.text, key: t.key });
        if (out.length >= max) return out;
      }
    }
    return out;
  }

  searchLabels(q: string): Label[] {
    const m = this.model;
    const p = this.pl;
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    const out: Label[] = [];
    const cells = m.cells.filter((c) => p.count[c.id] && c.texts.length).sort((a, b) => p.count[a.id] - p.count[b.id]);
    for (const c of cells) {
      const xf = placement(p, c.id, 0);
      for (const t of c.texts) {
        if (!t.text.toLowerCase().includes(needle)) continue;
        out.push({
          x: applyX(xf, t.x, t.y),
          y: applyY(xf, t.x, t.y),
          text: t.text,
          key: t.key,
          cell: c.name,
          count: p.count[c.id],
        });
        if (out.length >= 300) return out;
      }
    }
    return out;
  }

  shapesIn(box: BBox, keys: Set<number>, hidden: Set<number>, maxPoints: number) {
    this.ensureInstIndex();
    const m = this.model;
    const p = this.pl;
    const byKey = new Map<number, Float64Array[]>();
    let points = 0;
    let truncated = false;
    const cands = this.instIndex!.search(box[0], box[1], box[2], box[3]);
    cands.sort((a, b) => p.count[this.instCell[a]] - p.count[this.instCell[b]]);
    outer: for (const it of cands) {
      const cellId = this.instCell[it];
      if (hidden.has(cellId)) continue;
      const ri = this.cellRingIndex(cellId);
      if (!ri) continue;
      const cell = m.cells[cellId];
      const xf = placement(p, cellId, this.instK[it]);
      const lb = transformBox(invert(xf), box);
      for (const r of ri.search(lb[0], lb[1], lb[2], lb[3])) {
        const key = cell.ringKey[r];
        if (!keys.has(key)) continue;
        const ring = worldRing(xf, ringCoords(cell, r));
        points += ring.length / 2;
        if (points > maxPoints) {
          truncated = true;
          break outer;
        }
        let list = byKey.get(key);
        if (!list) byKey.set(key, (list = []));
        list.push(ring);
      }
    }
    return { layers: [...byKey].map(([key, rings]) => ({ key, rings })), truncated };
  }
}
