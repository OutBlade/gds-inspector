import { describe, expect, it } from "vitest";
import { parseGds } from "../src/gds/parser";
import { readReal8, writeReal8 } from "../src/gds/real8";
import { rect, writeGds } from "../src/gds/writer";
import { pathToRing, ringArea } from "../src/gds/geometry";
import { buildModel, flatten, placement, placementPath } from "../src/worker/model";
import { buildScene } from "../src/worker/scene";
import { inspect } from "../src/analysis/inspect";

const lib = (cells: Parameters<typeof writeGds>[0]["cells"]) => parseGds(writeGds({ cells }));

describe("real8", () => {
  it("round trips typical values", () => {
    const view = new DataView(new ArrayBuffer(8));
    for (const v of [1, -1, 0.001, 1e-9, 1e-6, 90, 0.5, 12345.678, -2.5e-3]) {
      writeReal8(view, 0, v);
      expect(readReal8(view, 0)).toBeCloseTo(v, 12);
    }
  });
});

describe("parser", () => {
  it("reads units, cells and shapes", () => {
    const l = lib([
      {
        name: "TOP",
        polygons: [{ layer: 1, datatype: 2, points: rect(0, 0, 10, 5) }],
        paths: [{ layer: 3, width: 1, points: [0, 0, 10, 0] }],
        texts: [{ layer: 5, x: 1, y: 2, text: "VDD" }],
      },
    ]);
    expect(l.userUnitsPerDb).toBeCloseTo(1e-3, 12);
    expect(l.metersPerDb).toBeCloseTo(1e-9, 20);
    expect(l.cells).toHaveLength(1);
    const c = l.cells[0];
    expect(c.boundaries[0].layer).toBe(1);
    expect(c.boundaries[0].datatype).toBe(2);
    expect(Array.from(c.boundaries[0].xy)).toEqual([0, 0, 10000, 0, 10000, 5000, 0, 5000]);
    expect(c.paths[0].width).toBe(1000);
    expect(c.texts[0].text).toBe("VDD");
  });

  it("rejects files that are not GDSII", () => {
    expect(() => parseGds(new TextEncoder().encode("hello world, not gds").buffer)).toThrow();
  });
});

describe("paths", () => {
  const base = { layer: 1, datatype: 0, bgnextn: 0, endextn: 0 };
  it("flush ends keep the length", () => {
    const r = pathToRing({ ...base, pathtype: 0, width: 2, xy: new Int32Array([0, 0, 10, 0]) })!;
    expect(Math.abs(ringArea(r))).toBeCloseTo(20);
  });
  it("square ends extend by half the width", () => {
    const r = pathToRing({ ...base, pathtype: 2, width: 2, xy: new Int32Array([0, 0, 10, 0]) })!;
    expect(Math.abs(ringArea(r))).toBeCloseTo(24);
  });
  it("custom extensions", () => {
    const r = pathToRing({ ...base, pathtype: 4, width: 2, bgnextn: 3, endextn: 1, xy: new Int32Array([0, 0, 10, 0]) })!;
    expect(Math.abs(ringArea(r))).toBeCloseTo(28);
  });
  it("manhattan corner is mitered exactly", () => {
    const r = pathToRing({ ...base, pathtype: 0, width: 2, xy: new Int32Array([0, 0, 10, 0, 10, 10]) })!;
    // L shape: two 10 x 2 arms minus nothing, corner square counted once.
    expect(Math.abs(ringArea(r))).toBeCloseTo(10 * 2 + 10 * 2);
  });
  it("round ends add half discs", () => {
    const r = pathToRing({ ...base, pathtype: 1, width: 2, xy: new Int32Array([0, 0, 10, 0]) })!;
    expect(Math.abs(ringArea(r))).toBeGreaterThan(20 + Math.PI * 0.95);
    expect(Math.abs(ringArea(r))).toBeLessThan(20 + Math.PI);
  });
});

describe("hierarchy", () => {
  const l = lib([
    { name: "UNIT", polygons: [{ layer: 1, points: rect(0, 0, 1, 2) }] },
    {
      name: "ARR",
      refs: [{ cell: "UNIT", x: 100, y: 0, cols: 3, rows: 2, colPitch: [10, 0], rowPitch: [0, 20] }],
    },
    {
      name: "TOP",
      refs: [
        { cell: "UNIT", x: 0, y: 0 },
        { cell: "UNIT", x: 50, y: 0, angle: 90 },
        { cell: "UNIT", x: 70, y: 0, reflect: true },
        { cell: "UNIT", x: 80, y: 0, mag: 2 },
        { cell: "ARR", x: 0, y: 0 },
      ],
    },
  ]);
  const model = buildModel(l);
  const top = model.byName.get("TOP")!;
  const unit = model.byName.get("UNIT")!;

  it("finds the top cell", () => {
    expect(model.tops).toEqual([top]);
  });

  it("expands SREF and AREF placements", () => {
    const pl = flatten(model, top);
    expect(pl.count[unit]).toBe(4 + 6);
  });

  it("applies rotation, reflection and magnification", () => {
    const pl = flatten(model, top);
    const pts = (k: number) => {
      const m = placement(pl, unit, k);
      return [m.a * 1 + m.c * 2 + m.tx, m.b * 1 + m.d * 2 + m.ty].map((v) => Math.round(v * 1e6) / 1e6);
    };
    expect(pts(0)).toEqual([1, 2]);
    expect(pts(1)).toEqual([48, 1]);
    expect(pts(2)).toEqual([71, -2]);
    expect(pts(3)).toEqual([82, 4]);
  });

  it("places AREF lattice elements", () => {
    const pl = flatten(model, top);
    const xs = new Set<string>();
    for (let k = 4; k < 10; k++) {
      const m = placement(pl, unit, k);
      xs.add(`${Math.round(m.tx)},${Math.round(m.ty)}`);
    }
    expect([...xs].sort()).toEqual(["100,0", "100,20", "110,0", "110,20", "120,0", "120,20"]);
  });

  it("reconstructs placement paths", () => {
    const pl = flatten(model, top);
    expect(placementPath(model, pl, unit, 5)).toEqual(["TOP", "ARR", "UNIT"]);
  });

  it("computes full bounding boxes", () => {
    const b = model.cells[top].fullBox;
    expect(b[0]).toBeCloseTo(0);
    expect(b[1]).toBeCloseTo(-2);
    expect(b[2]).toBeCloseTo(121);
    expect(b[3]).toBeCloseTo(22);
  });

  it("builds an instanced scene", () => {
    const pl = flatten(model, top);
    const scene = buildScene(model, pl);
    const u = scene.cells.find((c) => c.id === unit)!;
    expect(u.count).toBe(10);
    expect(u.chunks.reduce((s, c) => s + c.count, 0)).toBe(10);
    expect(u.parts[0].tri.length).toBe(6);
    // The scene extent must match the hierarchy's bounding box.
    const b = model.cells[top].fullBox;
    scene.box.forEach((v, i) => expect(v).toBeCloseTo(b[i], 6));
  });
});

describe("inspector port", () => {
  // Same fixture as tests/test_inspector.py in the Python backend.
  const l = lib([
    {
      name: "TOP",
      polygons: [
        { layer: 1, points: rect(0, 0, 10, 10) },
        { layer: 1, points: rect(15, 0, 25, 5) },
        { layer: 2, points: rect(0, 15, 5, 20) },
        { layer: 1, points: rect(30, 0, 30.05, 10) },
      ],
    },
  ]);
  const report = inspect(buildModel(l), "test.gds", 1234);

  it("matches the backend report", () => {
    expect(report.status).toBe("ok");
    expect(report.file_info.cell_count).toBe(1);
    expect(report.file_info.unit_label).toBe("µm");
    expect(report.cells[0]).toMatchObject({ name: "TOP", is_top: true, polygon_count: 1 * 4 });
    const l1 = report.layers.find((x) => x.layer === 1)!;
    expect(l1.polygon_count).toBe(3);
    expect(l1.total_area_um2).toBeCloseTo(100 + 50 + 0.5, 6);
    expect(l1.min_cd_nm).toBeCloseTo(50, 3);
    expect(l1.max_cd_nm).toBeCloseTo(10000, 3);
    expect(l1.density_percent).toBeCloseTo((150.5 / (30.05 * 20)) * 100, 6);
    expect(report.drc.violations.filter((v) => v.rule === "MIN_WIDTH")).toHaveLength(1);
    expect(report.drc.passed).toBe(false);
    expect(report.preview.polygons).toHaveLength(4);
  });
});
