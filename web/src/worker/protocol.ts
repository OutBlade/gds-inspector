import type { BBox } from "../gds/geometry";
import type { DrcThresholds, Report } from "../analysis/inspect";
import type { Scene } from "./scene";

export interface CellSummary {
  id: number;
  name: string;
  boundaries: number;
  paths: number;
  boxes: number;
  texts: number;
  /** Child cell id and number of placements (AREF counted fully) of that child. */
  children: [number, number][];
  parents: number;
  ownBox: BBox;
  fullBox: BBox;
}

export interface LibrarySummary {
  fileName: string;
  sizeBytes: number;
  name: string;
  userUnitMeters: number;
  precisionMeters: number;
  cells: CellSummary[];
  tops: number[];
  defaultTop: number;
  layerKeys: number[];
  /** Shapes per layer key, counted once per cell definition. */
  layerShapes: [number, number][];
  missingRefs: string[];
  parseMs: number;
}

/** Pseudo cell id for the gallery of all top cells. */
export const GALLERY = -1;

export interface SceneResult {
  scene: Scene;
  /** Id of the displayed top cell (the gallery gets an id past the file's cells). */
  top: number;
  topName: string;
  topBox: BBox;
  gallery: boolean;
  /** Placements per cell id below the chosen top. */
  counts: Float64Array;
  /** Transform of the first placement of every cell, 6 values per cell, NaN when unplaced. */
  first: Float64Array;
  buildMs: number;
}

export interface PickHit {
  key: number;
  cell: string;
  path: string[];
  area: number;
  box: BBox;
  /** World coordinates of the shape outline. */
  ring: Float64Array;
  kind: "boundary" | "path" | "box";
}

export interface Label {
  x: number;
  y: number;
  text: string;
  key: number;
  cell?: string;
  count?: number;
}

export interface SectionLayer {
  key: number;
  /** Pairs of distances along the cut line, µm. */
  spans: number[];
}

export interface LayerStats {
  key: number;
  shapes: number;
  flatShapes: number;
  flatArea: number;
  minWidth: number;
  maxWidth: number;
  minEdge: number;
}

export interface FullReport {
  report: Report;
  layerStats: LayerStats[];
  /** x, y (world µm) and violation index, flattened. */
  markers: Float64Array;
}

export interface DensityResult {
  cols: number;
  rows: number;
  box: BBox;
  values: Float32Array;
  coverage: number;
  unionArea: number;
}

export interface Extruded {
  cell: number;
  part: number;
  data: Float32Array;
  index: Uint32Array;
}

export type Request =
  | { type: "load"; buffer: ArrayBuffer; name: string }
  | { type: "scene"; top: number }
  | { type: "pick"; x: number; y: number; tol: number; keys: number[]; hiddenCells: number[] }
  | { type: "snap"; x: number; y: number; r: number; keys: number[] }
  | { type: "section"; x0: number; y0: number; x1: number; y1: number; keys: number[] }
  | { type: "labels"; box: BBox; max: number; keys: number[]; ppu: number }
  | { type: "searchLabels"; q: string }
  | { type: "report"; thresholds: DrcThresholds }
  | { type: "density"; keys: number[]; cells: number }
  | { type: "extrude" }
  | { type: "shapes"; box: BBox; keys: number[]; hiddenCells: number[]; maxPoints: number };

export interface ResponseMap {
  load: LibrarySummary;
  scene: SceneResult;
  pick: PickHit[];
  snap: { x: number; y: number; kind: "vertex" | "edge" } | null;
  section: SectionLayer[];
  labels: Label[];
  searchLabels: Label[];
  report: FullReport;
  density: DensityResult;
  extrude: Extruded[];
  shapes: { layers: { key: number; rings: Float64Array[] }[]; truncated: boolean };
}

export type WorkerMessage =
  | { kind: "result"; id: number; result: unknown }
  | { kind: "error"; id: number; message: string }
  | { kind: "progress"; stage: string; fraction: number };
