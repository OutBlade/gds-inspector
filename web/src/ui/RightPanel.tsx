import { useMemo, useState } from "preact/hooks";
import { app } from "../controller";
import * as S from "../state";
import { ALL_PDKS } from "../pdk/pdk";
import { keyLabel, keyLayer } from "../gds/types";
import { formatArea, formatBytes, formatCount, formatDuration, formatLength, formatNm, formatPercent } from "../format";
import { heatColor } from "../render/overlay";
import { exportLayerCsv } from "../export";

type Tab = typeof S.rightTab.value;

const TABS: [Tab, string][] = [
  ["info", "Summary"],
  ["layers", "Layers"],
  ["density", "Density"],
  ["drc", "Checks"],
  ["shape", "Shape"],
];

export function RightPanel() {
  const tab = S.rightTab.value;
  const drc = S.report.value?.report.drc;
  return (
    <aside class="panel right" aria-label="Inspector">
      <nav class="tabs" role="tablist">
        {TABS.map(([id, label]) => (
          <button role="tab" aria-selected={tab === id} onClick={() => (S.rightTab.value = id)}>
            {label}
            {id === "drc" && drc && !drc.passed && <span class="badge">{formatCount(drc.stats.min_width_violations + drc.stats.min_area_violations)}</span>}
          </button>
        ))}
      </nav>
      <div class="panel-body">
        {tab === "info" && <InfoTab />}
        {tab === "layers" && <LayerStatsTab />}
        {tab === "density" && <DensityTab />}
        {tab === "drc" && <DrcTab />}
        {tab === "shape" && <ShapeTab />}
      </div>
    </aside>
  );
}

function KV({ rows }: { rows: [string, string | number | preact.JSX.Element][] }) {
  return (
    <dl class="kv">
      {rows.map(([k, v]) => (
        <>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </>
      ))}
    </dl>
  );
}

function InfoTab() {
  const sum = S.summary.value!;
  const info = S.sceneInfo.value!;
  const b = info.topBox;
  const w = b[2] - b[0];
  const h = b[3] - b[1];
  const pdk = ALL_PDKS.find((p) => p.id === S.pdkId.value)!;
  const rep = S.report.value?.report;
  const placedShapes = S.report.value?.layerStats.reduce((s, l) => s + l.flatShapes, 0);
  return (
    <div class="info-tab">
      <section class="hero-stats">
        <div>
          <b>{formatLength(w)}</b>
          <span>width</span>
        </div>
        <div>
          <b>{formatLength(h)}</b>
          <span>height</span>
        </div>
        <div>
          <b>{formatCount(info.placements)}</b>
          <span>placements</span>
        </div>
        <div>
          <b>{placedShapes !== undefined ? formatCount(placedShapes) : "..."}</b>
          <span>placed shapes</span>
        </div>
      </section>
      <h4>File</h4>
      <KV
        rows={[
          ["Name", sum.fileName],
          ["Size", formatBytes(sum.sizeBytes)],
          ["Library", sum.name || "unnamed"],
          ["User unit", `${formatLength(sum.userUnitMeters * 1e6)}`],
          ["Database unit", `${formatLength(sum.precisionMeters * 1e6)}`],
          ["Parsed in", formatDuration(sum.parseMs / 1000)],
        ]}
      />
      <h4>Design</h4>
      <KV
        rows={[
          ["Top cell", info.topName],
          ["Origin", `${b[0].toFixed(3)}, ${b[1].toFixed(3)} µm`],
          ["Area", formatArea(w * h)],
          ["Cells", `${formatCount(sum.cells.length)} defined, ${formatCount(info.counts.subarray(0, sum.cells.length).filter((c) => c > 0).length)} used`],
          ["Top cells in file", String(sum.tops.length)],
          ["Layers", String(S.layers.value.length)],
          ["Process", pdk.id === "generic" ? "not recognised, generic colors" : pdk.name],
          ["Triangles drawn", formatCount(info.triangles)],
          ["Scene built in", formatDuration(info.buildMs / 1000)],
        ]}
      />
      {rep && (
        <>
          <h4>Quick check</h4>
          <KV
            rows={[
              ["Rule checks", rep.drc.passed ? <span class="ok">passed</span> : <span class="bad">{formatCount(rep.drc.violations.length)} findings</span>],
              [
                "Smallest feature",
                (() => {
                  const m = Math.min(...rep.layers.filter((l) => l.min_cd_nm > 0).map((l) => l.min_cd_nm));
                  return Number.isFinite(m) ? formatNm(m) : "n/a";
                })(),
              ],
            ]}
          />
        </>
      )}
      <p class="hint local">Your file is processed in this browser tab and is never uploaded.</p>
    </div>
  );
}

type SortKey = "order" | "shapes" | "area" | "density" | "minw";

function LayerStatsTab() {
  const rep = S.report.value;
  const info = S.sceneInfo.value!;
  const [sort, setSort] = useState<SortKey>("order");
  const byKey = S.layerByKey.value;
  const limitNm = S.thresholds.value.min_width_nm;
  const b = info.topBox;
  const total = (b[2] - b[0]) * (b[3] - b[1]);
  const rows = useMemo(() => {
    if (!rep) return [];
    const order = new Map(S.layers.value.map((l, i) => [l.key, i]));
    const r = rep.layerStats.map((s) => ({ ...s, density: total > 0 ? (s.flatArea / total) * 100 : 0 }));
    const cmp: Record<SortKey, (a: (typeof r)[0], b: (typeof r)[0]) => number> = {
      order: (a, b) => (order.get(b.key) ?? 0) - (order.get(a.key) ?? 0),
      shapes: (a, b) => b.flatShapes - a.flatShapes,
      area: (a, b) => b.flatArea - a.flatArea,
      density: (a, b) => b.density - a.density,
      minw: (a, b) => a.minWidth - b.minWidth,
    };
    return r.sort(cmp[sort]);
  }, [rep, sort, total, S.layers.value]);

  if (!rep) return <Pending />;
  const th = (k: SortKey, label: string, title: string) => (
    <th aria-sort={sort === k ? "descending" : "none"} title={title}>
      <button onClick={() => setSort(k)}>{label}</button>
    </th>
  );
  return (
    <div class="stats-tab">
      <div class="row between">
        <p class="hint">Placed values count every placement below the top cell. Density is placed area over the top cell box; overlaps count twice, see Density for true coverage.</p>
      </div>
      <div class="table-wrap">
        <table class="grid-table">
          <thead>
            <tr>
              {th("order", "Layer", "Stack order")}
              {th("shapes", "Shapes", "Placed shapes")}
              {th("area", "Area", "Placed area")}
              {th("density", "Dens.", "Placed area over top cell box")}
              {th("minw", "Min w", "Smallest bounding box side of a shape")}
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => {
              const l = byKey.get(s.key);
              const small = s.minWidth > 0 && s.minWidth * 1000 < limitNm;
              return (
                <tr>
                  <td>
                    <span class="dot" style={{ background: l?.color }} />
                    <span class="nm" title={keyLabel(s.key)}>
                      {l?.name ?? keyLabel(s.key)}
                    </span>
                  </td>
                  <td class="num" title={`${s.shapes} in cell definitions`}>
                    {formatCount(s.flatShapes)}
                  </td>
                  <td class="num">{formatArea(s.flatArea)}</td>
                  <td class="num">{s.density.toFixed(1)}</td>
                  <td class={`num${small ? " bad" : ""}`} title={`min edge ${formatLength(s.minEdge)}, max width ${formatLength(s.maxWidth)}`}>
                    {formatLength(s.minWidth)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <button class="btn small" onClick={exportLayerCsv}>
        Download CSV
      </button>
    </div>
  );
}

function Pending() {
  return (
    <div class="pending">
      <div class="spinner" />
      Analysing layout
    </div>
  );
}

function DensityTab() {
  const layers = S.layers.value.filter((l) => l.shapes > 0);
  const d = S.density.value;
  // Default to the busiest drawn layer, which is usually the one worth checking.
  const [pick, setPick] = useState<string>(() => {
    const cand = layers.filter((l) => l.visible && l.pattern !== 1).sort((a, b) => b.shapes - a.shapes)[0] ?? layers[0];
    return cand ? String(keyLayer(cand.key)) : "";
  });
  const [grid, setGrid] = useState(64);
  const [dose, setDose] = useState(300);
  const [current, setCurrent] = useState(1);
  const numbers = [...new Set(layers.map((l) => keyLayer(l.key)))].sort((a, b) => a - b);

  const run = () => {
    const mode = pick.startsWith("k") ? "key" : "layer";
    const keys = mode === "key" ? [Number(pick.slice(1))] : layers.filter((l) => keyLayer(l.key) === Number(pick)).map((l) => l.key);
    const label = mode === "key" ? S.layerByKey.value.get(Number(pick.slice(1)))?.name ?? pick : `layer ${pick}`;
    app.runDensity(keys, label, grid);
  };

  const stats = useMemo(() => {
    if (!d) return null;
    let min = Infinity;
    let max = 0;
    let sum = 0;
    const hist = new Array(10).fill(0);
    for (const v of d.values) {
      min = Math.min(min, v);
      max = Math.max(max, v);
      sum += v;
      hist[Math.min(9, Math.floor(v * 10))]++;
    }
    return { min, max, mean: sum / d.values.length, hist, peak: Math.max(...hist) };
  }, [d]);

  // Exposure time: charge = area x dose; t = Q / I.
  const areaCm2 = d ? d.unionArea * 1e-8 : 0;
  const seconds = d && current > 0 ? (areaCm2 * dose * 1e-6) / (current * 1e-9) : NaN;

  return (
    <div class="density-tab">
      <p class="hint">Rasterizes the placed geometry, so overlapping shapes count once. The map overlays the layout in the 2D view.</p>
      <label class="field">
        <span>Layer</span>
        <select value={pick} onChange={(e) => setPick((e.currentTarget as HTMLSelectElement).value)}>
          <optgroup label="All datatypes of a layer">
            {numbers.map((n) => (
              <option value={String(n)}>
                Layer {n}
                {layers.find((l) => keyLayer(l.key) === n) ? ` (${layers.filter((l) => keyLayer(l.key) === n).map((l) => l.name).join(", ")})` : ""}
              </option>
            ))}
          </optgroup>
          <optgroup label="Single layer and datatype">
            {layers.map((l) => (
              <option value={`k${l.key}`}>
                {l.name} ({keyLabel(l.key)})
              </option>
            ))}
          </optgroup>
        </select>
      </label>
      <div class="row gap">
        <label class="field grow">
          <span>Tiles across</span>
          <select value={grid} onChange={(e) => setGrid(Number((e.currentTarget as HTMLSelectElement).value))}>
            {[16, 32, 64, 128, 256].map((g) => (
              <option value={g}>{g}</option>
            ))}
          </select>
        </label>
        <button class="btn primary" onClick={run} disabled={!pick}>
          Compute
        </button>
      </div>
      {d && stats && (
        <>
          <div class="row between">
            <h4>{d.label}</h4>
            <label class="check">
              <input type="checkbox" checked={S.showDensity.value} onChange={(e) => (S.showDensity.value = (e.currentTarget as HTMLInputElement).checked)} />
              <span>Overlay (D)</span>
            </label>
          </div>
          <KV
            rows={[
              ["Coverage", formatPercent(d.coverage * 100)],
              ["Covered area", formatArea(d.unionArea)],
              ["Tile min / max", `${formatPercent(stats.min * 100, 1)} / ${formatPercent(stats.max * 100, 1)}`],
              ["Tile size", `${formatLength((d.box[2] - d.box[0]) / d.cols)} x ${formatLength((d.box[3] - d.box[1]) / d.rows)}`],
            ]}
          />
          <div class="histo" aria-label="Tile density histogram">
            {stats.hist.map((n, i) => (
              <div class="bar-col" title={`${i * 10} to ${i * 10 + 10} %: ${n} tiles`}>
                <div style={{ height: `${(n / (stats.peak || 1)) * 100}%`, background: `rgb(${heatColor((i + 0.5) / 10).join(",")})` }} />
              </div>
            ))}
          </div>
          <div class="histo-axis">
            <span>0 %</span>
            <span>50 %</span>
            <span>100 %</span>
          </div>
          <h4>EBL exposure time</h4>
          <div class="row gap">
            <label class="field grow">
              <span>Dose (µC/cm²)</span>
              <input type="number" min="0" step="10" value={dose} onInput={(e) => setDose(Number((e.currentTarget as HTMLInputElement).value))} />
            </label>
            <label class="field grow">
              <span>Beam current (nA)</span>
              <input type="number" min="0" step="0.1" value={current} onInput={(e) => setCurrent(Number((e.currentTarget as HTMLInputElement).value))} />
            </label>
          </div>
          <div class="result-line">
            <span>Beam-on time</span>
            <b>{formatDuration(seconds)}</b>
          </div>
          <p class="hint">Charge over current for the covered area. Settling, stage moves and field stitching come on top.</p>
        </>
      )}
    </div>
  );
}

function DrcTab() {
  const rep = S.report.value;
  const th = S.thresholds.value;
  const busy = S.reportBusy.value;
  const [filter, setFilter] = useState<"all" | "MIN_WIDTH" | "MIN_AREA">("all");
  if (!rep) return <Pending />;
  const drc = rep.report.drc;
  const byKey = S.layerByKey.value;
  const list = drc.violations.map((v, i) => ({ v, i })).filter(({ v }) => filter === "all" || v.rule === filter);
  return (
    <div class="drc-tab">
      <div class="row gap">
        <label class="field grow">
          <span>Min width (nm)</span>
          <input type="number" min="0" value={th.min_width_nm} onInput={(e) => (S.thresholds.value = { ...th, min_width_nm: Number((e.currentTarget as HTMLInputElement).value) })} />
        </label>
        <label class="field grow">
          <span>Min area (µm²)</span>
          <input type="number" min="0" step="0.001" value={th.min_area_um2} onInput={(e) => (S.thresholds.value = { ...th, min_area_um2: Number((e.currentTarget as HTMLInputElement).value) })} />
        </label>
      </div>
      <div class="row gap">
        <button class="btn primary" disabled={busy} onClick={() => app.runReport()}>
          {busy ? "Checking" : "Run checks"}
        </button>
        <label class="check">
          <input type="checkbox" checked={S.showMarkers.value} onChange={(e) => (S.showMarkers.value = (e.currentTarget as HTMLInputElement).checked)} />
          <span>Markers</span>
        </label>
      </div>
      <div class={`verdict ${drc.passed ? "ok" : "bad"}`}>
        {drc.passed ? "No findings" : `${formatCount(drc.stats.min_width_violations)} width and ${formatCount(drc.stats.min_area_violations)} area findings`}
        <small>{formatCount(drc.stats.total_polygons_checked)} polygons checked in cell definitions</small>
      </div>
      {!drc.passed && (
        <>
          <div class="segmented small" role="group">
            {(["all", "MIN_WIDTH", "MIN_AREA"] as const).map((f) => (
              <button aria-pressed={filter === f} onClick={() => setFilter(f)}>
                {f === "all" ? "All" : f === "MIN_WIDTH" ? "Width" : "Area"}
              </button>
            ))}
          </div>
          <ul class="violations">
            {list.map(({ v, i }) => (
              <li>
                <button aria-current={S.drcFocus.value === i} onClick={() => app.focusViolation(i)}>
                  <span class={`sev ${v.severity}`}>{v.rule === "MIN_WIDTH" ? "W" : "A"}</span>
                  <span class="main">
                    <span class="nm">{byKey.get(v.layer * 65536 + v.datatype)?.name ?? `${v.layer}/${v.datatype}`}</span>
                    <span class="sub">{v.cell}</span>
                  </span>
                  <span class="val">{v.rule === "MIN_WIDTH" ? formatNm(v.value_nm!) : formatArea(v.value_um2!)}</span>
                </button>
              </li>
            ))}
          </ul>
          {drc.violations.length < drc.stats.min_width_violations + drc.stats.min_area_violations && (
            <p class="hint">The list shows the first 200 width and 100 area findings, as in the desktop app.</p>
          )}
        </>
      )}
    </div>
  );
}

function ShapeTab() {
  const hits = S.selection.value;
  const sel = S.selected.value;
  const byKey = S.layerByKey.value;
  const sum = S.summary.value!;
  if (!sel)
    return (
      <div class="empty-state">
        <p>Click a shape in the 2D view to inspect it.</p>
        <p class="hint">Click the same spot again to step through stacked shapes.</p>
      </div>
    );
  const l = byKey.get(sel.key);
  const w = sel.box[2] - sel.box[0];
  const h = sel.box[3] - sel.box[1];
  const cellId = sum.cells.find((c) => c.name === sel.cell)?.id;
  return (
    <div class="shape-tab">
      <div class="shape-head">
        <span class="swatch big" style={{ "--c": l?.color } as never} data-pattern={l?.pattern} />
        <div>
          <b>{l?.name ?? keyLabel(sel.key)}</b>
          <small>
            {keyLabel(sel.key)} {sel.kind}
          </small>
        </div>
      </div>
      <KV
        rows={[
          ["Width", formatLength(w)],
          ["Height", formatLength(h)],
          ["Area", formatArea(sel.area)],
          ["Vertices", String(sel.ring.length / 2)],
          ["Lower left", `${sel.box[0].toFixed(4)}, ${sel.box[1].toFixed(4)}`],
          ["Upper right", `${sel.box[2].toFixed(4)}, ${sel.box[3].toFixed(4)}`],
          ["Cell", sel.cell],
        ]}
      />
      <h4>Hierarchy</h4>
      <ol class="crumbs">
        {sel.path.map((p) => (
          <li>{p}</li>
        ))}
      </ol>
      <div class="row gap wrap">
        <button class="btn small" onClick={() => app.zoomTo(sel.box)}>
          Zoom to shape
        </button>
        {cellId !== undefined && (
          <>
            <button class="btn small" onClick={() => (S.highlightCell.value = S.highlightCell.value === cellId ? null : cellId)}>
              Highlight cell
            </button>
            <button class="btn small" onClick={() => app.openTop(cellId)}>
              Open cell
            </button>
          </>
        )}
      </div>
      {hits.length > 1 && (
        <>
          <h4>At this point ({hits.length})</h4>
          <ul class="results">
            {hits.map((h, i) => (
              <li>
                <button aria-current={i === S.selIndex.value} onClick={() => (S.selIndex.value = i)}>
                  <span class="dot" style={{ background: byKey.get(h.key)?.color }} />
                  <span class="nm">{byKey.get(h.key)?.name ?? keyLabel(h.key)}</span>
                  <span class="sub">{h.cell}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
