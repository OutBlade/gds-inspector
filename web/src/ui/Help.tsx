import * as S from "../state";
import { IconClose } from "./icons";

const KEYS: [string, string][] = [
  ["1", "Hide fill, decap and tap cells"],
  ["2", "Hide top cell geometry"],
  ["3", "Highlight all placements of the selected shape's cell"],
  ["4 or Z", "Zoom to selection"],
  ["F", "Fit layout to window"],
  ["T", "Switch between 2D and 3D"],
  ["S / R / X", "Select, ruler, cross-section"],
  ["L / G / D", "Labels, grid, density overlay"],
  ["+ / -", "Zoom in and out"],
  ["[ / ]", "Toggle left and right panels"],
  ["Esc", "Cancel tool, clear selection"],
  ["Ctrl+O", "Open file"],
  ["?", "This help"],
];

const MOUSE: [string, string][] = [
  ["Wheel, pinch", "Zoom at the cursor"],
  ["Drag, right drag, Space+drag", "Pan (2D)"],
  ["Drag / Shift+drag", "Orbit / pan (3D)"],
  ["Click", "Select shape, click again to step through the stack"],
  ["Double-click", "Zoom in"],
  ["Alt+click layer", "Show only that layer"],
];

export function Help() {
  return (
    <div class="modal-veil" onClick={() => (S.helpOpen.value = false)}>
      <div class="modal" role="dialog" aria-modal="true" aria-label="Keyboard and mouse" onClick={(e) => e.stopPropagation()}>
        <header>
          <h3>Keyboard and mouse</h3>
          <button class="icon-btn" aria-label="Close" onClick={() => (S.helpOpen.value = false)}>
            <IconClose />
          </button>
        </header>
        <div class="help-grid">
          <dl>
            {KEYS.map(([k, v]) => (
              <>
                <dt>
                  <kbd>{k}</kbd>
                </dt>
                <dd>{v}</dd>
              </>
            ))}
          </dl>
          <dl>
            {MOUSE.map(([k, v]) => (
              <>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </>
            ))}
          </dl>
        </div>
        <p class="hint">
          Drop a KLayout .lyp file on the window to apply its layer names and colors. Links of the form <code>?url=https://.../design.gds</code> open a
          remote file directly, and the view position is kept in the address.
        </p>
      </div>
    </div>
  );
}
