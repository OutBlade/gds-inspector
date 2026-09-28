import { signal, computed } from "@preact/signals";
import type { LayerDef } from "./pdk/pdk";
import type { DensityResult, FullReport, Label, LibrarySummary, PickHit, SectionLayer } from "./worker/protocol";
import type { Settings3D } from "./render/renderer";
import { DEFAULT_THRESHOLDS } from "./analysis/inspect";
import type { DrcThresholds } from "./analysis/inspect";

export interface LayerView extends LayerDef {
  shapes: number;
}

export interface SceneInfo {
  top: number;
  topName: string;
  topBox: [number, number, number, number];
  gallery: boolean;
  triangles: number;
  placements: number;
  buildMs: number;
  counts: Float64Array;
  first: Float64Array;
}

export type Tool = "select" | "ruler" | "section";
export type Theme = "dark" | "light";

export const summary = signal<LibrarySummary | null>(null);
export const sceneInfo = signal<SceneInfo | null>(null);
export const layers = signal<LayerView[]>([]);
export const pdkId = signal("generic");
export const mode = signal<"2d" | "3d">("2d");
export const tool = signal<Tool>("select");
export const busy = signal<{ stage: string; fraction: number } | null>(null);
export const error = signal<string | null>(null);
export const notice = signal<string | null>(null);

export const selection = signal<PickHit[]>([]);
export const selIndex = signal(0);
export const hover = signal<PickHit | null>(null);
export const cursor = signal<[number, number] | null>(null);
export const snapPoint = signal<{ x: number; y: number; kind: string } | null>(null);

export const ruler = signal<{ a: [number, number]; b: [number, number]; done: boolean } | null>(null);
export const sectionLine = signal<{ a: [number, number]; b: [number, number]; done: boolean } | null>(null);
export const sectionResult = signal<SectionLayer[] | null>(null);

export const report = signal<FullReport | null>(null);
export const reportBusy = signal(false);
export const thresholds = signal<DrcThresholds>({ ...DEFAULT_THRESHOLDS });
export const drcFocus = signal<number | null>(null);
export const showMarkers = signal(true);

export const density = signal<(DensityResult & { label: string }) | null>(null);
export const showDensity = signal(true);

export const labels = signal<Label[]>([]);
export const highlightCell = signal<number | null>(null);

export const hideFillers = signal(false);
export const hideTop = signal(false);
export const showLabels = signal(true);
export const showGrid = signal(false);
export const theme = signal<Theme>("dark");
export const s3d = signal<Settings3D>({ exaggeration: 1, explode: 0, clip: false, clipAt: 0.5, clipAxis: "y" });

export const leftTab = signal<"layers" | "cells" | "search">("layers");
export const rightTab = signal<"info" | "layers" | "density" | "drc" | "shape">("info");
export const leftOpen = signal(true);
export const rightOpen = signal(true);
export const helpOpen = signal(false);

export const zoomInfo = signal({ pxPerUm: 1, drawn: 0, instances: 0 });

export const selected = computed(() => selection.value[selIndex.value] ?? null);
export const loaded = computed(() => summary.value !== null && sceneInfo.value !== null);
export const layerByKey = computed(() => new Map(layers.value.map((l) => [l.key, l])));
