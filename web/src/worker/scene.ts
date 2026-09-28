import earcut from "earcut";
import { emptyBox, ringBox, transformBox, unionBox, isRectangle, ringArea } from "../gds/geometry";
import type { BBox } from "../gds/geometry";
import type { Model, ModelCell, Placements } from "./model";
import { ringCoords } from "./model";

/** Geometry of one layer of one cell (or one spatial tile of it). Coordinates are relative to `center`. */
export interface ScenePart {
  key: number;
  center: [number, number];
  box: BBox;
  positions: Float32Array;
  tri: Uint32Array;
  edge: Uint32Array;
  /** Ring index ranges into the cell, used to build 3D geometry on demand. */
  rings: Uint32Array;
  /** Own placement buffer when the part is a tile of a single-placement cell. */
  chunk?: SceneChunk;
}

/** A block of placements of one cell, packed for GPU instancing. */
export interface SceneChunk {
  /** Per instance: a b c d, translation hi xy, translation lo xy. */
  inst: Float32Array;
  count: number;
  /** World box of all placements in this chunk. */
  box: BBox;
}

export interface SceneCell {
  id: number;
  name: string;
  count: number;
  center: [number, number];
  ownBox: BBox;
  maxScale: number;
  /** Layer keys of this cell, largest area first. */
  keysByArea: number[];
  parts: ScenePart[];
  chunks: SceneChunk[];
}

export interface Scene {
  top: number;
  box: BBox;
  cells: SceneCell[];
  triangles: number;
  placements: number;
}

const CHUNK_TARGET = 4096;
const TILE_TARGET = 16000;

export function splitDouble(v: number): [number, number] {
  const hi = Math.fround(v);
  return [hi, v - hi];
}

function packInstances(xf: Float64Array, idx: ArrayLike<number>, cx: number, cy: number, cellBox: BBox): SceneChunk {
  const n = idx.length;
  const inst = new Float32Array(n * 8);
  const box = emptyBox();
  for (let k = 0; k < n; k++) {
    const o = idx[k] * 6;
    const a = xf[o];
    const b = xf[o + 1];
    const c = xf[o + 2];
    const d = xf[o + 3];
    const tx = xf[o + 4] + a * cx + c * cy;
    const ty = xf[o + 5] + b * cx + d * cy;
    const [hx, lx] = splitDouble(tx);
    const [hy, ly] = splitDouble(ty);
    const w = k * 8;
    inst[w] = a;
    inst[w + 1] = b;
    inst[w + 2] = c;
    inst[w + 3] = d;
    inst[w + 4] = hx;
    inst[w + 5] = hy;
    inst[w + 6] = lx;
    inst[w + 7] = ly;
    // cellBox is relative to the center, so it goes with the center-adjusted translation.
    transformBox({ a, b, c, d, tx, ty }, cellBox, box);
  }
  return { inst, count: n, box };
}

/** Groups placements into spatially coherent chunks so off-screen blocks can be skipped. */
function chunkPlacements(xf: Float64Array, count: number, cx: number, cy: number, box: BBox): SceneChunk[] {
  if (count <= CHUNK_TARGET) {
    const idx = new Uint32Array(count);
    for (let i = 0; i < count; i++) idx[i] = i;
    return [packInstances(xf, idx, cx, cy, box)];
  }
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < count; i++) {
    const x = xf[i * 6 + 4];
    const y = xf[i * 6 + 5];
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  const g = Math.ceil(Math.sqrt(count / CHUNK_TARGET));
  const sx = (x1 - x0) / g || 1;
  const sy = (y1 - y0) / g || 1;
  const bucket = new Uint32Array(count);
  const sizes = new Uint32Array(g * g);
  for (let i = 0; i < count; i++) {
    const bx = Math.min(g - 1, Math.floor((xf[i * 6 + 4] - x0) / sx));
    const by = Math.min(g - 1, Math.floor((xf[i * 6 + 5] - y0) / sy));
    bucket[i] = by * g + bx;
    sizes[bucket[i]]++;
  }
  const starts = new Uint32Array(g * g + 1);
  for (let b = 0; b < g * g; b++) starts[b + 1] = starts[b] + sizes[b];
  const order = new Uint32Array(count);
  const cursor = starts.slice(0, g * g);
  for (let i = 0; i < count; i++) order[cursor[bucket[i]]++] = i;
  const out: SceneChunk[] = [];
  for (let b = 0; b < g * g; b++) {
    if (starts[b + 1] > starts[b]) out.push(packInstances(xf, order.subarray(starts[b], starts[b + 1]), cx, cy, box));
  }
  return out;
}

/** Triangulates a list of rings (all on one layer) relative to a center point. */
export function triangulateRings(cell: ModelCell, rings: number[], cx: number, cy: number, key: number): ScenePart {
  let vcount = 0;
  for (const r of rings) vcount += (cell.ringStart[r + 1] - cell.ringStart[r]) / 2;
  const positions = new Float32Array(vcount * 2);
  const edge = new Uint32Array(vcount * 2);
  const tri: number[] = [];
  const box = emptyBox();
  let v = 0;
  for (const r of rings) {
    const xy = ringCoords(cell, r);
    const n = xy.length / 2;
    ringBox(xy, box);
    for (let i = 0; i < n; i++) {
      positions[(v + i) * 2] = xy[i * 2] - cx;
      positions[(v + i) * 2 + 1] = xy[i * 2 + 1] - cy;
      edge[(v + i) * 2] = v + i;
      edge[(v + i) * 2 + 1] = v + ((i + 1) % n);
    }
    if (isRectangle(xy)) {
      tri.push(v, v + 1, v + 2, v, v + 2, v + 3);
    } else if (n === 3) {
      tri.push(v, v + 1, v + 2);
    } else {
      const local = new Float64Array(xy.length);
      for (let i = 0; i < xy.length; i += 2) {
        local[i] = xy[i] - xy[0];
        local[i + 1] = xy[i + 1] - xy[1];
      }
      const t = earcut(local);
      for (let i = 0; i < t.length; i++) tri.push(v + t[i]);
    }
    v += n;
  }
  return {
    key,
    center: [cx, cy],
    box,
    positions,
    tri: Uint32Array.from(tri),
    edge,
    rings: Uint32Array.from(rings),
  };
}

function groupByLayer(cell: ModelCell): Map<number, number[]> {
  const m = new Map<number, number[]>();
  for (let i = 0; i < cell.ringKey.length; i++) {
    const k = cell.ringKey[i];
    let arr = m.get(k);
    if (!arr) m.set(k, (arr = []));
    arr.push(i);
  }
  return m;
}

function tileRings(cell: ModelCell, rings: number[]): number[][] {
  if (rings.length <= TILE_TARGET) return [rings];
  const box = cell.ownBox;
  const g = Math.ceil(Math.sqrt(rings.length / TILE_TARGET));
  const sx = (box[2] - box[0]) / g || 1;
  const sy = (box[3] - box[1]) / g || 1;
  const tiles: number[][] = Array.from({ length: g * g }, () => []);
  for (const r of rings) {
    const s = cell.ringStart[r];
    const bx = Math.min(g - 1, Math.max(0, Math.floor((cell.coords[s] - box[0]) / sx)));
    const by = Math.min(g - 1, Math.max(0, Math.floor((cell.coords[s + 1] - box[1]) / sy)));
    tiles[by * g + bx].push(r);
  }
  return tiles.filter((t) => t.length);
}

export function buildScene(model: Model, pl: Placements): Scene {
  const cells: SceneCell[] = [];
  let triangles = 0;
  const world = emptyBox();
  for (const cell of model.cells) {
    const count = pl.count[cell.id];
    const xf = pl.xf[cell.id];
    if (!count || !xf || !cell.ringKey.length) continue;
    const own = cell.ownBox;
    const cx = (own[0] + own[2]) / 2;
    const cy = (own[1] + own[3]) / 2;
    const localBox: BBox = [own[0] - cx, own[1] - cy, own[2] - cx, own[3] - cy];
    const chunks = chunkPlacements(xf, count, cx, cy, localBox);
    for (const ch of chunks) unionBox(world, ch.box);

    let maxScale = 0;
    for (let i = 0; i < count; i++) {
      const s = Math.hypot(xf[i * 6], xf[i * 6 + 1]);
      if (s > maxScale) maxScale = s;
    }

    const parts: ScenePart[] = [];
    const byLayer = groupByLayer(cell);
    const areaOf = new Map<number, number>();
    for (const [key, rings] of byLayer) {
      let a = 0;
      for (const r of rings) a += Math.abs(ringArea(ringCoords(cell, r)));
      areaOf.set(key, a);
    }
    const keysByArea = [...byLayer.keys()].sort((x, y) => areaOf.get(y)! - areaOf.get(x)!);
    for (const [key, rings] of byLayer) {
      const tiles = count === 1 ? tileRings(cell, rings) : [rings];
      if (tiles.length === 1) {
        const p = triangulateRings(cell, rings, cx, cy, key);
        triangles += (p.tri.length / 3) * count;
        parts.push(p);
        continue;
      }
      for (const t of tiles) {
        const b = emptyBox();
        for (const r of t) ringBox(ringCoords(cell, r), b);
        const px = (b[0] + b[2]) / 2;
        const py = (b[1] + b[3]) / 2;
        const p = triangulateRings(cell, t, px, py, key);
        p.chunk = packInstances(xf, [0], px, py, [b[0] - px, b[1] - py, b[2] - px, b[3] - py]);
        triangles += p.tri.length / 3;
        parts.push(p);
      }
    }
    cells.push({ id: cell.id, name: cell.name, count, center: [cx, cy], ownBox: localBox, maxScale, keysByArea, parts, chunks });
  }
  return { top: pl.top, box: world, cells, triangles, placements: pl.total };
}

/**
 * Extruded solid for 3D view: top cap at z = 1 and side walls from z = 0 to 1,
 * interleaved as x y z nx ny nz, relative to the part center.
 */
export function extrudePart(cell: ModelCell, part: ScenePart): { data: Float32Array; index: Uint32Array } {
  let verts = 0;
  let idx = 0;
  for (const r of part.rings) {
    const n = (cell.ringStart[r + 1] - cell.ringStart[r]) / 2;
    verts += n + n * 4;
    idx += n * 6;
  }
  idx += part.tri.length;
  const data = new Float32Array(verts * 6);
  const index = new Uint32Array(idx);
  const [cx, cy] = part.center;

  // Top cap reuses the 2D triangulation, vertex order matches part.positions.
  const capVerts = part.positions.length / 2;
  for (let i = 0; i < capVerts; i++) {
    const o = i * 6;
    data[o] = part.positions[i * 2];
    data[o + 1] = part.positions[i * 2 + 1];
    data[o + 2] = 1;
    data[o + 5] = 1;
  }
  let ii = 0;
  for (let i = 0; i < part.tri.length; i += 3) {
    // Earcut output winding is not guaranteed; the shader lights both faces.
    index[ii++] = part.tri[i];
    index[ii++] = part.tri[i + 1];
    index[ii++] = part.tri[i + 2];
  }
  let v = capVerts;
  for (const r of part.rings) {
    const xy = ringCoords(cell, r);
    const n = xy.length / 2;
    const orient = ringArea(xy) >= 0 ? 1 : -1;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const x0 = xy[i * 2] - cx;
      const y0 = xy[i * 2 + 1] - cy;
      const x1 = xy[j * 2] - cx;
      const y1 = xy[j * 2 + 1] - cy;
      const dx = x1 - x0;
      const dy = y1 - y0;
      const l = Math.hypot(dx, dy) || 1;
      const nx = (dy / l) * orient;
      const ny = (-dx / l) * orient;
      const quad = [x0, y0, 0, x1, y1, 0, x1, y1, 1, x0, y0, 1];
      for (let q = 0; q < 4; q++) {
        const o = (v + q) * 6;
        data[o] = quad[q * 3];
        data[o + 1] = quad[q * 3 + 1];
        data[o + 2] = quad[q * 3 + 2];
        data[o + 3] = nx;
        data[o + 4] = ny;
        data[o + 5] = 0;
      }
      index[ii++] = v;
      index[ii++] = v + 1;
      index[ii++] = v + 2;
      index[ii++] = v;
      index[ii++] = v + 2;
      index[ii++] = v + 3;
      v += 4;
    }
  }
  return { data, index };
}
