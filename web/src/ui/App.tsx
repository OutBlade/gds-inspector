import { useEffect, useRef } from "preact/hooks";
import { app } from "../controller";
import { attachInteraction } from "../interaction";
import * as S from "../state";
import { TopBar } from "./TopBar";
import { LeftPanel } from "./LeftPanel";
import { RightPanel } from "./RightPanel";
import { StatusBar } from "./StatusBar";
import { Landing } from "./Landing";
import { SectionPanel } from "./SectionPanel";
import { Help } from "./Help";
import { IconClose } from "./icons";
import { embedded } from "../host";

export function App() {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    app.mount(host.current!);
    if (app.hasGl) attachInteraction(host.current!);
  }, []);

  const loaded = S.loaded.value;
  const tool = S.tool.value;
  const busy = S.busy.value;

  return (
    <div
      class="app"
      data-left={S.leftOpen.value && loaded ? "open" : "closed"}
      data-right={S.rightOpen.value && loaded ? "open" : "closed"}
      onDragOver={(e) => {
        e.preventDefault();
        document.body.classList.add("dragging");
      }}
      onDragLeave={(e) => {
        if (e.relatedTarget === null) document.body.classList.remove("dragging");
      }}
      onDrop={(e) => {
        e.preventDefault();
        document.body.classList.remove("dragging");
        const f = e.dataTransfer?.files?.[0];
        if (!f) return;
        if (/\.lyp$/i.test(f.name) && S.loaded.value) f.text().then((t) => app.applyLyp(t));
        else if (!embedded) app.openFile(f);
      }}
    >
      <TopBar />
      {loaded && <LeftPanel />}
      <main class="stage">
        <div class="viewport" ref={host} data-tool={loaded ? (S.mode.value === "3d" ? "orbit" : tool) : "none"} />
        {!loaded && !busy && !embedded && <Landing />}
        {busy && (
          <div class="busy" role="status">
            <div class="busy-card">
              <div class="busy-stage">{busy.stage}</div>
              <div class="bar">
                <div style={{ width: `${Math.round(busy.fraction * 100)}%` }} />
              </div>
            </div>
          </div>
        )}
        {S.error.value && (
          <div class="toast error" role="alert">
            <span>{S.error.value}</span>
            <button class="icon-btn" aria-label="Dismiss" onClick={() => (S.error.value = null)}>
              <IconClose />
            </button>
          </div>
        )}
        {!S.error.value && S.notice.value && (
          <div class="toast" role="status">
            <span>{S.notice.value}</span>
            <button class="icon-btn" aria-label="Dismiss" onClick={() => (S.notice.value = null)}>
              <IconClose />
            </button>
          </div>
        )}
        {loaded && tool !== "select" && S.mode.value === "2d" && (
          <div class="tool-hint">
            {tool === "ruler"
              ? "Click two points to measure. Snaps to vertices and edges, Shift keeps it straight."
              : "Click two points to cut a cross-section through the visible layers."}
          </div>
        )}
        {S.sectionResult.value && <SectionPanel />}
      </main>
      {loaded && <RightPanel />}
      <StatusBar />
      <div class="drop-veil">Drop to open</div>
      {S.helpOpen.value && <Help />}
    </div>
  );
}
