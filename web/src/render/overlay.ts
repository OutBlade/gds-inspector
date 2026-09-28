import type { LayoutRenderer } from "./renderer";
import * as S from "../state";
import { formatLength, niceStep } from "../format";

const HEAT = [
  [0.0, [13, 8, 135]],
  [0.25, [126, 3, 168]],
  [0.5, [204, 71, 120]],
  [0.75, [248, 149, 64]],
  [1.0, [240, 249, 33]],
] as const;

export function heatColor(v: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, v));
  for (let i = 1; i < HEAT.length; i++) {
    const [p1, c1] = HEAT[i];
    const [p0, c0] = HEAT[i - 1];
    if (t <= p1) {
      const f = (t - p0) / (p1 - p0);
      return [c0[0] + (c1[0] - c0[0]) * f, c0[1] + (c1[1] - c0[1]) * f, c0[2] + (c1[2] - c0[2]) * f];
    }
  }
  return [240, 249, 33];
}

let heatCache: { src: unknown; canvas: HTMLCanvasElement } | null = null;

function heatImage(d: NonNullable<typeof S.density.value>) {
  if (heatCache?.src === d) return heatCache.canvas;
  const c = document.createElement("canvas");
  c.width = d.cols;
  c.height = d.rows;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(d.cols, d.rows);
  for (let r = 0; r < d.rows; r++) {
    for (let col = 0; col < d.cols; col++) {
      // values row 0 is the bottom; image row 0 is the top.
      const v = d.values[(d.rows - 1 - r) * d.cols + col];
      const [R, G, B] = heatColor(v);
      const o = (r * d.cols + col) * 4;
      img.data[o] = R;
      img.data[o + 1] = G;
      img.data[o + 2] = B;
      // Empty tiles stay nearly clear so the layout remains readable under the map.
      img.data[o + 3] = Math.round(35 + 185 * Math.sqrt(Math.max(0, v)));
    }
  }
  ctx.putImageData(img, 0, 0);
  heatCache = { src: d, canvas: c };
  return c;
}

/** Draws everything that is not layout geometry: selection, tools, labels, markers, scale bar. */
export function drawOverlay(ctx: CanvasRenderingContext2D, r: LayoutRenderer, ratio: number) {
  const { width, height } = r.size;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  const dark = S.theme.value === "dark";
  const accent = dark ? "#8b9bff" : "#3346d3";
  const ink = dark ? "#e8eaf0" : "#1b1e26";
  const halo = dark ? "rgba(11,13,18,0.85)" : "rgba(246,246,243,0.9)";
  if (r.mode === "3d") {
    drawScaleBar(ctx, r, ink, halo, height, true);
    return;
  }
  const w2s = (x: number, y: number) => r.worldToScreen(x, y);

  const d = S.density.value;
  if (d && S.showDensity.value) {
    const [x0, y0] = w2s(d.box[0], d.box[3]);
    const [x1, y1] = w2s(d.box[2], d.box[1]);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(heatImage(d), x0, y0, x1 - x0, y1 - y0);
    ctx.imageSmoothingEnabled = true;
  }

  if (S.showGrid.value) drawGrid(ctx, r, dark, width, height);

  const hc = S.highlightCell.value;
  if (hc !== null) {
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.5;
    ctx.fillStyle = dark ? "rgba(139,155,255,0.10)" : "rgba(51,70,211,0.08)";
    ctx.beginPath();
    for (const b of r.cellBoxes(hc, 20_000)) {
      const [x0, y0] = w2s(b[0], b[3]);
      const [x1, y1] = w2s(b[2], b[1]);
      ctx.rect(x0, y0, Math.max(x1 - x0, 1), Math.max(y1 - y0, 1));
    }
    ctx.fill();
    ctx.stroke();
  }

  const rep = S.report.value;
  const checksOpen = S.rightOpen.value && S.rightTab.value === "drc";
  if (rep && S.showMarkers.value && (checksOpen || S.drcFocus.value !== null) && rep.markers.length) {
    const mk = rep.markers;
    const focus = S.drcFocus.value;
    for (let i = 0; i < mk.length; i += 3) {
      const [sx, sy] = w2s(mk[i], mk[i + 1]);
      if (sx < -20 || sy < -20 || sx > width + 20 || sy > height + 20) continue;
      const v = rep.report.drc.violations[mk[i + 2]];
      const focused = focus === mk[i + 2];
      ctx.strokeStyle = v.severity === "error" ? "#ff5a5f" : "#ffb224";
      ctx.lineWidth = focused ? 2.5 : 1.5;
      const s = focused ? 11 : 6;
      ctx.beginPath();
      ctx.moveTo(sx - s, sy - s);
      ctx.lineTo(sx + s, sy + s);
      ctx.moveTo(sx + s, sy - s);
      ctx.lineTo(sx - s, sy + s);
      ctx.stroke();
      if (focused) {
        ctx.beginPath();
        ctx.arc(sx, sy, 16, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  const ring = (xy: Float64Array) => {
    ctx.beginPath();
    for (let i = 0; i < xy.length; i += 2) {
      const [sx, sy] = w2s(xy[i], xy[i + 1]);
      if (i === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    }
    ctx.closePath();
  };

  const hv = S.hover.value;
  if (hv && S.tool.value === "select") {
    ring(hv.ring);
    ctx.strokeStyle = dark ? "rgba(255,255,255,0.75)" : "rgba(0,0,0,0.65)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  const sel = S.selected.value;
  if (sel) {
    ring(sel.ring);
    ctx.fillStyle = dark ? "rgba(255,255,255,0.16)" : "rgba(51,70,211,0.14)";
    ctx.fill();
    ctx.strokeStyle = dark ? "#ffffff" : accent;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  if (S.showLabels.value) drawLabels(ctx, r, ink, halo, width, height);

  const ru = S.ruler.value;
  if (ru) drawRuler(ctx, r, ru.a, ru.b, accent, ink, halo);
  const sl = S.sectionLine.value;
  if (sl) drawSectionLine(ctx, r, sl.a, sl.b, dark ? "#ffb224" : "#c26a00");

  const sp = S.snapPoint.value;
  if (sp && S.tool.value !== "select") {
    const [sx, sy] = w2s(sp.x, sp.y);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.5;
    if (sp.kind === "vertex") ctx.strokeRect(sx - 5, sy - 5, 10, 10);
    else {
      ctx.beginPath();
      ctx.arc(sx, sy, 5, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  drawScaleBar(ctx, r, ink, halo, height, false);
}

function drawGrid(ctx: CanvasRenderingContext2D, r: LayoutRenderer, dark: boolean, width: number, height: number) {
  const step = niceStep(60 / r.view.scale);
  const vb = r.viewBox();
  ctx.strokeStyle = dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.07)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = Math.ceil(vb[0] / step) * step; x <= vb[2]; x += step) {
    const [sx] = r.worldToScreen(x, 0);
    ctx.moveTo(Math.round(sx) + 0.5, 0);
    ctx.lineTo(Math.round(sx) + 0.5, height);
  }
  for (let y = Math.ceil(vb[1] / step) * step; y <= vb[3]; y += step) {
    const [, sy] = r.worldToScreen(0, y);
    ctx.moveTo(0, Math.round(sy) + 0.5);
    ctx.lineTo(width, Math.round(sy) + 0.5);
  }
  ctx.stroke();
}

function text(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, ink: string, halo: string) {
  ctx.lineWidth = 3;
  ctx.strokeStyle = halo;
  ctx.strokeText(s, x, y);
  ctx.fillStyle = ink;
  ctx.fillText(s, x, y);
}

function drawLabels(ctx: CanvasRenderingContext2D, r: LayoutRenderer, ink: string, halo: string, width: number, height: number) {
  const list = S.labels.value;
  if (!list.length) return;
  const byKey = S.layerByKey.value;
  ctx.font = "500 11px ui-monospace, SFMono-Regular, Consolas, monospace";
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  // Coarse occupancy grid to keep labels from piling on top of each other.
  const cell = 14;
  const cols = Math.ceil(width / cell) + 1;
  const taken = new Uint8Array(cols * (Math.ceil(height / cell) + 1));
  let shown = 0;
  for (const l of list) {
    const lay = byKey.get(l.key);
    if (lay && !lay.visible) continue;
    const [sx, sy] = r.worldToScreen(l.x, l.y);
    if (sx < 0 || sy < 0 || sx > width || sy > height) continue;
    const w = ctx.measureText(l.text).width + 8;
    const c0 = Math.floor(sx / cell);
    const c1 = Math.floor((sx + w) / cell);
    const row = Math.floor(sy / cell);
    let free = true;
    for (let c = c0; c <= c1 && free; c++) if (taken[row * cols + c]) free = false;
    if (!free) continue;
    for (let c = c0; c <= c1; c++) taken[row * cols + c] = 1;
    ctx.fillStyle = lay?.color ?? ink;
    ctx.fillRect(sx - 2, sy - 2, 4, 4);
    text(ctx, l.text, sx + 5, sy, ink, halo);
    if (++shown > 400) break;
  }
}

function drawRuler(
  ctx: CanvasRenderingContext2D,
  r: LayoutRenderer,
  a: [number, number],
  b: [number, number],
  color: string,
  ink: string,
  halo: string,
) {
  const [ax, ay] = r.worldToScreen(a[0], a[1]);
  const [bx, by] = r.worldToScreen(b[0], b[1]);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  // End ticks perpendicular to the ruler.
  const len = Math.hypot(bx - ax, by - ay) || 1;
  const nx = (-(by - ay) / len) * 6;
  const ny = ((bx - ax) / len) * 6;
  ctx.moveTo(ax - nx, ay - ny);
  ctx.lineTo(ax + nx, ay + ny);
  ctx.moveTo(bx - nx, by - ny);
  ctx.lineTo(bx + nx, by + ny);
  ctx.stroke();
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const d = Math.hypot(dx, dy);
  ctx.font = "600 12px ui-monospace, SFMono-Regular, Consolas, monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  const label = formatLength(d);
  const sub = `dx ${formatLength(Math.abs(dx))}  dy ${formatLength(Math.abs(dy))}`;
  const mx = (ax + bx) / 2 + 8;
  const my = (ay + by) / 2 - 6;
  text(ctx, label, mx, my, ink, halo);
  ctx.font = "11px ui-monospace, SFMono-Regular, Consolas, monospace";
  ctx.textBaseline = "top";
  text(ctx, sub, mx, my + 2, ink, halo);
}

function drawSectionLine(
  ctx: CanvasRenderingContext2D,
  r: LayoutRenderer,
  a: [number, number],
  b: [number, number],
  color: string,
) {
  const [ax, ay] = r.worldToScreen(a[0], a[1]);
  const [bx, by] = r.worldToScreen(b[0], b[1]);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 5]);
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.font = "700 12px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const [x, y, s] of [
    [ax, ay, "A"],
    [bx, by, "B"],
  ] as const) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#111";
    ctx.fillText(s, x, y + 0.5);
  }
}

function drawScaleBar(
  ctx: CanvasRenderingContext2D,
  r: LayoutRenderer,
  ink: string,
  halo: string,
  height: number,
  approx: boolean,
) {
  const ppu = r.pxPerUm();
  const step = niceStep(120 / ppu);
  const px = step * ppu;
  const x = 16;
  const y = height - 18;
  ctx.fillStyle = halo;
  ctx.fillRect(x - 6, y - 20, px + 12, 28);
  ctx.strokeStyle = ink;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y - 5);
  ctx.lineTo(x, y);
  ctx.lineTo(x + px, y);
  ctx.lineTo(x + px, y - 5);
  ctx.stroke();
  ctx.font = "600 11px ui-monospace, SFMono-Regular, Consolas, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillStyle = ink;
  ctx.fillText((approx ? "≈ " : "") + formatLength(step), x + px / 2, y - 4);
}
