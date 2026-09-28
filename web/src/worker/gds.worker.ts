/// <reference lib="webworker" />
import { parseGds, maybeGunzip } from "../gds/parser";
import { applyX, applyY, ringArea, ringBox, ringMinEdge, boxValid } from "../gds/geometry";
import type { BBox } from "../gds/geometry";
import { addGallery, buildModel, flatten, placement, ringCoords } from "./model";
import type { Model, Placements } from "./model";
import { buildScene, extrudePart, triangulateRings } from "./scene";
import { Queries } from "./queries";
import { inspect, reportTop } from "../analysis/inspect";
import type { DrcThresholds } from "../analysis/inspect";
import { GALLERY } from "./protocol";
import type {
  DensityResult,
  Extruded,
  FullReport,
  LayerStats,
  LibrarySummary,
  Request,
  SceneResult,
  WorkerMessage,
} from "./protocol";

declare const self: DedicatedWorkerGlobalScope;

let model: Model | null = null;
let fileName = "";
let fileSize = 0;
let pl: Placements | null = null;
let skeleton: { cell: number; key: number; rings: Uint32Array; center: [number, number] }[][] = [];
let sceneCellIds: number[] = [];

let queries: Queries | null = null;

const post = (m: WorkerMessage, transfer: Transferable[] = []) => self.postMessage(m, transfer);
const progress = (stage: string, fraction: number) => post({ kind: "progress", stage, fraction });

self.onmessage = async (ev: MessageEvent<Request & { id: number }>) => {
  const { id } = ev.data;
  try {
    const transfer: Transferable[] = [];
    const result = await handle(ev.data, transfer);
    post({ kind: "result", id, result }, transfer);
  } catch (e) {
    post({ kind: "error", id, message: e instanceof Error ? e.message : String(e) });
  }
};

async function handle(req: Request, transfer: Transferable[]): Promise<unknown> {
  switch (req.type) {
    case "load":
      return load(req.buffer, req.name);
    case "scene":
      return scene(req.top, transfer);
    case "pick":
      return need(queries).pick(req.x, req.y, req.tol, new Set(req.keys), new Set(req.hiddenCells));
    case "snap":
      return need(queries).snap(req.x, req.y, req.r, new Set(req.keys));
    case "section":
      return need(queries).section(req.x0, req.y0, req.x1, req.y1, new Set(req.keys));
    case "labels":
      return need(queries).labels(req.box, req.max, new Set(req.keys), req.ppu);
    case "searchLabels":
      return need(queries).searchLabels(req.q);
    case "report":
      return report(req.thresholds, transfer);
    case "density":
      return density(new Set(req.keys), req.cells, transfer);
    case "extrude":
      return extrude(transfer);
    case "shapes":
      return need(queries).shapesIn(req.box, new Set(req.keys), new Set(req.hiddenCells), req.maxPoints);
  }
}

function need<T>(v: T | null): T {
  if (!v) throw new Error("No layout loaded");
  return v;
}

async function load(raw: ArrayBuffer, name: string): Promise<LibrarySummary> {
  const t0 = performance.now();
  fileSize = raw.byteLength;
  const buffer = await maybeGunzip(raw);
  progress("Reading records", 0);
  const lib = parseGds(buffer, (f) => progress("Reading records", f));
  progress("Building hierarchy", 1);
  model = buildModel(lib);
  fileName = name;
  pl = null;
  queries = null;

  const shapes = new Map<number, number>();
  for (const c of model.cells) for (const k of c.ringKey) shapes.set(k, (shapes.get(k) ?? 0) + 1);
  for (const c of model.cells) for (const t of c.texts) if (!shapes.has(t.key)) shapes.set(t.key, 0);
  const keys = [...new Set([...model.layerKeys, ...shapes.keys()])].sort((a, b) => a - b);

  // Default view: a cell library opens as a gallery, a design as its largest top cell.
  let defaultTop = reportTop(model);
  let bestArea = -1;
  for (const t of model.tops) {
    const b = model.cells[t].fullBox;
    const a = boxValid(b) ? (b[2] - b[0]) * (b[3] - b[1]) : -1;
    if (a > bestArea) {
      bestArea = a;
      defaultTop = t;
    }
  }

  return {
    fileName: name,
    sizeBytes: fileSize,
    name: model.name,
    userUnitMeters: model.userUnitMeters,
    precisionMeters: model.precisionMeters,
    cells: model.cells.map((c) => {
      const children = new Map<number, number>();
      for (const r of c.refs) children.set(r.child, (children.get(r.child) ?? 0) + r.cols * r.rows);
      return {
        id: c.id,
        name: c.name,
        boundaries: c.boundaryCount,
        paths: c.pathCount,
        boxes: c.boxCount,
        texts: c.texts.length,
        children: [...children],
        parents: c.parents,
        ownBox: c.ownBox,
        fullBox: c.fullBox,
      };
    }),
    tops: model.tops,
    defaultTop: model.tops.length > 4 ? GALLERY : defaultTop,
    layerKeys: keys,
    layerShapes: [...shapes],
    missingRefs: model.missingRefs,
    parseMs: performance.now() - t0,
  };
}

function scene(requested: number, transfer: Transferable[]): SceneResult {
  const m = need(model);
  const gallery = requested === GALLERY;
  const top = gallery ? addGallery(m) : requested;
  const t0 = performance.now();
  progress("Expanding hierarchy", 0);
  pl = flatten(m, top);
  queries = new Queries(m, pl);
  progress("Triangulating", 0.3);
  const s = buildScene(m, pl);
  skeleton = s.cells.map((c) => c.parts.map((p) => ({ cell: c.id, key: p.key, rings: p.rings, center: p.center })));
  sceneCellIds = s.cells.map((c) => c.id);
  for (const c of s.cells) {
    for (const ch of c.chunks) transfer.push(ch.inst.buffer);
    for (const p of c.parts) {
      transfer.push(p.positions.buffer, p.tri.buffer, p.edge.buffer);
      if (p.chunk) transfer.push(p.chunk.inst.buffer);
      p.rings = new Uint32Array(0);
    }
  }
  progress("Uploading", 1);
  const first = new Float64Array(m.cells.length * 6).fill(NaN);
  for (const c of m.cells) {
    const a = pl.xf[c.id];
    if (a) first.set(a.subarray(0, 6), c.id * 6);
  }
  const tc = m.cells[top];
  return {
    scene: s,
    top,
    topName: tc.name,
    topBox: [...tc.fullBox] as BBox,
    gallery,
    counts: pl.count.slice(0, m.cells.length),
    first,
    buildMs: performance.now() - t0,
  };
}

function report(thresholds: DrcThresholds, transfer: Transferable[]): FullReport {
  const m = need(model);
  const r = inspect(m, fileName, fileSize, thresholds);

  const stats = new Map<number, LayerStats>();
  const counts = pl ? pl.count : null;
  for (const c of m.cells) {
    const mult = counts ? counts[c.id] : 0;
    let det = 1;
    if (pl && mult) {
      const a = pl.xf[c.id]!;
      det = 0;
      for (let k = 0; k < mult; k++) det += Math.abs(a[k * 6] * a[k * 6 + 3] - a[k * 6 + 1] * a[k * 6 + 2]);
    }
    for (let i = 0; i < c.ringKey.length; i++) {
      const key = c.ringKey[i];
      let s = stats.get(key);
      if (!s) {
        s = { key, shapes: 0, flatShapes: 0, flatArea: 0, minWidth: Infinity, maxWidth: 0, minEdge: Infinity };
        stats.set(key, s);
      }
      const xy = ringCoords(c, i);
      const b = ringBox(xy);
      const w = Math.min(b[2] - b[0], b[3] - b[1]);
      s.shapes++;
      s.flatShapes += mult;
      s.flatArea += Math.abs(ringArea(xy)) * det;
      if (w < s.minWidth) s.minWidth = w;
      if (w > s.maxWidth) s.maxWidth = w;
      const e = ringMinEdge(xy);
      if (e > 0 && e < s.minEdge) s.minEdge = e;
    }
  }
  const layerStats = [...stats.values()].map((s) => ({
    ...s,
    minWidth: s.minWidth === Infinity ? 0 : s.minWidth,
    minEdge: s.minEdge === Infinity ? 0 : s.minEdge,
  }));

  const markers: number[] = [];
  if (pl) {
    r.drc.violations.forEach((v, vi) => {
      const id = m.byName.get(v.cell);
      if (id === undefined) return;
      const n = Math.min(pl!.count[id], 16);
      for (let k = 0; k < n && markers.length < 60_000; k++) {
        const xf = placement(pl!, id, k);
        const lx = v.location[0] / 1000;
        const ly = v.location[1] / 1000;
        markers.push(applyX(xf, lx, ly), applyY(xf, lx, ly), vi);
      }
    });
  }
  const mk = Float64Array.from(markers);
  transfer.push(mk.buffer);
  return { report: r, layerStats, markers: mk };
}

async function density(keys: Set<number>, cellsAcross: number, transfer: Transferable[]): Promise<DensityResult> {
  const m = need(model);
  const p = need(pl);
  const top = m.cells[p.top];
  const box = top.fullBox;
  const w = box[2] - box[0];
  const h = box[3] - box[1];
  if (!(w > 0 && h > 0)) throw new Error("The top cell has no extent");
  const cols = w >= h ? cellsAcross : Math.max(1, Math.round((cellsAcross * w) / h));
  const rows = w >= h ? Math.max(1, Math.round((cellsAcross * h) / w)) : cellsAcross;
  const ss = Math.max(4, Math.floor(2048 / Math.max(cols, rows)));
  const cw = cols * ss;
  const ch = rows * ss;
  const canvas = new OffscreenCanvas(cw, ch);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#fff";
  const sx = cw / w;
  const sy = ch / h;

  let work = 0;
  for (const c of m.cells) if (p.count[c.id]) work += p.count[c.id];
  let done = 0;
  let next = 0;
  for (const c of m.cells) {
    const cnt = p.count[c.id];
    if (!cnt) continue;
    const path = new Path2D();
    let any = false;
    for (let i = 0; i < c.ringKey.length; i++) {
      if (!keys.has(c.ringKey[i])) continue;
      const xy = ringCoords(c, i);
      path.moveTo(xy[0], xy[1]);
      for (let j = 2; j < xy.length; j += 2) path.lineTo(xy[j], xy[j + 1]);
      path.closePath();
      any = true;
    }
    if (any) {
      const a = p.xf[c.id]!;
      for (let k = 0; k < cnt; k++) {
        const o = k * 6;
        // World to canvas: x' = (x - x0) * sx, y' = (y1 - y) * sy (canvas y points down).
        ctx.setTransform(a[o] * sx, -a[o + 1] * sy, a[o + 2] * sx, -a[o + 3] * sy, (a[o + 4] - box[0]) * sx, (box[3] - a[o + 5]) * sy);
        ctx.fill(path, "nonzero");
      }
    }
    done += cnt;
    if (done >= next) {
      progress("Rasterizing density", done / work);
      next = done + work / 50;
    }
  }
  const img = ctx.getImageData(0, 0, cw, ch).data;
  const values = new Float32Array(cols * rows);
  let total = 0;
  for (let r = 0; r < rows; r++) {
    for (let cIdx = 0; cIdx < cols; cIdx++) {
      let s = 0;
      for (let yy = 0; yy < ss; yy++) {
        let o = ((r * ss + yy) * cw + cIdx * ss) * 4 + 3;
        for (let xx = 0; xx < ss; xx++, o += 4) s += img[o];
      }
      const v = s / (255 * ss * ss);
      // Row 0 of the result is the bottom of the layout.
      values[(rows - 1 - r) * cols + cIdx] = v;
      total += v;
    }
  }
  transfer.push(values.buffer);
  const coverage = total / (cols * rows);
  return { cols, rows, box: [...box] as BBox, values, coverage, unionArea: coverage * w * h };
}

function extrude(transfer: Transferable[]): Extruded[] {
  const m = need(model);
  const out: Extruded[] = [];
  skeleton.forEach((parts, ci) => {
    const cell = m.cells[sceneCellIds[ci]];
    parts.forEach((sk, pi) => {
      const part = triangulateRings(cell, Array.from(sk.rings), sk.center[0], sk.center[1], sk.key);
      const g = extrudePart(cell, part);
      transfer.push(g.data.buffer, g.index.buffer);
      out.push({ cell: ci, part: pi, data: g.data, index: g.index });
    });
  });
  return out;
}

export {};
