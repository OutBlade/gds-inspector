/**
 * Compares the browser port with the Python backend on a fixture written by
 * tests/parity/make_fixture.py. Runs when PARITY_DIR points at its output.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { parseGds } from "../src/gds/parser";
import { buildModel } from "../src/worker/model";
import { inspect } from "../src/analysis/inspect";
import type { Report } from "../src/analysis/inspect";

const dir = process.env.PARITY_DIR;

describe.skipIf(!dir)("parity with the Python backend", () => {
  const load = () => {
    const buf = readFileSync(join(dir!, "fixture.gds"));
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const expected = JSON.parse(readFileSync(join(dir!, "expected.json"), "utf-8")) as Report;
    const actual = inspect(buildModel(parseGds(ab)), expected.file_info.path, buf.byteLength);
    return { expected, actual };
  };

  it("file info", () => {
    const { expected, actual } = load();
    expect(actual.file_info.cell_count).toBe(expected.file_info.cell_count);
    expect(actual.file_info.library_name).toBe(expected.file_info.library_name);
    expect(actual.file_info.unit_label).toBe(expected.file_info.unit_label);
    expect(actual.file_info.unit_meters).toBeCloseTo(expected.file_info.unit_meters, 15);
    expect(actual.file_info.precision_meters).toBeCloseTo(expected.file_info.precision_meters, 18);
    expect(actual.top_cell).toBe(expected.top_cell);
  });

  it("cells", () => {
    const { expected, actual } = load();
    const byName = new Map(actual.cells.map((c) => [c.name, c]));
    for (const e of expected.cells) {
      const a = byName.get(e.name)!;
      expect(a, e.name).toBeTruthy();
      expect(a.is_top).toBe(e.is_top);
      expect(a.polygon_count).toBe(e.polygon_count);
      expect(a.path_count).toBe(e.path_count);
      expect(a.reference_count).toBe(e.reference_count);
      for (const k of ["x_min", "y_min", "x_max", "y_max"] as const) expect(a.bounding_box![k]).toBeCloseTo(e.bounding_box![k], 1);
    }
  });

  it("layers", () => {
    const { expected, actual } = load();
    const byLayer = new Map(actual.layers.map((l) => [l.layer, l]));
    expect(actual.layers.length).toBe(expected.layers.length);
    for (const e of expected.layers) {
      const a = byLayer.get(e.layer)!;
      expect(a.polygon_count).toBe(e.polygon_count);
      expect(a.total_area_um2).toBeCloseTo(e.total_area_um2, 6);
      expect(a.min_cd_nm).toBeCloseTo(e.min_cd_nm, 3);
      expect(a.max_cd_nm).toBeCloseTo(e.max_cd_nm, 3);
      expect(a.min_edge_nm).toBeCloseTo(e.min_edge_nm, 3);
      expect(a.density_percent).toBeCloseTo(e.density_percent, 6);
    }
  });

  it("rule checks and preview", () => {
    const { expected, actual } = load();
    expect(actual.drc.stats).toEqual(expected.drc.stats);
    expect(actual.drc.violations.length).toBe(expected.drc.violations.length);
    expect(actual.drc.passed).toBe(expected.drc.passed);
    expect(actual.preview.total_polygon_count).toBe(expected.preview.total_polygon_count);
    expect(actual.preview.shown_polygon_count).toBe(expected.preview.shown_polygon_count);
  });
});
