import { effect, batch } from "@preact/signals";
import { LayoutClient, latest } from "./client";
import { LayoutRenderer } from "./render/renderer";
import type { LayerStyle } from "./render/renderer";
import { drawOverlay } from "./render/overlay";
import { ALL_PDKS, GENERIC, detectPdk, resolveLayers } from "./pdk/pdk";
import { transformBox } from "./gds/geometry";
import type { BBox } from "./gds/geometry";
import * as S from "./state";
import type { LayerView } from "./state";
import type { PickHit } from "./worker/protocol";

export class Controller {
  readonly client = new LayoutClient();
  renderer!: LayoutRenderer;
  private overlay!: HTMLCanvasElement;
  private overlayCtx!: CanvasRenderingContext2D;
  private host!: HTMLElement;
  private idleTimer = 0;
  private cellHidden = new Set<number>();
  private pendingHash: { cx: number; cy: number; scale: number } | null = null;
  private loading3D: Promise<void> | null = null;

  constructor() {
    this.client.onProgress = (stage, fraction) => {
      if (S.busy.value) S.busy.value = { stage, fraction };
    };
  }

  mount(host: HTMLElement) {
    this.host = host;
    this.renderer = new LayoutRenderer(host);
    this.overlay = document.createElement("canvas");
    this.overlay.className = "overlay";
    host.appendChild(this.overlay);
    this.overlayCtx = this.overlay.getContext("2d")!;
    this.renderer.onFrame = () => this.paintOverlay();
    new ResizeObserver(() => {
      this.renderer.resize();
      this.sizeOverlay();
    }).observe(host);
    this.sizeOverlay();

    effect(() => this.renderer.setTheme(S.theme.value === "dark"));
    effect(() => {
      this.renderer.set3DSettings(S.s3d.value);
    });
    effect(() => {
      // Any overlay-relevant state change repaints without re-rendering WebGL.
      void [
        S.selection.value,
        S.selIndex.value,
        S.hover.value,
        S.ruler.value,
        S.sectionLine.value,
        S.labels.value,
        S.showLabels.value,
        S.showGrid.value,
        S.density.value,
        S.showDensity.value,
        S.report.value,
        S.showMarkers.value,
        S.drcFocus.value,
        S.rightTab.value,
        S.rightOpen.value,
        S.highlightCell.value,
        S.snapPoint.value,
        S.theme.value,
      ];
      this.paintOverlay();
    });
    effect(() => {
      void [S.hideFillers.value, S.hideTop.value, S.summary.value];
      this.applyHidden();
    });
    effect(() => {
      void S.showLabels.value;
      this.scheduleIdle();
    });
    this.readHash();
  }

  private sizeOverlay() {
    const { width, height } = this.renderer.size;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.overlay.width = Math.round(width * dpr);
    this.overlay.height = Math.round(height * dpr);
    this.overlay.style.width = `${width}px`;
    this.overlay.style.height = `${height}px`;
    this.paintOverlay();
  }

  paintOverlay() {
    if (!this.overlayCtx) return;
    drawOverlay(this.overlayCtx, this.renderer, Math.min(window.devicePixelRatio || 1, 2));
    const r = this.renderer;
    S.zoomInfo.value = { pxPerUm: r.pxPerUm(), drawn: r.stats.drawn, instances: r.stats.instances };
  }

  /** Called after every camera change. */
  cameraMoved() {
    this.renderer.request();
    this.scheduleIdle();
  }

  private scheduleIdle() {
    clearTimeout(this.idleTimer);
    this.idleTimer = window.setTimeout(() => this.onIdle(), 140);
  }

  private async onIdle() {
    if (!S.loaded.value) return;
    this.writeHash();
    if (!S.showLabels.value || this.renderer.mode === "3d") {
      S.labels.value = [];
      return;
    }
    // Querying labels over a whole full-chip view is wasted work; wait until zoomed in.
    if (this.renderer.stats.instances > 250_000) {
      S.labels.value = [];
      return;
    }
    const keys = S.layers.value.filter((l) => l.visible).map((l) => l.key);
    const res = await this.labelsLatest(this.renderer.viewBox(), keys);
    if (res) S.labels.value = res;
  }

  private labelsLatest = latest((box: BBox, keys: number[]) =>
    this.client.call({ type: "labels", box, max: 1500, keys, ppu: this.renderer.pxPerUm() }),
  );

  // Loading ---------------------------------------------------------------

  async openFile(file: File) {
    const buf = await file.arrayBuffer();
    await this.loadBuffer(buf, file.name.replace(/\.gz$/i, ""));
  }

  async openUrl(url: string) {
    S.error.value = null;
    S.busy.value = { stage: "Downloading", fraction: 0 };
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
      const total = Number(res.headers.get("content-length")) || 0;
      const reader = res.body!.getReader();
      const parts: Uint8Array[] = [];
      let got = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value);
        got += value.length;
        if (total) S.busy.value = { stage: "Downloading", fraction: got / total };
      }
      const buf = new Uint8Array(got);
      let o = 0;
      for (const p of parts) {
        buf.set(p, o);
        o += p.length;
      }
      const name = decodeURIComponent(url.split("/").pop()?.split("?")[0] || "layout.gds").replace(/\.gz$/i, "");
      await this.loadBuffer(buf.buffer, name);
    } catch (e) {
      S.busy.value = null;
      S.error.value =
        e instanceof TypeError
          ? "The file could not be downloaded. The server may not allow cross-origin requests; download it and drop it here instead."
          : (e as Error).message;
    }
  }

  async loadBuffer(buf: ArrayBuffer, name: string) {
    batch(() => {
      S.error.value = null;
      S.busy.value = { stage: "Reading records", fraction: 0 };
      this.resetView();
      S.report.value = null;
      S.density.value = null;
      S.sceneInfo.value = null;
      S.summary.value = null;
    });
    try {
      const sum = await this.client.call({ type: "load", buffer: buf, name }, [buf]);
      this.cellHidden = new Set();
      const pdk = detectPdk(sum.layerKeys);
      batch(() => {
        S.summary.value = sum;
        S.pdkId.value = pdk.id;
        S.layers.value = this.layerViews(pdk.id);
      });
      if (sum.missingRefs.length)
        S.notice.value = `${sum.missingRefs.length} referenced cell(s) are not defined in this file: ${sum.missingRefs.slice(0, 5).join(", ")}`;
      else S.notice.value = null;
      if (!sum.cells.length) throw new Error("The library contains no cells.");
      await this.openTop(sum.defaultTop, true);
      this.runReport();
    } catch (e) {
      S.busy.value = null;
      S.error.value = (e as Error).message;
    }
  }

  private resetView() {
    S.selection.value = [];
    S.selIndex.value = 0;
    S.hover.value = null;
    S.ruler.value = null;
    S.sectionLine.value = null;
    S.sectionResult.value = null;
    S.labels.value = [];
    S.highlightCell.value = null;
    S.drcFocus.value = null;
  }

  async openTop(top: number, first = false) {
    S.busy.value = { stage: "Expanding hierarchy", fraction: 0 };
    try {
      const res = await this.client.call({ type: "scene", top });
      this.renderer.setScene(res.scene, this.styles());
      batch(() => {
        this.resetView();
        S.density.value = null;
        S.sceneInfo.value = {
          top: res.top,
          topName: res.topName,
          topBox: res.topBox,
          gallery: res.gallery,
          triangles: res.scene.triangles,
          placements: res.scene.placements,
          buildMs: res.buildMs,
          counts: res.counts,
          first: res.first,
        };
      });
      this.applyHidden();
      if (first && this.pendingHash) {
        this.renderer.view = { ...this.pendingHash };
        this.renderer.keepFit = null;
        this.pendingHash = null;
      } else this.renderer.fit();
      if (this.renderer.mode === "3d") {
        this.renderer.setMode("2d");
        await this.ensure3D();
        this.renderer.setMode("3d");
        this.renderer.fit();
      }
      this.cameraMoved();
      if (!first && S.report.value) this.runReport();
    } catch (e) {
      S.error.value = (e as Error).message;
    } finally {
      S.busy.value = null;
    }
  }

  private async ensure3D() {
    if (this.renderer.ready3D) return;
    if (!this.loading3D) {
      this.loading3D = (async () => {
        S.busy.value = { stage: "Building 3D solids", fraction: 0.5 };
        try {
          const parts = await this.client.call({ type: "extrude" });
          this.renderer.set3D(parts);
        } finally {
          S.busy.value = null;
          this.loading3D = null;
        }
      })();
    }
    await this.loading3D;
  }

  async setMode(m: "2d" | "3d") {
    if (!S.loaded.value) return;
    if (m === "3d") await this.ensure3D();
    this.renderer.setMode(m);
    S.mode.value = m;
    if (m === "3d") {
      S.hover.value = null;
      S.tool.value = "select";
    }
    this.cameraMoved();
  }

  // Layers -----------------------------------------------------------------

  private layerViews(pdkId: string): LayerView[] {
    const sum = S.summary.value!;
    const pdk = ALL_PDKS.find((p) => p.id === pdkId) ?? GENERIC;
    const shapes = new Map(sum.layerShapes);
    return resolveLayers(pdk, sum.layerKeys).map((d) => ({ ...d, shapes: shapes.get(d.key) ?? 0 }));
  }

  setPdk(id: string) {
    S.pdkId.value = id;
    S.layers.value = this.layerViews(id);
    this.pushStyles();
    this.applyHidden();
  }

  private styles(): LayerStyle[] {
    return S.layers.value.map((l) => ({
      key: l.key,
      color: l.color,
      pattern: l.pattern,
      visible: l.visible,
      visible3d: l.visible3d,
      z: l.z,
      t: l.t,
    }));
  }

  pushStyles() {
    this.renderer.setStyles(this.styles());
    this.scheduleIdle();
  }

  updateLayer(key: number, patch: Partial<LayerView>) {
    S.layers.value = S.layers.value.map((l) => (l.key === key ? { ...l, ...patch } : l));
    this.pushStyles();
  }

  /** Toggles visibility in the current view mode. */
  toggleLayer(key: number) {
    const is3d = S.mode.value === "3d";
    const l = S.layers.value.find((x) => x.key === key);
    if (!l) return;
    this.updateLayer(key, is3d ? { visible3d: !l.visible3d } : { visible: !l.visible });
  }

  soloLayer(key: number) {
    const is3d = S.mode.value === "3d";
    const others = S.layers.value.filter((l) => l.key !== key);
    const alreadySolo = others.every((l) => !(is3d ? l.visible3d : l.visible));
    S.layers.value = S.layers.value.map((l) => {
      const on = alreadySolo || l.key === key;
      return is3d ? { ...l, visible3d: on } : { ...l, visible: on };
    });
    this.pushStyles();
  }

  setAllLayers(on: boolean) {
    const is3d = S.mode.value === "3d";
    S.layers.value = S.layers.value.map((l) => (is3d ? { ...l, visible3d: on } : { ...l, visible: on }));
    this.pushStyles();
  }

  moveLayer(key: number, dir: -1 | 1) {
    const arr = [...S.layers.value];
    const i = arr.findIndex((l) => l.key === key);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    S.layers.value = arr;
    this.pushStyles();
  }

  /** Applies names, colors and visibility from a KLayout .lyp file. */
  applyLyp(xml: string) {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const map = new Map<number, { name?: string; color?: string; visible?: boolean }>();
    for (const p of Array.from(doc.getElementsByTagName("properties"))) {
      const src = p.getElementsByTagName("source")[0]?.textContent ?? "";
      const m = /(\d+)\/(\d+)/.exec(src);
      if (!m) continue;
      const key = Number(m[1]) * 65536 + Number(m[2]);
      const name = p.getElementsByTagName("name")[0]?.textContent?.trim();
      const fill = p.getElementsByTagName("fill-color")[0]?.textContent?.trim();
      const frame = p.getElementsByTagName("frame-color")[0]?.textContent?.trim();
      const vis = p.getElementsByTagName("visible")[0]?.textContent?.trim();
      map.set(key, {
        name: name ? name.replace(/\s*-?\s*\d+\/\d+(@\d+)?\s*$/, "").trim() || name : undefined,
        color: /^#[0-9a-f]{6}$/i.test(fill ?? "") ? fill : /^#[0-9a-f]{6}$/i.test(frame ?? "") ? frame : undefined,
        visible: vis === undefined ? undefined : vis !== "false",
      });
    }
    let hits = 0;
    S.layers.value = S.layers.value.map((l) => {
      const e = map.get(l.key);
      if (!e) return l;
      hits++;
      return {
        ...l,
        name: e.name || l.name,
        color: e.color || l.color,
        visible: e.visible ?? l.visible,
      };
    });
    this.pushStyles();
    S.notice.value = `Layer properties applied to ${hits} of ${S.layers.value.length} layers.`;
  }

  // Cells ------------------------------------------------------------------

  isCellHidden(id: number) {
    return this.cellHidden.has(id);
  }

  toggleCell(id: number) {
    if (this.cellHidden.has(id)) this.cellHidden.delete(id);
    else this.cellHidden.add(id);
    this.applyHidden();
  }

  hiddenCellIds(): Set<number> {
    const sum = S.summary.value;
    const out = new Set(this.cellHidden);
    if (sum && S.hideFillers.value) {
      const pdk = ALL_PDKS.find((p) => p.id === S.pdkId.value) ?? GENERIC;
      for (const c of sum.cells) if (pdk.filler.test(c.name)) out.add(c.id);
    }
    return out;
  }

  private applyHidden() {
    if (!this.renderer) return;
    this.renderer.setHiddenCells(this.hiddenCellIds(), S.hideTop.value);
    this.scheduleIdle();
  }

  /** World box of the first placement of a cell. */
  cellWorldBox(id: number): BBox | null {
    const info = S.sceneInfo.value;
    const sum = S.summary.value;
    if (!info || !sum) return null;
    if (id * 6 + 6 > info.first.length) return info.topBox;
    const f = info.first.subarray(id * 6, id * 6 + 6);
    const b = sum.cells[id].fullBox;
    if (Number.isNaN(f[0]) || !(b[0] <= b[2])) return null;
    return transformBox({ a: f[0], b: f[1], c: f[2], d: f[3], tx: f[4], ty: f[5] }, b);
  }

  zoomToCell(id: number) {
    const box = this.cellWorldBox(id);
    if (!box) return;
    if (S.mode.value === "3d") this.renderer.fit(box, 0.6);
    else this.zoomTo(box, 0.6);
    this.cameraMoved();
  }

  // Camera -----------------------------------------------------------------

  zoomTo(box: BBox, margin = 0.7) {
    const b: BBox = [...box] as BBox;
    const minSize = 0.05;
    if (b[2] - b[0] < minSize) {
      const c = (b[0] + b[2]) / 2;
      b[0] = c - minSize / 2;
      b[2] = c + minSize / 2;
    }
    if (b[3] - b[1] < minSize) {
      const c = (b[1] + b[3]) / 2;
      b[1] = c - minSize / 2;
      b[3] = c + minSize / 2;
    }
    this.renderer.fit(b, margin);
    this.renderer.keepFit = null;
    this.cameraMoved();
  }

  zoomToPoint(x: number, y: number, size: number) {
    this.zoomTo([x - size / 2, y - size / 2, x + size / 2, y + size / 2], 0.9);
  }

  fitAll() {
    this.renderer.fit();
    this.cameraMoved();
  }

  zoomBy(f: number) {
    this.renderer.keepFit = null;
    if (this.renderer.mode === "3d") this.renderer.orbit.dist /= f;
    else this.renderer.view.scale *= f;
    this.cameraMoved();
  }

  // Picking ----------------------------------------------------------------

  private visibleKeys() {
    const is3d = S.mode.value === "3d";
    return S.layers.value.filter((l) => (is3d ? l.visible3d : l.visible)).map((l) => l.key);
  }

  /** Drawn layers before outline-only markers, then topmost first, then smallest. */
  private sortHits(hits: PickHit[]) {
    const order = new Map(S.layers.value.map((l, i) => [l.key, i]));
    const byKey = S.layerByKey.value;
    const solid = (k: number) => (byKey.get(k)?.pattern === 1 ? 0 : 1);
    return hits.sort(
      (a, b) => solid(b.key) - solid(a.key) || (order.get(b.key) ?? 0) - (order.get(a.key) ?? 0) || a.area - b.area,
    );
  }

  private pickLatest = latest((x: number, y: number, tol: number) =>
    this.client.call({ type: "pick", x, y, tol, keys: this.visibleKeys(), hiddenCells: [...this.hiddenCellIds()] }),
  );

  async pickAt(sx: number, sy: number) {
    const [x, y] = this.renderer.screenToWorld(sx, sy);
    const tol = 3 / this.renderer.pxPerUm();
    const hits = await this.pickLatest(x, y, tol);
    if (!hits) return;
    const sorted = this.sortHits(hits);
    // Clicking the same spot again steps down through the stack.
    const prev = S.selection.value;
    const same =
      prev.length === sorted.length && prev.length > 1 && prev.every((h, i) => h.key === sorted[i].key && h.area === sorted[i].area);
    batch(() => {
      if (same) S.selIndex.value = (S.selIndex.value + 1) % sorted.length;
      else {
        S.selection.value = sorted;
        S.selIndex.value = 0;
      }
      if (sorted.length) S.rightTab.value = "shape";
    });
  }

  private hoverLatest = latest((x: number, y: number, tol: number) =>
    this.client.call({ type: "pick", x, y, tol, keys: this.visibleKeys(), hiddenCells: [...this.hiddenCellIds()] }),
  );

  async hoverAt(sx: number, sy: number) {
    if (this.renderer.mode === "3d" || S.tool.value !== "select") return;
    const [x, y] = this.renderer.screenToWorld(sx, sy);
    const hits = await this.hoverLatest(x, y, 2 / this.renderer.pxPerUm());
    if (!hits) return;
    S.hover.value = hits.length ? this.sortHits(hits)[0] : null;
  }

  private snapLatest = latest((x: number, y: number, r: number) =>
    this.client.call({ type: "snap", x, y, r, keys: this.visibleKeys() }),
  );

  /** Snaps to a nearby vertex or edge of a visible shape; Shift keeps the line axis-aligned. */
  async snap(sx: number, sy: number, from: [number, number] | null, shift: boolean): Promise<[number, number] | undefined> {
    let [x, y] = this.renderer.screenToWorld(sx, sy);
    if (shift && from) {
      if (Math.abs(x - from[0]) > Math.abs(y - from[1])) y = from[1];
      else x = from[0];
      S.snapPoint.value = null;
      return [x, y];
    }
    const res = await this.snapLatest(x, y, 8 / this.renderer.pxPerUm());
    if (res === undefined) return undefined;
    S.snapPoint.value = res;
    return res ? [res.x, res.y] : [x, y];
  }

  async runSection(a: [number, number], b: [number, number]) {
    const keys = S.layers.value.filter((l) => l.visible3d || l.visible).map((l) => l.key);
    S.sectionResult.value = await this.client.call({ type: "section", x0: a[0], y0: a[1], x1: b[0], y1: b[1], keys });
  }

  // Analysis ---------------------------------------------------------------

  async runReport() {
    if (!S.summary.value) return;
    S.reportBusy.value = true;
    try {
      S.report.value = await this.client.call({ type: "report", thresholds: S.thresholds.value });
    } catch (e) {
      S.error.value = (e as Error).message;
    } finally {
      S.reportBusy.value = false;
    }
  }

  async runDensity(keys: number[], label: string, cells: number) {
    S.busy.value = { stage: "Rasterizing density", fraction: 0 };
    try {
      const d = await this.client.call({ type: "density", keys, cells });
      S.density.value = { ...d, label };
      S.showDensity.value = true;
    } catch (e) {
      S.error.value = (e as Error).message;
    } finally {
      S.busy.value = null;
    }
  }

  focusViolation(i: number) {
    const rep = S.report.value;
    if (!rep) return;
    S.drcFocus.value = i;
    const mk = rep.markers;
    for (let k = 0; k < mk.length; k += 3) {
      if (mk[k + 2] === i) {
        if (S.mode.value === "3d") this.setMode("2d");
        this.zoomToPoint(mk[k], mk[k + 1], 4);
        return;
      }
    }
    S.notice.value = "This violation is in a cell that is not placed under the current top cell.";
  }

  // Shareable view ---------------------------------------------------------

  private writeHash() {
    const v = this.renderer.view;
    if (this.renderer.mode !== "2d") return;
    const h = `#view=${v.cx.toFixed(4)},${v.cy.toFixed(4)},${v.scale.toPrecision(6)}`;
    if (location.hash !== h) history.replaceState(null, "", h);
  }

  private readHash() {
    const q = new URLSearchParams(location.search);
    if (!q.get("url") && !q.get("example")) return;
    const m = /view=(-?[\d.e+-]+),(-?[\d.e+-]+),([\d.e+-]+)/.exec(location.hash);
    if (m) this.pendingHash = { cx: Number(m[1]), cy: Number(m[2]), scale: Number(m[3]) };
  }

  get hostElement() {
    return this.host;
  }
}

export const app = new Controller();
