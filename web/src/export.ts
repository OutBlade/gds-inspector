import { app } from "./controller";
import { drawOverlay } from "./render/overlay";
import * as S from "./state";
import { keyLabel } from "./gds/types";

function download(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

const base = () => (S.summary.value?.fileName ?? "layout").replace(/\.(gds2?|gdsx|gdsii)$/i, "");

export function exportPng(scale = 3) {
  const r = app.renderer;
  const gl = r.snapshot(scale);
  const out = document.createElement("canvas");
  out.width = gl.width;
  out.height = gl.height;
  const ctx = out.getContext("2d")!;
  ctx.drawImage(gl, 0, 0);
  const ov = document.createElement("canvas");
  ov.width = gl.width;
  ov.height = gl.height;
  drawOverlay(ov.getContext("2d")!, r, scale);
  ctx.drawImage(ov, 0, 0);
  out.toBlob((b) => b && download(b, `${base()}.png`), "image/png");
}

/** Vector export of the visible area with the current layer colors. */
export async function exportSvg() {
  const r = app.renderer;
  if (r.mode !== "2d") await app.setMode("2d");
  const box = r.viewBox();
  const keys = S.layers.value.filter((l) => l.visible).map((l) => l.key);
  const res = await app.client.call({
    type: "shapes",
    box,
    keys,
    hiddenCells: [...app.hiddenCellIds()],
    maxPoints: 4_000_000,
  });
  const { width, height } = r.size;
  const s = r.view.scale;
  const fx = (x: number) => ((x - box[0]) * s).toFixed(2);
  const fy = (y: number) => ((box[3] - y) * s).toFixed(2);
  const byKey = new Map(res.layers.map((l) => [l.key, l.rings]));
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect width="100%" height="100%" fill="${S.theme.value === "dark" ? "#0b0d12" : "#ffffff"}"/>`,
  ];
  for (const l of S.layers.value) {
    const rings = byKey.get(l.key);
    if (!rings) continue;
    const d: string[] = [];
    for (const ring of rings) {
      let p = `M${fx(ring[0])} ${fy(ring[1])}`;
      for (let i = 2; i < ring.length; i += 2) p += `L${fx(ring[i])} ${fy(ring[i + 1])}`;
      d.push(p + "Z");
    }
    const hollow = l.pattern === 1;
    parts.push(
      `<path data-layer="${keyLabel(l.key)}" data-name="${escapeXml(l.name)}" d="${d.join("")}" fill="${hollow ? "none" : l.color}" fill-opacity="0.35" stroke="${l.color}" stroke-width="1"/>`,
    );
  }
  parts.push("</svg>");
  download(new Blob([parts.join("\n")], { type: "image/svg+xml" }), `${base()}.svg`);
  if (res.truncated) S.notice.value = "The view held more geometry than the SVG limit; zoom in for a complete export.";
}

function escapeXml(s: string) {
  return s.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]!);
}

/** Same JSON the desktop backend prints, so both reports can be compared directly. */
export function exportReport() {
  const rep = S.report.value;
  if (!rep) return;
  download(new Blob([JSON.stringify(rep.report, null, 2)], { type: "application/json" }), `${base()}.report.json`);
}

export function exportLayerCsv() {
  const rep = S.report.value;
  const info = S.sceneInfo.value;
  const sum = S.summary.value;
  if (!rep || !info || !sum) return;
  const byKey = S.layerByKey.value;
  const b = info.topBox;
  const area = (b[2] - b[0]) * (b[3] - b[1]);
  const rows = [
    ["layer", "datatype", "name", "shapes", "placed_shapes", "placed_area_um2", "density_percent", "min_width_nm", "max_width_nm", "min_edge_nm"],
  ];
  for (const s of rep.layerStats) {
    rows.push([
      String(Math.floor(s.key / 65536)),
      String(s.key % 65536),
      byKey.get(s.key)?.name ?? "",
      String(s.shapes),
      String(s.flatShapes),
      s.flatArea.toFixed(6),
      area > 0 ? ((s.flatArea / area) * 100).toFixed(4) : "",
      (s.minWidth * 1000).toFixed(2),
      (s.maxWidth * 1000).toFixed(2),
      (s.minEdge * 1000).toFixed(2),
    ]);
  }
  const csv = rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\n");
  download(new Blob([csv], { type: "text/csv" }), `${base()}.layers.csv`);
}
