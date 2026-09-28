import { EXAMPLES, openExample } from "../demo";
import { IconCube, IconLayers, IconOpen, IconRuler, IconSearch } from "./icons";

export function Landing() {
  return (
    <div class="landing">
      <div class="landing-inner">
        <h1>Inspect GDSII layouts in the browser</h1>
        <p class="lede">
          2D and 3D views of chip and nanofabrication layouts with layer, density, feature size and rule checks. Nothing is uploaded: the file is read
          in this tab.
        </p>
        <button class="drop-target" onClick={() => document.getElementById("file-input")?.click()}>
          <IconOpen size={28} />
          <span class="dt-title">Drop a .gds file here or click to open</span>
          <span class="dt-sub">GDSII stream, also gzip compressed (.gds.gz)</span>
        </button>
        <h2>Examples</h2>
        <div class="examples">
          {EXAMPLES.map((e) => (
            <button class="example" onClick={() => openExample(e)}>
              <b>{e.title}</b>
              <span>{e.detail}</span>
            </button>
          ))}
        </div>
        <ul class="features">
          <li>
            <IconLayers />
            <span>
              <b>Process aware.</b> Recognises SKY130, GF180MCU and IHP SG13G2 layer maps, reads KLayout .lyp files.
            </span>
          </li>
          <li>
            <IconCube />
            <span>
              <b>2D and 3D.</b> Hatched layer view with hierarchy, labels and level of detail; extruded metal stack with section cuts.
            </span>
          </li>
          <li>
            <IconRuler />
            <span>
              <b>Measure and cut.</b> Snapping ruler and cross-section profiles along any line.
            </span>
          </li>
          <li>
            <IconSearch />
            <span>
              <b>Analyse.</b> Per-layer area, pattern density maps, minimum widths, rule checks, EBL exposure time.
            </span>
          </li>
        </ul>
      </div>
    </div>
  );
}
