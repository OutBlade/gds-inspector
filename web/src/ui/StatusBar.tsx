import * as S from "../state";
import { formatCount, formatLength } from "../format";

export function StatusBar() {
  const c = S.cursor.value;
  const z = S.zoomInfo.value;
  const loaded = S.loaded.value;
  const hv = S.hover.value;
  const l = hv ? S.layerByKey.value.get(hv.key) : null;
  return (
    <footer class="statusbar">
      {loaded ? (
        <>
          <span class="coord" aria-label="Cursor position">
            {c ? `x ${c[0].toFixed(3)}  y ${c[1].toFixed(3)} µm` : "x -  y -"}
          </span>
          <span class="sep hide-sm">1 px = {formatLength(1 / z.pxPerUm)}</span>
          {hv && (
            <span class="hover-info hide-sm">
              <i style={{ background: l?.color }} />
              {l?.name} in {hv.cell}
            </span>
          )}
          <span class="spacer" />
          <span class="hide-sm">
            {formatCount(z.drawn)} draws, {formatCount(z.instances)} placements
          </span>
          <span class="mode">{S.mode.value.toUpperCase()}</span>
        </>
      ) : (
        <span>Ready. Open a GDSII file to begin.</span>
      )}
    </footer>
  );
}
