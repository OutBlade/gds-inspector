import { useState, useEffect, useRef } from "preact/hooks";
import { app } from "../controller";
import * as S from "../state";
import { embedded } from "../host";
import { exportLayerCsv, exportPng, exportReport, exportSvg } from "../export";
import {
  IconCube,
  IconDownload,
  IconEyeOff,
  IconFit,
  IconGrid,
  IconHelp,
  IconLogo,
  IconMoon,
  IconOpen,
  IconPanel,
  IconPanelRight,
  IconPointer,
  IconRuler,
  IconSection,
  IconSquare,
  IconSun,
  IconTag,
  IconFill,
} from "./icons";

export function TopBar() {
  const loaded = S.loaded.value;
  const sum = S.summary.value;
  const info = S.sceneInfo.value;
  const is3d = S.mode.value === "3d";
  const tool = S.tool.value;
  const input = useRef<HTMLInputElement>(null);
  const lypInput = useRef<HTMLInputElement>(null);

  return (
    <header class="topbar">
      <div class="brand">
        <IconLogo />
        <span class="brand-name">GDS Inspector</span>
      </div>
      <input
        id="file-input"
        ref={input}
        type="file"
        accept=".gds,.gds2,.gdsii,.gdsx,.gz,.GDS"
        hidden
        onChange={(e) => {
          const f = (e.currentTarget as HTMLInputElement).files?.[0];
          if (f) app.openFile(f);
          (e.currentTarget as HTMLInputElement).value = "";
        }}
      />
      <input
        id="lyp-input"
        ref={lypInput}
        type="file"
        accept=".lyp,.xml"
        hidden
        onChange={(e) => {
          const f = (e.currentTarget as HTMLInputElement).files?.[0];
          if (f) f.text().then((t) => app.applyLyp(t));
          (e.currentTarget as HTMLInputElement).value = "";
        }}
      />
      {!embedded && (
        <button class="btn primary" onClick={() => input.current?.click()} title="Open a GDSII file (Ctrl+O)">
          <IconOpen />
          <span class="hide-sm">Open</span>
        </button>
      )}

      {loaded && sum && info && (
        <>
          <div class="file-chip" title={`${sum.fileName}, ${info.topName}`}>
            <span class="file-name">{sum.fileName}</span>
            <span class="file-cell">{info.topName}</span>
          </div>

          <div class="tb-group">
            <button class="icon-btn" aria-label="Layer panel" title="Layer and cell panel ([)" aria-pressed={S.leftOpen.value} onClick={() => (S.leftOpen.value = !S.leftOpen.value)}>
              <IconPanel />
            </button>
          </div>

          <div class="segmented" role="group" aria-label="View">
            <button aria-pressed={!is3d} onClick={() => app.setMode("2d")} title="2D layout view (T)">
              <IconSquare />
              <span>2D</span>
            </button>
            <button aria-pressed={is3d} onClick={() => app.setMode("3d")} title="3D stack view (T)">
              <IconCube />
              <span>3D</span>
            </button>
          </div>

          <div class="segmented" role="group" aria-label="Tool">
            <button aria-pressed={tool === "select"} onClick={() => (S.tool.value = "select")} title="Select and pan (S)">
              <IconPointer />
            </button>
            <button aria-pressed={tool === "ruler"} disabled={is3d} onClick={() => (S.tool.value = "ruler")} title="Ruler (R)">
              <IconRuler />
            </button>
            <button aria-pressed={tool === "section"} disabled={is3d} onClick={() => (S.tool.value = "section")} title="Cross-section (X)">
              <IconSection />
            </button>
          </div>

          <div class="tb-group hide-md">
            <button class="icon-btn" onClick={() => app.fitAll()} title="Fit to window (F)" aria-label="Fit to window">
              <IconFit />
            </button>
            <button
              class="icon-btn"
              aria-pressed={S.hideFillers.value}
              onClick={() => (S.hideFillers.value = !S.hideFillers.value)}
              title="Hide fill, decap and tap cells (1)"
              aria-label="Hide filler cells"
            >
              <IconFill />
            </button>
            <button
              class="icon-btn"
              aria-pressed={S.hideTop.value}
              onClick={() => (S.hideTop.value = !S.hideTop.value)}
              title="Hide top cell geometry (2)"
              aria-label="Hide top cell geometry"
            >
              <IconEyeOff />
            </button>
            <button class="icon-btn" aria-pressed={S.showLabels.value} onClick={() => (S.showLabels.value = !S.showLabels.value)} title="Labels (L)" aria-label="Labels">
              <IconTag />
            </button>
            <button class="icon-btn" aria-pressed={S.showGrid.value} onClick={() => (S.showGrid.value = !S.showGrid.value)} title="Grid (G)" aria-label="Grid">
              <IconGrid />
            </button>
          </div>
        </>
      )}

      <div class="spacer" />

      {loaded && <ExportMenu onLyp={() => lypInput.current?.click()} />}
      {!embedded && <button
        class="icon-btn hide-xs"
        onClick={() => {
          S.theme.value = S.theme.value === "dark" ? "light" : "dark";
          try {
            localStorage.setItem("gds-theme", S.theme.value);
          } catch {
            /* storage unavailable */
          }
        }}
        title="Toggle light and dark"
        aria-label="Toggle theme"
      >
        {S.theme.value === "dark" ? <IconSun /> : <IconMoon />}
      </button>}
      <button class="icon-btn hide-xs" onClick={() => (S.helpOpen.value = true)} title="Keyboard shortcuts (?)" aria-label="Help">
        <IconHelp />
      </button>
      {loaded && (
        <button class="icon-btn" aria-label="Inspector panel" title="Inspector panel (])" aria-pressed={S.rightOpen.value} onClick={() => (S.rightOpen.value = !S.rightOpen.value)}>
          <IconPanelRight />
        </button>
      )}
    </header>
  );
}

function ExportMenu({ onLyp }: { onLyp: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);
  const item = (label: string, hint: string, fn: () => void, disabled = false) => (
    <button
      role="menuitem"
      disabled={disabled}
      onClick={() => {
        setOpen(false);
        fn();
      }}
    >
      <span>{label}</span>
      <small>{hint}</small>
    </button>
  );
  const hasReport = !!S.report.value;
  return (
    <div class="menu-wrap" ref={ref}>
      <button class="btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <IconDownload />
        <span class="hide-sm">Export</span>
      </button>
      {open && (
        <div class="menu" role="menu">
          {item("Image", "PNG of the view, 3x resolution", () => exportPng(3))}
          {item("Vector", "SVG of the visible area", () => exportSvg(), S.mode.value === "3d")}
          {item("Report", "JSON, same format as the desktop app", exportReport, !hasReport)}
          {item("Layer table", "CSV with areas and widths", exportLayerCsv, !hasReport)}
          <div class="menu-sep" />
          {item("Import layer colors", "KLayout .lyp file", onLyp)}
        </div>
      )}
    </div>
  );
}
