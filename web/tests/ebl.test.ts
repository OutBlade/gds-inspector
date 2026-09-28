import { describe, expect, it } from "vitest";
import { parseGds } from "../src/gds/parser";
import { buildModel, flatten } from "../src/worker/model";
import { Queries } from "../src/worker/queries";
import { eblDemo } from "../src/examples";
import { inspect } from "../src/analysis/inspect";

describe("EBL demo", () => {
  const model = buildModel(parseGds(eblDemo()));
  const top = model.byName.get("EBL_TESTFIELD")!;
  const q = new Queries(model, flatten(model, top));

  it("has the expected structure", () => {
    expect(model.tops).toEqual([top]);
    const r = inspect(model, "demo.gds", 1);
    expect(r.drc.stats.min_width_violations).toBeGreaterThan(0);
  });

  it("cuts through the dose matrix", () => {
    // Row 6 of the matrix at (-190, 40) holds 200 nm gratings, 8 µm tall, at y = 40 + 5 * 14.
    const y = 40 + 5 * 14 + 4;
    const res = q.section(-200, y, 60, y, new Set(model.layerKeys));
    expect(res.length).toBeGreaterThan(0);
    expect(res[0].spans.length).toBeGreaterThan(10);
  });
});
