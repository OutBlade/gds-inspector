import { useMemo, useState, useEffect } from "preact/hooks";
import { app } from "../controller";
import * as S from "../state";
import type { LayerView } from "../state";
import { ALL_PDKS } from "../pdk/pdk";
import { keyLabel } from "../gds/types";
import { formatCount, formatLength } from "../format";
import type { Label } from "../worker/protocol";
import { GALLERY } from "../worker/protocol";
import { IconChevron, IconEnter, IconEye, IconEyeOff, IconHighlight, IconLayers, IconSearch, IconTarget, IconTree } from "./icons";

export function LeftPanel() {
  const tab = S.leftTab.value;
  return (
    <aside class="panel left" aria-label="Layers and cells">
      <nav class="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "layers"} onClick={() => (S.leftTab.value = "layers")}>
          <IconLayers />
          Layers
        </button>
        <button role="tab" aria-selected={tab === "cells"} onClick={() => (S.leftTab.value = "cells")}>
          <IconTree />
          Cells
        </button>
        <button role="tab" aria-selected={tab === "search"} onClick={() => (S.leftTab.value = "search")}>
          <IconSearch />
          Find
        </button>
      </nav>
      <div class="panel-body">
        {tab === "layers" && <LayersTab />}
        {tab === "cells" && <CellsTab />}
        {tab === "search" && <SearchTab />}
      </div>
    </aside>
  );
}

function LayersTab() {
  const is3d = S.mode.value === "3d";
  const list = S.layers.value;
  const [filter, setFilter] = useState("");
  const shown = filter ? list.filter((l) => `${l.name} ${keyLabel(l.key)}`.toLowerCase().includes(filter.toLowerCase())) : list;
  // Topmost layer first, like a paint stack.
  const ordered = [...shown].reverse();
  return (
    <div class="layers-tab">
      <div class="row gap">
        <label class="field grow">
          <span>Process</span>
          <select value={S.pdkId.value} onChange={(e) => app.setPdk((e.currentTarget as HTMLSelectElement).value)}>
            {ALL_PDKS.map((p) => (
              <option value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
      </div>
      <div class="row gap">
        <input class="grow" type="search" placeholder="Filter layers" value={filter} onInput={(e) => setFilter((e.currentTarget as HTMLInputElement).value)} />
        <button class="btn small" onClick={() => app.setAllLayers(true)}>
          All
        </button>
        <button class="btn small" onClick={() => app.setAllLayers(false)}>
          None
        </button>
      </div>
      <p class="hint">
        {is3d ? "Visibility in the 3D stack." : "Alt-click or double-click a name to show only that layer."}
      </p>
      <ul class="layer-list">
        {ordered.map((l) => (
          <LayerRow key={l.key} l={l} is3d={is3d} />
        ))}
      </ul>
      {is3d && <Stack3DControls />}
    </div>
  );
}

function LayerRow({ l, is3d }: { l: LayerView; is3d: boolean }) {
  const on = is3d ? l.visible3d : l.visible;
  return (
    <li class={`layer-row${on ? "" : " off"}`}>
      <button class="icon-btn tiny" aria-label={on ? `Hide ${l.name}` : `Show ${l.name}`} onClick={() => app.toggleLayer(l.key)}>
        {on ? <IconEye size={14} /> : <IconEyeOff size={14} />}
      </button>
      <label class="swatch" style={{ "--c": l.color } as never} data-pattern={l.pattern} title="Change color">
        <input type="color" value={l.color} onInput={(e) => app.updateLayer(l.key, { color: (e.currentTarget as HTMLInputElement).value })} />
      </label>
      <button
        class="layer-name"
        title={`${l.name} (${keyLabel(l.key)})`}
        onClick={(e) => (e.altKey ? app.soloLayer(l.key) : app.toggleLayer(l.key))}
        onDblClick={() => app.soloLayer(l.key)}
      >
        <span class="nm">{l.name}</span>
        <span class="ld">{keyLabel(l.key)}</span>
      </button>
      <span class="count" title={`${l.shapes} shapes in cell definitions`}>
        {l.shapes ? formatCount(l.shapes) : "text"}
      </span>
      <span class="order">
        <button class="icon-btn tiny" aria-label="Move up" onClick={() => app.moveLayer(l.key, 1)}>
          <span class="caret up" />
        </button>
        <button class="icon-btn tiny" aria-label="Move down" onClick={() => app.moveLayer(l.key, -1)}>
          <span class="caret" />
        </button>
      </span>
    </li>
  );
}

function Stack3DControls() {
  const s = S.s3d.value;
  const set = (p: Partial<typeof s>) => (S.s3d.value = { ...s, ...p });
  return (
    <div class="card">
      <h4>3D stack</h4>
      <label class="slider">
        <span>Height</span>
        <input type="range" min="0.2" max="12" step="0.1" value={s.exaggeration} onInput={(e) => set({ exaggeration: Number((e.currentTarget as HTMLInputElement).value) })} />
        <output>{s.exaggeration.toFixed(1)}x</output>
      </label>
      <label class="slider">
        <span>Explode</span>
        <input type="range" min="0" max="6" step="0.05" value={s.explode} onInput={(e) => set({ explode: Number((e.currentTarget as HTMLInputElement).value) })} />
        <output>{s.explode.toFixed(2)} µm</output>
      </label>
      <label class="check">
        <input type="checkbox" checked={s.clip} onChange={(e) => set({ clip: (e.currentTarget as HTMLInputElement).checked })} />
        <span>Section cut</span>
        <select value={s.clipAxis} disabled={!s.clip} onChange={(e) => set({ clipAxis: (e.currentTarget as HTMLSelectElement).value as "x" | "y" })}>
          <option value="y">along X</option>
          <option value="x">along Y</option>
        </select>
      </label>
      {s.clip && (
        <label class="slider">
          <span>Position</span>
          <input type="range" min="0" max="1" step="0.001" value={s.clipAt} onInput={(e) => set({ clipAt: Number((e.currentTarget as HTMLInputElement).value) })} />
          <output>{Math.round(s.clipAt * 100)} %</output>
        </label>
      )}
    </div>
  );
}

function CellsTab() {
  const sum = S.summary.value!;
  const info = S.sceneInfo.value!;
  const [filter, setFilter] = useState("");
  const [, force] = useState(0);
  const counts = info.counts;
  const filler = useMemo(() => ALL_PDKS.find((p) => p.id === S.pdkId.value)?.filler, [S.pdkId.value]);

  const matches = useMemo(() => {
    if (!filter) return null;
    const f = filter.toLowerCase();
    return sum.cells.filter((c) => c.name.toLowerCase().includes(f)).slice(0, 400);
  }, [filter, sum]);

  const toggle = (id: number) => {
    app.toggleCell(id);
    force((n) => n + 1);
  };

  return (
    <div class="cells-tab">
      {sum.tops.length > 1 && (
        <label class="field">
          <span>Top cell ({sum.tops.length} in file)</span>
          <select value={info.gallery ? GALLERY : info.top} onChange={(e) => app.openTop(Number((e.currentTarget as HTMLSelectElement).value))}>
            <option value={GALLERY}>All top cells side by side</option>
            {[...sum.tops]
              .sort((a, b) => sum.cells[a].name.localeCompare(sum.cells[b].name, "en", { numeric: true }))
              .map((t) => (
                <option value={t}>{sum.cells[t].name}</option>
              ))}
          </select>
        </label>
      )}
      <input type="search" placeholder={`Search ${sum.cells.length.toLocaleString("en-US")} cells`} value={filter} onInput={(e) => setFilter((e.currentTarget as HTMLInputElement).value)} />
      {matches ? (
        <ul class="tree flat">
          {matches.map((c) => (
            <CellRow id={c.id} depth={0} counts={counts} filler={filler} onToggle={toggle} flat />
          ))}
          {!matches.length && <li class="empty">No cell matches.</li>}
        </ul>
      ) : (
        <ul class="tree">
          {info.gallery ? (
            [...sum.tops]
              .sort((a, b) => sum.cells[a].name.localeCompare(sum.cells[b].name, "en", { numeric: true }))
              .map((t) => <CellNode key={t} id={t} depth={0} counts={counts} filler={filler} onToggle={toggle} />)
          ) : (
            <CellNode id={info.top} depth={0} counts={counts} filler={filler} onToggle={toggle} open />
          )}
        </ul>
      )}
    </div>
  );
}

interface NodeProps {
  id: number;
  depth: number;
  counts: Float64Array;
  filler?: RegExp;
  onToggle: (id: number) => void;
  open?: boolean;
  flat?: boolean;
}

function CellNode(props: NodeProps) {
  const [open, setOpen] = useState(!!props.open);
  const sum = S.summary.value!;
  const c = sum.cells[props.id];
  const kids = useMemo(() => [...c.children].sort((a, b) => sum.cells[a[0]].name.localeCompare(sum.cells[b[0]].name)), [c]);
  return (
    <>
      <CellRow {...props} expandable={kids.length > 0} expanded={open} onExpand={() => setOpen(!open)} />
      {open &&
        kids.slice(0, 2000).map(([child]) => <CellNode key={child} {...props} id={child} depth={props.depth + 1} open={false} />)}
    </>
  );
}

function CellRow({
  id,
  depth,
  counts,
  filler,
  onToggle,
  expandable,
  expanded,
  onExpand,
  flat,
}: NodeProps & { expandable?: boolean; expanded?: boolean; onExpand?: () => void }) {
  const sum = S.summary.value!;
  const info = S.sceneInfo.value!;
  const c = sum.cells[id];
  const placed = counts[id];
  const hidden = app.isCellHidden(id) || (S.hideFillers.value && !!filler?.test(c.name));
  const highlighted = S.highlightCell.value === id;
  const b = c.fullBox;
  const size = b[0] <= b[2] ? `${formatLength(b[2] - b[0])} x ${formatLength(b[3] - b[1])}` : "empty";
  return (
    <li class={`cell-row${hidden ? " off" : ""}${highlighted ? " hl" : ""}`} style={{ "--depth": depth } as never}>
      {!flat && (
        <button class={`icon-btn tiny chev${expanded ? " open" : ""}`} style={{ visibility: expandable ? "visible" : "hidden" }} onClick={onExpand} aria-label="Expand">
          <IconChevron size={12} />
        </button>
      )}
      <button class="cell-name" title={`${c.name}\n${size}\n${c.boundaries + c.boxes} polygons, ${c.paths} paths, ${c.children.length} child cells`} onClick={() => (placed ? app.zoomToCell(id) : undefined)} disabled={!placed}>
        <span class="nm">{c.name}</span>
      </button>
      <span class="count" title="Placements under the current top cell">
        {placed ? `${formatCount(placed)}x` : "unused"}
      </span>
      <span class="acts">
        <button class="icon-btn tiny" aria-label="Highlight placements" title="Highlight placements" aria-pressed={highlighted} disabled={!placed} onClick={() => (S.highlightCell.value = highlighted ? null : id)}>
          <IconHighlight size={13} />
        </button>
        <button class="icon-btn tiny" aria-label="Zoom to cell" title="Zoom to first placement" disabled={!placed} onClick={() => app.zoomToCell(id)}>
          <IconTarget size={13} />
        </button>
        <button class="icon-btn tiny" aria-label={hidden ? "Show cell" : "Hide cell"} title={hidden ? "Show" : "Hide"} onClick={() => onToggle(id)}>
          {hidden ? <IconEyeOff size={13} /> : <IconEye size={13} />}
        </button>
        <button class="icon-btn tiny" aria-label="Open as top cell" title="Open as top cell" disabled={id === info.top && !info.gallery} onClick={() => app.openTop(id)}>
          <IconEnter size={13} />
        </button>
      </span>
    </li>
  );
}

function SearchTab() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Label[]>([]);
  const [busy, setBusy] = useState(false);
  const sum = S.summary.value!;
  const counts = S.sceneInfo.value!.counts;
  const cellHits = useMemo(() => {
    if (!q.trim()) return [];
    const f = q.trim().toLowerCase();
    return sum.cells.filter((c) => counts[c.id] && c.name.toLowerCase().includes(f)).slice(0, 30);
  }, [q, sum, counts]);

  useEffect(() => {
    const t = setTimeout(async () => {
      if (!q.trim()) {
        setResults([]);
        return;
      }
      setBusy(true);
      try {
        setResults(await app.client.call({ type: "searchLabels", q }));
      } finally {
        setBusy(false);
      }
    }, 180);
    return () => clearTimeout(t);
  }, [q]);

  const byKey = S.layerByKey.value;
  return (
    <div class="search-tab">
      <input type="search" autoFocus placeholder="Pin, net label or cell name" value={q} onInput={(e) => setQ((e.currentTarget as HTMLInputElement).value)} />
      {q.trim() && (
        <>
          <h4>
            Labels {busy ? "" : `(${results.length}${results.length >= 300 ? "+" : ""})`}
          </h4>
          <ul class="results">
            {results.map((r) => (
              <li>
                <button
                  onClick={() => {
                    if (S.mode.value === "3d") app.setMode("2d");
                    app.zoomToPoint(r.x, r.y, 6);
                    S.showLabels.value = true;
                  }}
                >
                  <span class="dot" style={{ background: byKey.get(r.key)?.color ?? "var(--muted)" }} />
                  <span class="nm">{r.text}</span>
                  <span class="sub">
                    {byKey.get(r.key)?.name ?? keyLabel(r.key)} in {r.cell}
                    {r.count && r.count > 1 ? ` (${formatCount(r.count)}x)` : ""}
                  </span>
                </button>
              </li>
            ))}
            {!busy && !results.length && <li class="empty">No label matches.</li>}
          </ul>
          <h4>Cells ({cellHits.length})</h4>
          <ul class="results">
            {cellHits.map((c) => (
              <li>
                <button onClick={() => app.zoomToCell(c.id)}>
                  <span class="nm">{c.name}</span>
                  <span class="sub">{formatCount(counts[c.id])} placements</span>
                </button>
              </li>
            ))}
            {!cellHits.length && <li class="empty">No placed cell matches.</li>}
          </ul>
        </>
      )}
      {!q.trim() && <p class="hint">Search text labels (pins, nets, port names) and cell names. Results zoom the view to the match.</p>}
    </div>
  );
}
