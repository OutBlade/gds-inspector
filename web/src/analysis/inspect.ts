/**
 * Browser port of gds_inspector/inspector.py and drc.py. Field names and
 * semantics match the Python backend so reports from the desktop app and the
 * web app can be compared one to one.
 */
import { ringArea, ringBox, ringMinEdge, applyX, applyY, compose, IDENTITY } from "../gds/geometry";
import type { Affine } from "../gds/geometry";
import { keyLayer, keyDatatype } from "../gds/types";
import type { Model, ModelCell } from "../worker/model";
import { KIND_PATH, latticeTransform, ringCoords } from "../worker/model";

export const LAYER_COLORS = [
  "#E74C3C",
  "#3498DB",
  "#2ECC71",
  "#F39C12",
  "#9B59B6",
  "#1ABC9C",
  "#E67E22",
  "#95A5A6",
  "#34495E",
  "#F1C40F",
];

export interface DrcThresholds {
  min_width_nm: number;
  min_area_um2: number;
}

export const DEFAULT_THRESHOLDS: DrcThresholds = { min_width_nm: 100, min_area_um2: 0.001 };

export interface DrcViolation {
  rule: "MIN_WIDTH" | "MIN_AREA";
  severity: "error" | "warning";
  layer: number;
  datatype: number;
  cell: string;
  value_nm?: number;
  threshold_nm?: number;
  value_um2?: number;
  threshold_um2?: number;
  /** Center of the offending shape in the cell's coordinates, nm. */
  location: [number, number];
}

export interface DrcResult {
  thresholds: DrcThresholds;
  stats: { total_polygons_checked: number; min_width_violations: number; min_area_violations: number };
  violations: DrcViolation[];
  passed: boolean;
}

export interface LayerReport {
  layer: number;
  datatype: number;
  color: string;
  polygon_count: number;
  total_area_um2: number;
  min_cd_nm: number;
  max_cd_nm: number;
  min_edge_nm: number;
  density_percent: number;
}

export interface CellReport {
  name: string;
  is_top: boolean;
  polygon_count: number;
  path_count: number;
  reference_count: number;
  bounding_box: {
    x_min: number;
    y_min: number;
    x_max: number;
    y_max: number;
    width_nm: number;
    height_nm: number;
  } | null;
}

export interface Report {
  status: "ok";
  file_info: {
    path: string;
    size_bytes: number;
    library_name: string;
    unit_meters: number;
    precision_meters: number;
    unit_label: string;
    cell_count: number;
  };
  top_cell: string;
  cells: CellReport[];
  layers: LayerReport[];
  drc: DrcResult;
  preview: {
    cell: string;
    total_polygon_count: number;
    shown_polygon_count: number;
    bounds: { x_min: number; y_min: number; x_max: number; y_max: number } | null;
    polygons: { layer: number; points: [number, number][] }[];
  };
}

const minBoxDim = (xy: ArrayLike<number>) => {
  const b = ringBox(xy);
  return Math.min(b[2] - b[0], b[3] - b[1]);
};

/** µm to the library's user unit. */
function userScale(model: Model) {
  return 1e-6 / model.userUnitMeters;
}

/** Sum of |det| over all placements of every cell, i.e. the area multiplier. */
export function areaWeights(model: Model, top: number): Float64Array {
  const w = new Float64Array(model.cells.length);
  w[top] = 1;
  for (const id of model.order) {
    const p = w[id];
    if (!p) continue;
    for (const r of model.cells[id].refs) {
      const det = Math.abs(r.t.a * r.t.d - r.t.b * r.t.c);
      w[r.child] += p * r.cols * r.rows * det;
    }
  }
  return w;
}

/** First top cell in library order, as gdstk's Library.top_level()[0]. */
export function reportTop(model: Model): number {
  if (model.tops.length) return model.tops[0];
  return model.cells.length ? 0 : -1;
}

export function runDrc(model: Model, thresholds: DrcThresholds = DEFAULT_THRESHOLDS): DrcResult {
  const us = userScale(model);
  const violations: DrcViolation[] = [];
  const stats = { total_polygons_checked: 0, min_width_violations: 0, min_area_violations: 0 };
  for (const cell of model.cells) {
    for (let i = 0; i < cell.ringKey.length; i++) {
      if (cell.ringKind[i] === KIND_PATH) continue;
      stats.total_polygons_checked++;
      const xy = ringCoords(cell, i);
      const b = ringBox(xy);
      const widthNm = Math.min(b[2] - b[0], b[3] - b[1]) * 1000;
      const key = cell.ringKey[i];
      const loc: [number, number] = [round1(((b[0] + b[2]) / 2) * 1000), round1(((b[1] + b[3]) / 2) * 1000)];
      if (widthNm > 0 && widthNm < thresholds.min_width_nm) {
        stats.min_width_violations++;
        if (stats.min_width_violations <= 200)
          violations.push({
            rule: "MIN_WIDTH",
            severity: "error",
            layer: keyLayer(key),
            datatype: keyDatatype(key),
            cell: cell.name,
            value_nm: round(widthNm, 2),
            threshold_nm: thresholds.min_width_nm,
            location: loc,
          });
      }
      const area = Math.abs(ringArea(xy)) * us * us;
      if (area > 0 && area < thresholds.min_area_um2) {
        stats.min_area_violations++;
        if (stats.min_area_violations <= 100)
          violations.push({
            rule: "MIN_AREA",
            severity: "warning",
            layer: keyLayer(key),
            datatype: keyDatatype(key),
            cell: cell.name,
            value_um2: round(area, 6),
            threshold_um2: thresholds.min_area_um2,
            location: loc,
          });
      }
    }
  }
  return { thresholds, stats, violations, passed: violations.length === 0 };
}

const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;
const round1 = (v: number) => round(v, 1);

export function inspect(model: Model, fileName: string, sizeBytes: number, thresholds = DEFAULT_THRESHOLDS): Report {
  const us = userScale(model);
  const top = reportTop(model);
  const topName = top >= 0 ? model.cells[top].name : "";

  const fileCells = model.cells.filter((c) => !c.synthetic);
  const cells: CellReport[] = fileCells.map((c) => {
    const b = c.fullBox;
    const valid = b[0] <= b[2];
    return {
      name: c.name,
      is_top: c.name === topName,
      polygon_count: c.boundaryCount + c.boxCount,
      path_count: c.pathCount,
      reference_count: c.refCount,
      bounding_box: valid
        ? {
            x_min: b[0] * 1000,
            y_min: b[1] * 1000,
            x_max: b[2] * 1000,
            y_max: b[3] * 1000,
            width_nm: (b[2] - b[0]) * 1000,
            height_nm: (b[3] - b[1]) * 1000,
          }
        : null,
    };
  });

  const layers = new Map<number, LayerReport>();
  for (const cell of model.cells) {
    for (let i = 0; i < cell.ringKey.length; i++) {
      if (cell.ringKind[i] === KIND_PATH) continue;
      const key = cell.ringKey[i];
      const layer = keyLayer(key);
      let l = layers.get(layer);
      if (!l) {
        l = {
          layer,
          datatype: keyDatatype(key),
          color: LAYER_COLORS[layer % LAYER_COLORS.length],
          polygon_count: 0,
          total_area_um2: 0,
          min_cd_nm: Infinity,
          max_cd_nm: 0,
          min_edge_nm: Infinity,
          density_percent: 0,
        };
        layers.set(layer, l);
      }
      const xy = ringCoords(cell, i);
      const dim = minBoxDim(xy) * 1000;
      const edge = ringMinEdge(xy) * 1000;
      l.polygon_count++;
      l.total_area_um2 += Math.abs(ringArea(xy)) * us * us;
      l.min_cd_nm = Math.min(l.min_cd_nm, dim);
      l.max_cd_nm = Math.max(l.max_cd_nm, dim);
      if (edge > 0) l.min_edge_nm = Math.min(l.min_edge_nm, edge);
    }
  }
  for (const l of layers.values()) {
    if (l.min_cd_nm === Infinity) l.min_cd_nm = 0;
    if (l.min_edge_nm === Infinity) l.min_edge_nm = 0;
  }

  if (top >= 0 && model.tops.length) {
    const b = model.cells[top].fullBox;
    const total = (b[2] - b[0]) * (b[3] - b[1]);
    if (total > 0) {
      const flat = flatLayerAreas(model, top);
      for (const [layer, area] of flat) {
        const l = layers.get(layer);
        if (l) l.density_percent = (area / total) * 100;
      }
    }
  }

  return {
    status: "ok",
    file_info: {
      path: fileName,
      size_bytes: sizeBytes,
      library_name: model.name,
      unit_meters: model.userUnitMeters,
      precision_meters: model.precisionMeters,
      unit_label: Math.abs(model.userUnitMeters - 1e-6) < 1e-8 ? "µm" : `${(model.userUnitMeters * 1e9).toFixed(0)}nm`,
      cell_count: fileCells.length,
    },
    top_cell: topName,
    cells,
    layers: [...layers.values()],
    drc: runDrc(model, thresholds),
    preview: preview(model, top),
  };
}

/** Flattened area per layer number in µm², paths included. */
export function flatLayerAreas(model: Model, top: number): Map<number, number> {
  const w = areaWeights(model, top);
  const out = new Map<number, number>();
  for (const cell of model.cells) {
    const k = w[cell.id];
    if (!k) continue;
    for (let i = 0; i < cell.ringKey.length; i++) {
      const layer = keyLayer(cell.ringKey[i]);
      out.set(layer, (out.get(layer) ?? 0) + Math.abs(ringArea(ringCoords(cell, i))) * k);
    }
  }
  return out;
}

const MAX_PREVIEW = 3000;

function preview(model: Model, top: number): Report["preview"] {
  if (top < 0) return { cell: "", total_polygon_count: 0, shown_polygon_count: 0, bounds: null, polygons: [] };
  let total = 0;
  const weights = new Float64Array(model.cells.length);
  weights[top] = 1;
  for (const id of model.order) {
    const p = weights[id];
    if (!p) continue;
    total += p * model.cells[id].ringKey.length;
    for (const r of model.cells[id].refs) weights[r.child] += p * r.cols * r.rows;
  }
  const polygons: Report["preview"]["polygons"] = [];
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const visit = (cell: ModelCell, m: Affine) => {
    for (let i = 0; i < cell.ringKey.length && polygons.length < MAX_PREVIEW; i++) {
      const xy = ringCoords(cell, i);
      const pts: [number, number][] = [];
      for (let j = 0; j < xy.length; j += 2) {
        const x = applyX(m, xy[j], xy[j + 1]) * 1000;
        const y = applyY(m, xy[j], xy[j + 1]) * 1000;
        pts.push([x, y]);
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
      polygons.push({ layer: keyLayer(cell.ringKey[i]), points: pts });
    }
    for (const r of cell.refs) {
      for (let i = 0; i < r.cols; i++)
        for (let j = 0; j < r.rows; j++) {
          if (polygons.length >= MAX_PREVIEW) return;
          visit(model.cells[r.child], compose(m, latticeTransform(r, i, j)));
        }
    }
  };
  visit(model.cells[top], IDENTITY);
  return {
    cell: model.cells[top].name,
    total_polygon_count: total,
    shown_polygon_count: polygons.length,
    bounds: polygons.length ? { x_min: x0, y_min: y0, x_max: x1, y_max: y1 } : null,
    polygons,
  };
}
