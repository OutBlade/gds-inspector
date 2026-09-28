import { layerKey, keyLayer, keyDatatype } from "../gds/types";

/** Fill patterns drawn by the 2D shader. */
export const PATTERN = {
  solid: 0,
  hollow: 1,
  diag: 2,
  back: 3,
  cross: 4,
  dots: 5,
  horiz: 6,
  vert: 7,
  dense: 8,
} as const;
export type Pattern = (typeof PATTERN)[keyof typeof PATTERN];

export interface LayerDef {
  key: number;
  name: string;
  color: string;
  pattern: Pattern;
  /** Bottom of the layer in the 3D stack, µm. */
  z: number;
  /** Thickness in the 3D stack, µm. */
  t: number;
  /** Shown in 2D by default. */
  visible: boolean;
  /** Shown in 3D by default. */
  visible3d: boolean;
}

export interface Pdk {
  id: string;
  name: string;
  /** Layers that identify the process when found in a file. */
  signature: number[];
  filler: RegExp;
  layers: Map<number, LayerDef>;
}

type Row = [layer: number, datatype: number, name: string, color: string, pattern: Pattern, z: number, t: number, flags?: string];

function table(rows: Row[]): Map<number, LayerDef> {
  const m = new Map<number, LayerDef>();
  for (const [layer, dt, name, color, pattern, z, t, flags = ""] of rows) {
    const key = layerKey(layer, dt);
    m.set(key, {
      key,
      name,
      color,
      pattern,
      z,
      t,
      visible: !flags.includes("h"),
      visible3d: !flags.includes("h") && !flags.includes("2"),
    });
  }
  return m;
}

const P = PATTERN;

// Flags: "2" = 2D only (implants, wells, markers), "h" = hidden by default.
const SKY130 = table([
  [64, 20, "nwell", "#5b4ba8", P.dots, -0.3, 0.3, "2"],
  [64, 18, "dnwell", "#3d3380", P.dots, -0.6, 0.3, "2"],
  [64, 44, "pwell", "#7d6a3a", P.dots, -0.3, 0.3, "2h"],
  [65, 20, "diff", "#3fbf6f", P.diag, 0, 0.12],
  [65, 44, "tap", "#2e9d86", P.back, 0, 0.12],
  [66, 20, "poly", "#e5484d", P.back, 0.3262, 0.18],
  [66, 44, "licon1", "#f5d90a", P.cross, 0.12, 0.8161],
  [67, 20, "li1", "#b86bff", P.diag, 0.9361, 0.1],
  [67, 44, "mcon", "#ffb224", P.cross, 1.0361, 0.34],
  [68, 20, "met1", "#3e8eff", P.back, 1.3761, 0.36],
  [68, 44, "via", "#ff8b3e", P.cross, 1.7361, 0.27],
  [69, 20, "met2", "#ff6b9a", P.diag, 2.0061, 0.36],
  [69, 44, "via2", "#f5d90a", P.cross, 2.3661, 0.42],
  [70, 20, "met3", "#2ec4b6", P.back, 2.7861, 0.845],
  [70, 44, "via3", "#ffb224", P.cross, 3.6311, 0.39],
  [71, 20, "met4", "#8da4ff", P.diag, 4.0211, 0.845],
  [71, 44, "via4", "#ff8b3e", P.cross, 4.8661, 0.505],
  [72, 20, "met5", "#d6a35c", P.back, 5.3711, 1.26],
  [76, 20, "pad", "#c9c9c9", P.dense, 6.6311, 0.2],
  [67, 16, "li1.pin", "#b86bff", P.hollow, 0.9361, 0.1, "2"],
  [68, 16, "met1.pin", "#3e8eff", P.hollow, 1.3761, 0.36, "2"],
  [69, 16, "met2.pin", "#ff6b9a", P.hollow, 2.0061, 0.36, "2"],
  [70, 16, "met3.pin", "#2ec4b6", P.hollow, 2.7861, 0.845, "2"],
  [71, 16, "met4.pin", "#8da4ff", P.hollow, 4.0211, 0.845, "2"],
  [72, 16, "met5.pin", "#d6a35c", P.hollow, 5.3711, 1.26, "2"],
  [67, 5, "li1.label", "#b86bff", P.hollow, 0.9361, 0.1, "2"],
  [68, 5, "met1.label", "#3e8eff", P.hollow, 1.3761, 0.36, "2"],
  [69, 5, "met2.label", "#ff6b9a", P.hollow, 2.0061, 0.36, "2"],
  [70, 5, "met3.label", "#2ec4b6", P.hollow, 2.7861, 0.845, "2"],
  [71, 5, "met4.label", "#8da4ff", P.hollow, 4.0211, 0.845, "2"],
  [72, 5, "met5.label", "#d6a35c", P.hollow, 5.3711, 1.26, "2"],
  [83, 44, "text", "#9aa0a6", P.hollow, 0, 0.01, "2"],
  [93, 44, "nsdm", "#6e7d8f", P.horiz, 0, 0.01, "2h"],
  [94, 20, "psdm", "#8f7d6e", P.vert, 0, 0.01, "2h"],
  [95, 20, "npc", "#8f6e8a", P.dots, 0, 0.01, "2h"],
  [75, 20, "hvi", "#6e8f7a", P.dots, 0, 0.01, "2h"],
  [78, 44, "hvtp", "#8a8f6e", P.dots, 0, 0.01, "2h"],
  [125, 44, "lvtn", "#6e8a8f", P.dots, 0, 0.01, "2h"],
  [81, 4, "areaid.sc", "#777777", P.hollow, 0, 0.01, "2h"],
  [235, 4, "prBoundary", "#9aa0a6", P.hollow, 0, 0.01, "2"],
]);

const GF180 = table([
  [21, 0, "Nwell", "#5b4ba8", P.dots, -0.3, 0.3, "2"],
  [12, 0, "DNWELL", "#3d3380", P.dots, -0.6, 0.3, "2"],
  [22, 0, "COMP", "#3fbf6f", P.diag, 0, 0.15],
  [30, 0, "Poly2", "#e5484d", P.back, 0.32, 0.2],
  [32, 0, "Nplus", "#6e7d8f", P.horiz, 0, 0.01, "2h"],
  [31, 0, "Pplus", "#8f7d6e", P.vert, 0, 0.01, "2h"],
  [33, 0, "Contact", "#f5d90a", P.cross, 0.15, 0.8],
  [34, 0, "Metal1", "#3e8eff", P.back, 0.95, 0.55],
  [35, 0, "Via1", "#ff8b3e", P.cross, 1.5, 0.6],
  [36, 0, "Metal2", "#ff6b9a", P.diag, 2.1, 0.55],
  [38, 0, "Via2", "#f5d90a", P.cross, 2.65, 0.6],
  [42, 0, "Metal3", "#2ec4b6", P.back, 3.25, 0.55],
  [40, 0, "Via3", "#ffb224", P.cross, 3.8, 0.6],
  [46, 0, "Metal4", "#8da4ff", P.diag, 4.4, 0.55],
  [41, 0, "Via4", "#ff8b3e", P.cross, 4.95, 0.6],
  [81, 0, "Metal5", "#b86bff", P.back, 5.55, 0.55],
  [82, 0, "Via5", "#f5d90a", P.cross, 6.1, 0.6],
  [53, 0, "MetalTop", "#d6a35c", P.diag, 6.7, 0.9],
  [37, 0, "Pad", "#c9c9c9", P.dense, 7.6, 0.2],
  [0, 0, "PR_bndry", "#9aa0a6", P.hollow, 0, 0.01, "2"],
]);

const SG13G2 = table([
  [31, 0, "NWell", "#5b4ba8", P.dots, -0.3, 0.3, "2"],
  [1, 0, "Activ", "#3fbf6f", P.diag, 0, 0.16],
  [5, 0, "GatPoly", "#e5484d", P.back, 0.24, 0.16],
  [7, 0, "nSD", "#6e7d8f", P.horiz, 0, 0.01, "2h"],
  [14, 0, "pSD", "#8f7d6e", P.vert, 0, 0.01, "2h"],
  [6, 0, "Cont", "#f5d90a", P.cross, 0.16, 0.48],
  [8, 0, "Metal1", "#3e8eff", P.back, 0.64, 0.42],
  [19, 0, "Via1", "#ff8b3e", P.cross, 1.06, 0.54],
  [10, 0, "Metal2", "#ff6b9a", P.diag, 1.6, 0.49],
  [29, 0, "Via2", "#f5d90a", P.cross, 2.09, 0.54],
  [30, 0, "Metal3", "#2ec4b6", P.back, 2.63, 0.49],
  [49, 0, "Via3", "#ffb224", P.cross, 3.12, 0.54],
  [50, 0, "Metal4", "#8da4ff", P.diag, 3.66, 0.49],
  [66, 0, "Via4", "#ff8b3e", P.cross, 4.15, 0.54],
  [67, 0, "Metal5", "#b86bff", P.back, 4.69, 0.49],
  [125, 0, "TopVia1", "#f5d90a", P.cross, 5.18, 0.85],
  [126, 0, "TopMetal1", "#d6a35c", P.diag, 6.03, 2.0],
  [133, 0, "TopVia2", "#ffb224", P.cross, 8.03, 2.8],
  [134, 0, "TopMetal2", "#e0c080", P.back, 10.83, 3.0],
  [9, 0, "Passiv", "#c9c9c9", P.dense, 13.83, 0.2, "2"],
  [8, 2, "Metal1.pin", "#3e8eff", P.hollow, 0.64, 0.42, "2"],
  [10, 2, "Metal2.pin", "#ff6b9a", P.hollow, 1.6, 0.49, "2"],
  [30, 2, "Metal3.pin", "#2ec4b6", P.hollow, 2.63, 0.49, "2"],
  [50, 2, "Metal4.pin", "#8da4ff", P.hollow, 3.66, 0.49, "2"],
  [67, 2, "Metal5.pin", "#b86bff", P.hollow, 4.69, 0.49, "2"],
  [126, 2, "TopMetal1.pin", "#d6a35c", P.hollow, 6.03, 2.0, "2"],
  [134, 2, "TopMetal2.pin", "#e0c080", P.hollow, 10.83, 3.0, "2"],
  [189, 4, "prBoundary", "#9aa0a6", P.hollow, 0, 0.01, "2"],
]);

const k = layerKey;

export const PDKS: Pdk[] = [
  {
    id: "sky130",
    name: "SkyWater SKY130",
    signature: [k(66, 20), k(67, 20), k(68, 20), k(69, 20), k(67, 44), k(68, 44), k(65, 20), k(235, 4)],
    filler: /__(fill|decap|tapvpwrvgnd|tap_|fakediode|lpflow_decapkapwr)/i,
    layers: SKY130,
  },
  {
    id: "gf180mcu",
    name: "GlobalFoundries GF180MCU",
    signature: [k(22, 0), k(30, 0), k(33, 0), k(34, 0), k(35, 0), k(36, 0), k(21, 0)],
    filler: /__(fill|endcap|filltie|decap)/i,
    layers: GF180,
  },
  {
    id: "sg13g2",
    name: "IHP SG13G2",
    signature: [k(1, 0), k(5, 0), k(6, 0), k(8, 0), k(19, 0), k(10, 0), k(126, 0), k(134, 0)],
    filler: /sg13g2_(fill|decap)/i,
    layers: SG13G2,
  },
];

export const GENERIC: Pdk = {
  id: "generic",
  name: "Generic",
  signature: [],
  filler: /(^|_)(fill|filler|decap|tapcell)(_|\d|$)/i,
  layers: new Map(),
};

export const ALL_PDKS = [...PDKS, GENERIC];

export function detectPdk(keys: number[]): Pdk {
  const present = new Set(keys);
  let best: Pdk = GENERIC;
  let bestScore = 0.5;
  for (const p of PDKS) {
    const hit = p.signature.filter((s) => present.has(s)).length / p.signature.length;
    if (hit > bestScore) {
      best = p;
      bestScore = hit;
    }
  }
  return best;
}

const GENERIC_COLORS = [
  "#3e8eff",
  "#e5484d",
  "#3fbf6f",
  "#ffb224",
  "#b86bff",
  "#2ec4b6",
  "#ff6b9a",
  "#f5d90a",
  "#8da4ff",
  "#ff8b3e",
  "#6ee7b7",
  "#d6a35c",
];
const GENERIC_PATTERNS: Pattern[] = [P.diag, P.back, P.cross, P.dots, P.horiz, P.vert, P.dense];

/** Layer definitions for every key in the file: PDK entries first, then generated ones. */
export function resolveLayers(pdk: Pdk, keys: number[]): LayerDef[] {
  const out: LayerDef[] = [];
  const unknown = keys.filter((key) => !pdk.layers.has(key));
  let topZ = 0;
  for (const key of keys) {
    const def = pdk.layers.get(key);
    if (def) {
      out.push({ ...def });
      topZ = Math.max(topZ, def.z + def.t);
    }
  }
  const single = keys.length === 1;
  unknown.forEach((key, i) => {
    const known = pdk.layers.size > 0;
    out.push({
      key,
      name: keyDatatype(key) ? `layer ${keyLayer(key)}.${keyDatatype(key)}` : `layer ${keyLayer(key)}`,
      color: GENERIC_COLORS[i % GENERIC_COLORS.length],
      // Unknown layers of a known process are usually markers: outline only.
      pattern: known ? P.hollow : single ? P.solid : GENERIC_PATTERNS[i % GENERIC_PATTERNS.length],
      // Unknown layers of a known process are usually markers: keep them flat and out of 3D.
      z: known ? 0 : topZ + i * 0.6,
      t: known ? 0.01 : 0.5,
      visible: true,
      visible3d: !known,
    });
  });
  return out.sort((a, b) => a.z - b.z || a.key - b.key);
}
