const LAYER_COLORS = [
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

function layerColor(layer) {
  return LAYER_COLORS[layer % LAYER_COLORS.length];
}

let analysisData = null;
let activePanel = "file";

document.addEventListener("DOMContentLoaded", () => {
  setupNav();
  setupDrop();
  document.getElementById("open-btn").addEventListener("click", async () => {
    const fp = await window.gdsAPI.openDialog();
    if (fp) loadFile(fp);
  });

  window.gdsAPI.getVersion().then((v) => {
    document.getElementById("version-badge").textContent = `v${v}`;
  });

  window.gdsAPI.onResult((data) => {
    analysisData = data;
    document.getElementById("drop-zone").classList.add("hidden");
    document.querySelectorAll(".nav-btn").forEach((b) => b.removeAttribute("disabled"));
    switchPanel("layers");
    const total = data.layers.reduce((s, l) => s + l.polygon_count, 0);
    setStatus(
      `${data.file_info.path}  —  ${data.layers.length} layers  |  ${total.toLocaleString()} polygons  |  top cell: ${data.top_cell}`
    );
  });

  window.gdsAPI.onError((msg) => {
    document.getElementById("drop-zone").classList.remove("hidden");
    setStatus(`Error: ${msg}`, "error");
  });

  window.gdsAPI.onUpdateDownloaded((version) => {
    const toast = document.getElementById("update-toast");
    document.getElementById("update-version").textContent = version;
    toast.classList.remove("hidden");
    document.getElementById("install-update-btn").onclick = () => window.gdsAPI.installUpdate();
    document.getElementById("dismiss-update-btn").onclick = () => toast.classList.add("hidden");
  });
});

function setupNav() {
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.disabled) return;
      switchPanel(btn.dataset.panel);
    });
  });
}

function switchPanel(name) {
  activePanel = name;
  document.querySelectorAll(".nav-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.panel === name);
  });
  renderPanel(name);
}

function setupDrop() {
  document.body.addEventListener("dragover", (e) => {
    e.preventDefault();
    document.getElementById("drop-zone").classList.add("drag-over");
  });
  document.body.addEventListener("dragleave", (e) => {
    if (!document.body.contains(e.relatedTarget))
      document.getElementById("drop-zone").classList.remove("drag-over");
  });
  document.body.addEventListener("drop", (e) => {
    e.preventDefault();
    document.getElementById("drop-zone").classList.remove("drag-over");
    const f = e.dataTransfer.files[0];
    if (f && /\.(gds2?|gdsx)$/i.test(f.name)) {
      loadFile(f.path);
    } else if (f) {
      setStatus("Drop a .gds file", "error");
    }
  });
}

function loadFile(fp) {
  setStatus("Analyzing…");
  window.gdsAPI.analyzeFile(fp);
}

function setStatus(msg, type = "") {
  const el = document.getElementById("status-bar");
  el.textContent = msg;
  el.className = "status-bar " + type;
}

function renderPanel(name) {
  const el = document.getElementById("panel-content");
  if (!analysisData) return;
  const map = { file: renderFile, layers: renderLayers, density: renderDensity, features: renderFeatures, drc: renderDRC };
  if (name === "preview") {
    el.innerHTML = "";
    renderPreview(el);
  } else if (map[name]) {
    el.innerHTML = map[name](analysisData);
  }
}

// ── File Info ──────────────────────────────────────────────────────
function renderFile(d) {
  const fi = d.file_info;
  return `
    <div class="panel-section">
      <h2 class="panel-title">File Information</h2>
      <table class="info-table">
        <tr><td>Library Name</td><td>${fi.library_name || "(unnamed)"}</td></tr>
        <tr><td>File</td><td>${fi.path}</td></tr>
        <tr><td>Size</td><td>${(fi.size_bytes / 1024).toFixed(1)} KB</td></tr>
        <tr><td>Unit</td><td>${fi.unit_label} (${fi.unit_meters} m)</td></tr>
        <tr><td>Precision</td><td>${(fi.precision_meters * 1e9).toFixed(0)} nm</td></tr>
        <tr><td>Top Cell</td><td>${d.top_cell || "N/A"}</td></tr>
        <tr><td>Cells</td><td>${fi.cell_count}</td></tr>
        <tr><td>Layers</td><td>${d.layers.length}</td></tr>
        <tr><td>Total Polygons</td><td>${d.layers.reduce((s, l) => s + l.polygon_count, 0).toLocaleString()}</td></tr>
      </table>
    </div>
    <div class="panel-section">
      <h2 class="panel-title">Cell Hierarchy</h2>
      <table class="data-table">
        <thead><tr><th>Cell</th><th>Polygons</th><th>Paths</th><th>References</th><th>Width (µm)</th><th>Height (µm)</th></tr></thead>
        <tbody>
          ${d.cells
            .map(
              (c) => `
            <tr class="${c.is_top ? "top-cell" : ""}">
              <td>${c.name}${c.is_top ? ' <span class="badge" style="background:var(--accent-glow);color:var(--accent);border:1px solid var(--accent)">TOP</span>' : ""}</td>
              <td>${c.polygon_count.toLocaleString()}</td>
              <td>${c.path_count}</td>
              <td>${c.reference_count}</td>
              <td>${c.bounding_box ? (c.bounding_box.width_nm / 1000).toFixed(2) : "—"}</td>
              <td>${c.bounding_box ? (c.bounding_box.height_nm / 1000).toFixed(2) : "—"}</td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>`;
}

// ── Layers ─────────────────────────────────────────────────────────
function renderLayers(d) {
  const layers = [...d.layers].sort((a, b) => a.layer - b.layer);
  return `
    <div class="panel-section">
      <h2 class="panel-title">Layer Summary</h2>
      <table class="data-table">
        <thead><tr><th>Layer</th><th></th><th>Polygons</th><th>Area (µm²)</th><th>Density</th><th>Min CD (nm)</th><th>Max CD (nm)</th></tr></thead>
        <tbody>
          ${layers
            .map(
              (l) => `
            <tr>
              <td><span class="layer-number">${l.layer}</span></td>
              <td><span class="layer-swatch" style="background:${l.color}"></span></td>
              <td>${l.polygon_count.toLocaleString()}</td>
              <td>${l.total_area_um2.toFixed(3)}</td>
              <td>
                <div class="density-bar-small">
                  <div class="density-fill" style="width:${Math.min(l.density_percent, 100)}%;background:${l.color};height:6px;border-radius:3px;flex:1;max-width:70px;opacity:.8"></div>
                  <span>${l.density_percent.toFixed(1)}%</span>
                </div>
              </td>
              <td class="${l.min_cd_nm < 100 ? "value-error" : l.min_cd_nm < 200 ? "value-warning" : "value-good"}">${l.min_cd_nm.toFixed(0)}</td>
              <td>${l.max_cd_nm.toFixed(0)}</td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>`;
}

// ── Density ────────────────────────────────────────────────────────
function renderDensity(d) {
  const layers = [...d.layers].sort((a, b) => b.density_percent - a.density_percent);
  const max = Math.max(...layers.map((l) => l.density_percent), 1);
  return `
    <div class="panel-section">
      <h2 class="panel-title">Pattern Density Analysis</h2>
      <p class="panel-subtitle">Relative to top-cell bounding box. EBL proximity effect correction is typically required above 30%.</p>
      <div class="density-chart">
        ${layers
          .map(
            (l) => `
          <div class="density-row">
            <div class="density-label">Layer ${l.layer}</div>
            <div class="density-bar-container">
              <div class="density-bar-fill" style="width:${(l.density_percent / max) * 100}%;background:${l.color}"></div>
            </div>
            <div class="density-value ${l.density_percent > 50 ? "value-warning" : ""}">${l.density_percent.toFixed(1)}%</div>
          </div>`
          )
          .join("")}
      </div>
    </div>`;
}

// ── Feature Sizes ──────────────────────────────────────────────────
function renderFeatures(d) {
  const layers = [...d.layers].sort((a, b) => a.min_cd_nm - b.min_cd_nm);
  return `
    <div class="panel-section">
      <h2 class="panel-title">Critical Dimension Analysis</h2>
      <p class="panel-subtitle">Min CD estimated from polygon bounding-box minimum dimension. EBPG5200Z physical limit: ~20 nm. Typical EBL design rule: &gt;100 nm min CD.</p>
      <table class="data-table">
        <thead><tr><th>Layer</th><th>Min CD (nm)</th><th>Max CD (nm)</th><th>Min Edge (nm)</th><th>Area (µm²)</th><th>Polygons</th></tr></thead>
        <tbody>
          ${layers
            .map((l) => {
              const cls = l.min_cd_nm < 100 ? "row-error" : l.min_cd_nm < 200 ? "row-warning" : "";
              const valCls = l.min_cd_nm < 100 ? "value-error" : l.min_cd_nm < 200 ? "value-warning" : "value-good";
              return `
              <tr class="${cls}">
                <td><span class="layer-swatch" style="background:${l.color}"></span>Layer ${l.layer}</td>
                <td class="${valCls}">${l.min_cd_nm.toFixed(0)}</td>
                <td>${l.max_cd_nm.toFixed(0)}</td>
                <td>${l.min_edge_nm.toFixed(0)}</td>
                <td>${l.total_area_um2.toFixed(3)}</td>
                <td>${l.polygon_count.toLocaleString()}</td>
              </tr>`;
            })
            .join("")}
        </tbody>
      </table>
      <div class="legend">
        <span class="legend-item"><span class="legend-dot error"></span>&lt;100 nm — critical</span>
        <span class="legend-item"><span class="legend-dot warning"></span>100–200 nm — caution</span>
        <span class="legend-item"><span class="legend-dot good"></span>&gt;200 nm — ok</span>
      </div>
    </div>`;
}

// ── DRC ───────────────────────────────────────────────────────────
function renderDRC(d) {
  const drc = d.drc;
  const errors = drc.violations.filter((v) => v.severity === "error").length;
  const warnings = drc.violations.filter((v) => v.severity === "warning").length;
  return `
    <div class="panel-section">
      <h2 class="panel-title">Design Rule Check</h2>
      <div class="drc-summary">
        <div class="drc-stat ${drc.passed ? "drc-pass" : "drc-fail"}">
          <span class="drc-status-icon">${drc.passed ? "✓" : "✗"}</span>
          ${drc.passed ? "All rules passed" : "Violations found"}
        </div>
        <div class="drc-stat-row">
          <span class="stat-badge error">${errors} errors</span>
          <span class="stat-badge warning">${warnings} warnings</span>
          <span class="stat-badge info">${drc.stats.total_polygons_checked.toLocaleString()} polygons checked</span>
        </div>
      </div>
      <p class="drc-thresholds">Thresholds: min_width=${drc.thresholds.min_width_nm} nm  |  min_area=${drc.thresholds.min_area_um2} µm²</p>
      ${
        drc.violations.length > 0
          ? `<table class="data-table">
          <thead><tr><th>Rule</th><th>Severity</th><th>Layer</th><th>Cell</th><th>Value</th><th>Threshold</th></tr></thead>
          <tbody>
            ${drc.violations
              .map(
                (v) => `
              <tr>
                <td><code>${v.rule}</code></td>
                <td><span class="badge ${v.severity}">${v.severity.toUpperCase()}</span></td>
                <td>${v.layer}</td>
                <td>${v.cell}</td>
                <td class="${v.severity === "error" ? "value-error" : "value-warning"}">
                  ${v.value_nm !== undefined ? v.value_nm + " nm" : v.value_um2 + " µm²"}
                </td>
                <td>${v.threshold_nm !== undefined ? v.threshold_nm + " nm" : v.threshold_um2 + " µm²"}</td>
              </tr>`
              )
              .join("")}
          </tbody>
        </table>
        ${drc.violations.length === 200 ? '<p class="truncation-note">Showing first 200 violations.</p>' : ""}`
          : '<p class="no-violations">No DRC violations detected.</p>'
      }
    </div>`;
}

// ── Preview ───────────────────────────────────────────────────────
function renderPreview(container) {
  const p = analysisData.preview;
  container.innerHTML = `
    <div class="panel-section preview-section">
      <h2 class="panel-title">Layout Preview — ${p.cell}</h2>
      <p class="panel-subtitle">Showing ${p.shown_polygon_count.toLocaleString()} of ${p.total_polygon_count.toLocaleString()} polygons (flattened top cell)</p>
      <canvas id="preview-canvas"></canvas>
    </div>`;

  const canvas = document.getElementById("preview-canvas");
  const section = container.querySelector(".preview-section");
  canvas.width = section.clientWidth - 48;
  canvas.height = Math.min(Math.round(canvas.width * 0.7), 600);
  drawGDS(canvas, p);
}

function drawGDS(canvas, preview) {
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;
  ctx.fillStyle = "#080810";
  ctx.fillRect(0, 0, W, H);

  if (!preview.polygons || !preview.polygons.length || !preview.bounds) {
    ctx.fillStyle = "#555";
    ctx.font = "14px monospace";
    ctx.textAlign = "center";
    ctx.fillText("No geometry", W / 2, H / 2);
    return;
  }

  const b = preview.bounds;
  const PAD = 32;
  const designW = b.x_max - b.x_min || 1;
  const designH = b.y_max - b.y_min || 1;
  const scale = Math.min((W - PAD * 2) / designW, (H - PAD * 2) / designH);
  const drawW = designW * scale;
  const drawH = designH * scale;
  const ox = PAD + (W - PAD * 2 - drawW) / 2;
  const oy = PAD + (H - PAD * 2 - drawH) / 2;

  function tx(x, y) {
    return [ox + (x - b.x_min) * scale, H - oy - (y - b.y_min) * scale];
  }

  ctx.strokeStyle = "#1e1e3a";
  ctx.lineWidth = 1;
  ctx.strokeRect(ox, oy, drawW, drawH);

  for (const poly of preview.polygons) {
    const color = layerColor(poly.layer);
    ctx.beginPath();
    const [sx, sy] = tx(poly.points[0][0], poly.points[0][1]);
    ctx.moveTo(sx, sy);
    for (let i = 1; i < poly.points.length; i++) {
      const [px, py] = tx(poly.points[i][0], poly.points[i][1]);
      ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = color + "99";
    ctx.strokeStyle = color;
    ctx.lineWidth = 0.6;
    ctx.fill();
    ctx.stroke();
  }

  drawScaleBar(ctx, W, H, scale, PAD);
}

function drawScaleBar(ctx, W, H, scale, pad) {
  const niceNm = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000].reduce(
    (prev, curr) => (Math.abs(curr - 80 / scale) < Math.abs(prev - 80 / scale) ? curr : prev)
  );
  const barPx = niceNm * scale;
  const x = W - pad - barPx;
  const y = H - pad;
  const label = niceNm >= 1000 ? `${niceNm / 1000} µm` : `${niceNm} nm`;

  ctx.strokeStyle = "#666";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + barPx, y);
  ctx.moveTo(x, y - 4);
  ctx.lineTo(x, y + 4);
  ctx.moveTo(x + barPx, y - 4);
  ctx.lineTo(x + barPx, y + 4);
  ctx.stroke();

  ctx.fillStyle = "#888";
  ctx.font = "10px monospace";
  ctx.textAlign = "center";
  ctx.fillText(label, x + barPx / 2, y - 7);
}
