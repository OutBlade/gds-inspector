import { compose, IDENTITY, pathToRing, refTransform, ringArea, ringBox, transformBox, emptyBox, boxValid } from "../gds/geometry";
import type { Affine, BBox } from "../gds/geometry";
import type { GdsLibrary } from "../gds/types";
import { layerKey } from "../gds/types";

export const KIND_BOUNDARY = 0;
export const KIND_PATH = 1;
export const KIND_BOX = 2;

class GrowF64 {
  data = new Float64Array(64);
  length = 0;
  push2(x: number, y: number) {
    if (this.length + 2 > this.data.length) this.grow(this.length + 2);
    this.data[this.length++] = x;
    this.data[this.length++] = y;
  }
  grow(min: number) {
    let cap = this.data.length * 2;
    while (cap < min) cap *= 2;
    const next = new Float64Array(cap);
    next.set(this.data.subarray(0, this.length));
    this.data = next;
  }
  pack() {
    return this.data.slice(0, this.length);
  }
}

export interface CellRef {
  child: number;
  /** Transform of the first lattice element, in µm. */
  t: Affine;
  cols: number;
  rows: number;
  colX: number;
  colY: number;
  rowX: number;
  rowY: number;
}

export interface CellText {
  key: number;
  x: number;
  y: number;
  text: string;
}

/** A cell with all shapes converted to closed rings in µm. */
export interface ModelCell {
  id: number;
  name: string;
  /** Concatenated ring coordinates; ring i spans ringStart[i] .. ringStart[i + 1]. */
  coords: Float64Array;
  ringStart: Uint32Array;
  ringKey: Float64Array;
  ringKind: Uint8Array;
  refs: CellRef[];
  texts: CellText[];
  /** Bounding box of the cell's own shapes, µm, local coordinates. */
  ownBox: BBox;
  /** Bounding box including all subcells. */
  fullBox: BBox;
  boundaryCount: number;
  pathCount: number;
  boxCount: number;
  refCount: number;
  parents: number;
  /** Built by the viewer (the cell gallery), not part of the file. */
  synthetic?: boolean;
}

export interface Model {
  name: string;
  /** µm per database unit. */
  dbToUm: number;
  userUnitMeters: number;
  precisionMeters: number;
  cells: ModelCell[];
  byName: Map<string, number>;
  /** Cells never referenced by another cell, in library order. */
  tops: number[];
  /** Parents-before-children order over all cells. */
  order: number[];
  missingRefs: string[];
  layerKeys: number[];
}

export function buildModel(lib: GdsLibrary): Model {
  const dbToUm = lib.metersPerDb / 1e-6;
  const byName = new Map<string, number>();
  lib.cells.forEach((c, i) => {
    if (!byName.has(c.name)) byName.set(c.name, i);
  });
  const missing = new Set<string>();
  const keys = new Set<number>();

  const cells: ModelCell[] = lib.cells.map((c, id) => {
    const coords = new GrowF64();
    const starts: number[] = [0];
    const ringKey: number[] = [];
    const ringKind: number[] = [];
    let boxCount = 0;
    for (const b of c.boundaries) {
      const xy = b.xy;
      for (let i = 0; i < xy.length; i += 2) coords.push2(xy[i] * dbToUm, xy[i + 1] * dbToUm);
      starts.push(coords.length);
      const k = layerKey(b.layer, b.datatype);
      ringKey.push(k);
      keys.add(k);
      ringKind.push(b.box ? KIND_BOX : KIND_BOUNDARY);
      if (b.box) boxCount++;
    }
    for (const p of c.paths) {
      const ring = pathToRing(p);
      if (!ring) continue;
      for (let i = 0; i < ring.length; i += 2) coords.push2(ring[i] * dbToUm, ring[i + 1] * dbToUm);
      starts.push(coords.length);
      const k = layerKey(p.layer, p.datatype);
      ringKey.push(k);
      keys.add(k);
      ringKind.push(KIND_PATH);
    }
    const refs: CellRef[] = [];
    for (const r of c.refs) {
      const child = byName.get(r.name);
      if (child === undefined) {
        missing.add(r.name);
        continue;
      }
      refs.push({
        child,
        t: refTransform(r, dbToUm),
        cols: r.cols,
        rows: r.rows,
        colX: r.colX * dbToUm,
        colY: r.colY * dbToUm,
        rowX: r.rowX * dbToUm,
        rowY: r.rowY * dbToUm,
      });
    }
    const packed = coords.pack();
    return {
      id,
      name: c.name,
      coords: packed,
      ringStart: Uint32Array.from(starts),
      ringKey: Float64Array.from(ringKey),
      ringKind: Uint8Array.from(ringKind),
      refs,
      texts: c.texts.map((t) => ({ key: layerKey(t.layer, t.texttype), x: t.x * dbToUm, y: t.y * dbToUm, text: t.text })),
      ownBox: ringBox(packed),
      fullBox: emptyBox(),
      boundaryCount: c.boundaries.length - boxCount,
      pathCount: c.paths.length,
      boxCount,
      refCount: c.refs.length,
      parents: 0,
    };
  });

  for (const c of cells) for (const r of c.refs) cells[r.child].parents++;
  const tops = cells.filter((c) => c.parents === 0).map((c) => c.id);
  const order = topoOrder(cells);

  // Full boxes, children first.
  for (let i = order.length - 1; i >= 0; i--) {
    const c = cells[order[i]];
    const box: BBox = [...c.ownBox] as BBox;
    for (const r of c.refs) {
      const cb = cells[r.child].fullBox;
      if (!boxValid(cb)) continue;
      for (const [ci, ri] of latticeCorners(r)) {
        const t = latticeTransform(r, ci, ri);
        transformBox(t, cb, box);
      }
    }
    c.fullBox = box;
  }

  return {
    name: lib.name,
    dbToUm,
    userUnitMeters: lib.metersPerDb / lib.userUnitsPerDb,
    precisionMeters: lib.metersPerDb,
    cells,
    byName,
    tops,
    order,
    missingRefs: [...missing],
    layerKeys: [...keys].sort((a, b) => a - b),
  };
}

function latticeCorners(r: CellRef): [number, number][] {
  const out: [number, number][] = [[0, 0]];
  if (r.cols > 1) out.push([r.cols - 1, 0]);
  if (r.rows > 1) out.push([0, r.rows - 1]);
  if (r.cols > 1 && r.rows > 1) out.push([r.cols - 1, r.rows - 1]);
  return out;
}

export function latticeTransform(r: CellRef, i: number, j: number): Affine {
  if (i === 0 && j === 0) return r.t;
  return { ...r.t, tx: r.t.tx + i * r.colX + j * r.rowX, ty: r.t.ty + i * r.colY + j * r.rowY };
}

/** Parents before children. Cycles are broken at the back edge. */
function topoOrder(cells: ModelCell[]): number[] {
  const state = new Uint8Array(cells.length);
  const post: number[] = [];
  for (const root of cells) {
    if (state[root.id]) continue;
    const stack: [number, number][] = [[root.id, 0]];
    state[root.id] = 1;
    while (stack.length) {
      const top = stack[stack.length - 1];
      const c = cells[top[0]];
      if (top[1] < c.refs.length) {
        const child = c.refs[top[1]++].child;
        if (state[child] === 0) {
          state[child] = 1;
          stack.push([child, 0]);
        }
      } else {
        state[top[0]] = 2;
        post.push(top[0]);
        stack.pop();
      }
    }
  }
  return post.reverse();
}

/** Number of placements of every cell below (and including) `top`. */
export function instanceCounts(model: Model, top: number): Float64Array {
  const counts = new Float64Array(model.cells.length);
  counts[top] = 1;
  for (const id of model.order) {
    const n = counts[id];
    if (!n) continue;
    for (const r of model.cells[id].refs) counts[r.child] += n * r.cols * r.rows;
  }
  return counts;
}

/** Flattened placements, 6 doubles per instance (a b c d tx ty), plus the parent placement. */
export interface Placements {
  top: number;
  xf: (Float64Array | null)[];
  parentCell: (Int32Array | null)[];
  parentIndex: (Int32Array | null)[];
  count: Float64Array;
  total: number;
}

export class TooManyInstancesError extends Error {
  constructor(public total: number) {
    super(`This cell expands to ${total.toLocaleString("en-US")} placements, more than the browser can hold.`);
  }
}

export const MAX_PLACEMENTS = 6_000_000;

export function flatten(model: Model, top: number): Placements {
  const count = instanceCounts(model, top);
  let total = 0;
  for (let i = 0; i < count.length; i++) total += count[i];
  if (total > MAX_PLACEMENTS) throw new TooManyInstancesError(total);

  const n = model.cells.length;
  const xf: (Float64Array | null)[] = new Array(n).fill(null);
  const parentCell: (Int32Array | null)[] = new Array(n).fill(null);
  const parentIndex: (Int32Array | null)[] = new Array(n).fill(null);
  const fill = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    if (!count[i]) continue;
    xf[i] = new Float64Array(count[i] * 6);
    parentCell[i] = new Int32Array(count[i]);
    parentIndex[i] = new Int32Array(count[i]);
  }
  const put = (id: number, m: Affine, pc: number, pi: number) => {
    const k = fill[id]++;
    const a = xf[id]!;
    const o = k * 6;
    a[o] = m.a;
    a[o + 1] = m.b;
    a[o + 2] = m.c;
    a[o + 3] = m.d;
    a[o + 4] = m.tx;
    a[o + 5] = m.ty;
    parentCell[id]![k] = pc;
    parentIndex[id]![k] = pi;
  };
  put(top, IDENTITY, -1, -1);

  for (const id of model.order) {
    const arr = xf[id];
    if (!arr) continue;
    const cell = model.cells[id];
    if (!cell.refs.length) continue;
    const k = count[id];
    for (let p = 0; p < k; p++) {
      const o = p * 6;
      const m: Affine = { a: arr[o], b: arr[o + 1], c: arr[o + 2], d: arr[o + 3], tx: arr[o + 4], ty: arr[o + 5] };
      for (const r of cell.refs) {
        for (let i = 0; i < r.cols; i++)
          for (let j = 0; j < r.rows; j++) put(r.child, compose(m, latticeTransform(r, i, j)), id, p);
      }
    }
  }
  return { top, xf, parentCell, parentIndex, count, total };
}

export function placement(pl: Placements, cell: number, k: number): Affine {
  const a = pl.xf[cell]!;
  const o = k * 6;
  return { a: a[o], b: a[o + 1], c: a[o + 2], d: a[o + 3], tx: a[o + 4], ty: a[o + 5] };
}

/** Cell names from the top down to the given placement. */
export function placementPath(model: Model, pl: Placements, cell: number, k: number): string[] {
  const path: string[] = [];
  let c = cell;
  let i = k;
  while (c >= 0) {
    path.push(model.cells[c].name);
    const pc = pl.parentCell[c]![i];
    const pi = pl.parentIndex[c]![i];
    c = pc;
    i = pi;
  }
  return path.reverse();
}

/** Layer key of the cell name labels in the gallery. */
export const GALLERY_KEY = 65535 * 65536;

/**
 * Adds a cell that places every top cell of the library side by side in rows,
 * each labelled with its name. Returns its id.
 */
export function addGallery(model: Model): number {
  const existing = model.cells.findIndex((c) => c.synthetic);
  if (existing >= 0) return existing;
  const tops = model.tops
    .map((id) => model.cells[id])
    .filter((c) => boxValid(c.fullBox))
    .sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));
  const heights = tops.map((c) => c.fullBox[3] - c.fullBox[1]).sort((a, b) => a - b);
  const median = heights[Math.floor(heights.length / 2)] || 1;
  const gap = Math.max(median * 0.35, 0.5);
  let area = 0;
  for (const c of tops) area += (c.fullBox[2] - c.fullBox[0] + gap) * (c.fullBox[3] - c.fullBox[1] + gap * 1.6);
  const rowWidth = Math.sqrt(area) * 1.5;

  const refs: CellRef[] = [];
  const texts: CellText[] = [];
  let x = 0;
  let y = 0;
  let rowH = 0;
  for (const c of tops) {
    const b = c.fullBox;
    const w = b[2] - b[0];
    const h = b[3] - b[1];
    if (x > 0 && x + w > rowWidth) {
      x = 0;
      y -= rowH + gap * 1.6;
      rowH = 0;
    }
    refs.push({ child: c.id, t: { a: 1, b: 0, c: 0, d: 1, tx: x - b[0], ty: y - h - b[1] }, cols: 1, rows: 1, colX: 0, colY: 0, rowX: 0, rowY: 0 });
    texts.push({ key: GALLERY_KEY, x, y: y + gap * 0.3, text: c.name });
    x += w + gap;
    rowH = Math.max(rowH, h);
  }
  const id = model.cells.length;
  const fullBox = emptyBox();
  for (const r of refs) {
    const cb = model.cells[r.child].fullBox;
    transformBox(r.t, cb, fullBox);
  }
  for (const t of texts) {
    fullBox[1] = Math.min(fullBox[1], t.y);
    fullBox[3] = Math.max(fullBox[3], t.y + gap * 0.6);
  }
  model.cells.push({
    id,
    name: `All ${tops.length} top cells`,
    coords: new Float64Array(0),
    ringStart: new Uint32Array([0]),
    ringKey: new Float64Array(0),
    ringKind: new Uint8Array(0),
    refs,
    texts,
    ownBox: emptyBox(),
    fullBox,
    boundaryCount: 0,
    pathCount: 0,
    boxCount: 0,
    refCount: refs.length,
    parents: 0,
    synthetic: true,
  });
  model.order = [id, ...model.order];
  return id;
}

export function ringCount(c: ModelCell) {
  return c.ringKey.length;
}

export function ringCoords(c: ModelCell, i: number) {
  return c.coords.subarray(c.ringStart[i], c.ringStart[i + 1]);
}

export function ringAbsArea(c: ModelCell, i: number) {
  return Math.abs(ringArea(ringCoords(c, i)));
}
