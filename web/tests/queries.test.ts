import { describe, expect, it } from "vitest";
import { parseGds } from "../src/gds/parser";
import { rect, writeGds } from "../src/gds/writer";
import { layerKey } from "../src/gds/types";
import { buildModel, flatten } from "../src/worker/model";
import { Queries } from "../src/worker/queries";

const L1 = layerKey(1, 0);
const L2 = layerKey(2, 0);

function setup() {
  const lib = parseGds(
    writeGds({
      cells: [
        { name: "BAR", polygons: [{ layer: 2, points: rect(0, 0, 2, 10) }], texts: [{ layer: 5, x: 1, y: 5, text: "PIN" }] },
        {
          name: "TOP",
          polygons: [
            { layer: 1, points: rect(0, 0, 10, 10) },
            { layer: 1, points: rect(20, 0, 30, 10) },
          ],
          refs: [
            { cell: "BAR", x: 40, y: 0 },
            { cell: "BAR", x: 60, y: 0, angle: 90 },
          ],
          texts: [{ layer: 5, x: 5, y: 5, text: "VDD" }],
        },
      ],
    }),
  );
  const model = buildModel(lib);
  const top = model.byName.get("TOP")!;
  return new Queries(model, flatten(model, top));
}

describe("queries", () => {
  const q = setup();

  it("picks the shape under the point with its hierarchy", () => {
    const hits = q.pick(41, 5, 0.01, new Set([L1, L2]), new Set());
    expect(hits).toHaveLength(1);
    expect(hits[0].key).toBe(L2);
    expect(hits[0].path).toEqual(["TOP", "BAR"]);
    expect(hits[0].area).toBeCloseTo(20);
    // Hidden layers are not picked.
    expect(q.pick(41, 5, 0.01, new Set([L1]), new Set())).toHaveLength(0);
  });

  it("picks through a rotated placement", () => {
    // BAR rotated 90 degrees at (60, 0) covers x 50..60, y 0..2.
    const hits = q.pick(55, 1, 0.01, new Set([L2]), new Set());
    expect(hits).toHaveLength(1);
    expect(hits[0].box.map((v) => Math.round(v * 1000) / 1000)).toEqual([50, 0, 60, 2]);
  });

  it("snaps to vertices", () => {
    const s = q.snap(10.2, 9.9, 0.5, new Set([L1]));
    expect(s).toEqual({ x: 10, y: 10, kind: "vertex" });
  });

  it("cuts cross-sections", () => {
    const res = q.section(-5, 5, 45, 5, new Set([L1, L2]));
    const l1 = res.find((r) => r.key === L1)!;
    expect(l1.spans.map((v) => Math.round(v * 1000) / 1000)).toEqual([5, 15, 25, 35]);
    const l2 = res.find((r) => r.key === L2)!;
    expect(l2.spans.map((v) => Math.round(v * 1000) / 1000)).toEqual([45, 47]);
  });

  it("cuts a line that starts inside a shape", () => {
    const res = q.section(5, 5, 25, 5, new Set([L1]));
    expect(res[0].spans.map((v) => Math.round(v * 1000) / 1000)).toEqual([0, 5, 15, 20]);
  });

  it("returns labels in view, including zoomed-in cell labels", () => {
    const all = new Set([layerKey(5, 0)]);
    const far = q.labels([-100, -100, 100, 100], 100, all, 1);
    expect(far.map((l) => l.text)).toEqual(["VDD"]);
    const near = q.labels([-100, -100, 100, 100], 100, all, 100);
    expect(near.map((l) => l.text).sort()).toEqual(["PIN", "PIN", "VDD"]);
  });

  it("searches labels", () => {
    const r = q.searchLabels("pin");
    expect(r).toHaveLength(1);
    expect(r[0].count).toBe(2);
  });

  it("returns shapes in a box", () => {
    const r = q.shapesIn([0, 0, 12, 12], new Set([L1]), new Set(), 1000);
    expect(r.layers[0].rings).toHaveLength(1);
  });
});
