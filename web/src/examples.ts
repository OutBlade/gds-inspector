import { rect, writeGds } from "./gds/writer";
import type { WriterCell } from "./gds/writer";

function circle(cx: number, cy: number, r: number, n = 32): number[] {
  const pts: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  return pts;
}

function cross(size: number, arm: number): number[] {
  const s = size / 2;
  const a = arm / 2;
  return [-a, -s, a, -s, a, -a, s, -a, s, a, a, a, a, s, -a, s, -a, a, -s, a, -s, -a, -a, -a];
}

/**
 * A small electron beam lithography test field: alignment marks, line and
 * space gratings from 30 nm to 1 µm, dot arrays, a Hall bar and bond pads.
 * Some gratings are deliberately below the default 100 nm width check.
 */
export function eblDemo(): ArrayBuffer {
  const cells: WriterCell[] = [];
  const widths = [0.03, 0.05, 0.08, 0.1, 0.15, 0.2, 0.3, 0.5, 1];

  for (const w of widths) {
    const nm = Math.round(w * 1000);
    const lines = [];
    for (let i = 0; i < 10; i++) lines.push({ layer: 1, points: rect(i * w * 2, 0, i * w * 2 + w, 8) });
    cells.push({ name: `GRATING_${nm}NM`, polygons: lines, texts: [{ layer: 10, x: 0, y: 9, text: `${nm} nm` }] });
  }

  cells.push({ name: "DOT_80NM", polygons: [{ layer: 1, points: circle(0, 0, 0.04, 24) }] });
  cells.push({ name: "DOT_150NM", polygons: [{ layer: 1, points: circle(0, 0, 0.075, 32) }] });
  cells.push({ name: "MARK_CROSS", polygons: [{ layer: 2, points: cross(20, 2) }, { layer: 2, points: rect(-6, -6, -3, -3) }] });

  cells.push({
    name: "DOSE_MATRIX",
    refs: widths.map((w, i) => ({
      cell: `GRATING_${Math.round(w * 1000)}NM`,
      x: 0,
      y: i * 14,
      cols: 6,
      rows: 1,
      colPitch: [Math.max(w * 20 + 4, 8), 0] as [number, number],
    })),
    texts: widths.map((_, i) => ({ layer: 10, x: -8, y: i * 14 + 4, text: `row ${i + 1}` })),
  });

  cells.push({
    name: "HALL_BAR",
    paths: [
      { layer: 3, width: 2, pathtype: 2, points: [-30, 0, 30, 0] },
      { layer: 3, width: 1, pathtype: 0, points: [-15, 0, -15, 12, -25, 22] },
      { layer: 3, width: 1, pathtype: 0, points: [15, 0, 15, 12, 25, 22] },
      { layer: 3, width: 1, pathtype: 0, points: [-15, 0, -15, -12, -25, -22] },
      { layer: 3, width: 1, pathtype: 0, points: [15, 0, 15, -12, 25, -22] },
      { layer: 3, width: 1, pathtype: 1, points: [0, 0, 0, -20] },
    ],
    polygons: [
      { layer: 4, points: rect(-40, -6, -30, 6) },
      { layer: 4, points: rect(30, -6, 40, 6) },
      { layer: 4, points: rect(-31, 20, -21, 28) },
      { layer: 4, points: rect(21, 20, 31, 28) },
      { layer: 4, points: rect(-31, -28, -21, -20) },
      { layer: 4, points: rect(21, -28, 31, -20) },
      { layer: 4, points: rect(-5, -30, 5, -20) },
    ],
    texts: [
      { layer: 10, x: -45, y: 0, text: "I+" },
      { layer: 10, x: 45, y: 0, text: "I-" },
      { layer: 10, x: -28, y: 30, text: "V1" },
      { layer: 10, x: 28, y: 30, text: "V2" },
    ],
  });

  cells.push({ name: "BOND_PAD", polygons: [{ layer: 4, points: rect(-50, -50, 50, 50) }, { layer: 5, points: rect(-45, -45, 45, 45) }] });

  cells.push({
    name: "EBL_TESTFIELD",
    polygons: [
      { layer: 6, points: rect(-250, -250, 250, -248) },
      { layer: 6, points: rect(-250, 248, 250, 250) },
      { layer: 6, points: rect(-250, -248, -248, 248) },
      { layer: 6, points: rect(248, -248, 250, 248) },
    ],
    refs: [
      { cell: "MARK_CROSS", x: -220, y: -220 },
      { cell: "MARK_CROSS", x: 220, y: -220 },
      { cell: "MARK_CROSS", x: -220, y: 220 },
      { cell: "MARK_CROSS", x: 220, y: 220 },
      { cell: "DOSE_MATRIX", x: -190, y: 40 },
      { cell: "DOSE_MATRIX", x: 40, y: 40, angle: 90, mag: 1 },
      { cell: "DOT_80NM", x: -190, y: -190, cols: 120, rows: 120, colPitch: [0.25, 0], rowPitch: [0, 0.25] },
      { cell: "DOT_150NM", x: -140, y: -190, cols: 100, rows: 100, colPitch: [0.4, 0], rowPitch: [0, 0.4] },
      { cell: "HALL_BAR", x: 120, y: -120 },
      { cell: "HALL_BAR", x: 120, y: -40, reflect: true },
      { cell: "BOND_PAD", x: -120, y: -40, cols: 2, rows: 1, colPitch: [140, 0] },
    ],
    texts: [{ layer: 10, x: -240, y: 238, text: "EBL TEST FIELD" }],
  });

  return writeGds({ name: "EBL_DEMO", cells });
}

export interface Example {
  id: string;
  title: string;
  detail: string;
  url?: string;
  make?: () => ArrayBuffer;
  file: string;
}

export const EXAMPLES: Example[] = [
  {
    id: "tt",
    title: "Tiny Tapeout tile",
    detail: "tt_um_7seg_animated, SKY130, 1.4 MB",
    url: "https://raw.githubusercontent.com/TinyTapeout/tinytapeout-06/main/projects/tt_um_7seg_animated/tt_um_7seg_animated.gds",
    file: "tt_um_7seg_animated.gds",
  },
  {
    id: "ihp",
    title: "IHP SG13G2 cell library",
    detail: "Open-source 130 nm BiCMOS standard cells, 0.6 MB",
    url: "https://raw.githubusercontent.com/IHP-GmbH/IHP-Open-PDK/main/ihp-sg13g2/libs.ref/sg13g2_stdcell/gds/sg13g2_stdcell.gds",
    file: "sg13g2_stdcell.gds",
  },
  {
    id: "dff",
    title: "SKY130 flip-flop",
    detail: "sky130_fd_sc_hd__dfxtp_1, one cell, try it in 3D",
    url: "https://raw.githubusercontent.com/google/skywater-pdk-libs-sky130_fd_sc_hd/main/cells/dfxtp/sky130_fd_sc_hd__dfxtp_1.gds",
    file: "sky130_fd_sc_hd__dfxtp_1.gds",
  },
  {
    id: "ebl",
    title: "EBL test field",
    detail: "Gratings from 30 nm, dot arrays, Hall bar; generated here",
    make: eblDemo,
    file: "ebl_testfield.gds",
  },
];
