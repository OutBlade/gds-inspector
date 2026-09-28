import * as assert from "assert";
import * as path from "path";
import * as vscode from "vscode";

/** Minimal GDSII writer: one cell per entry, each with a rectangle and optional references. */
function gds(cells: { name: string; refs?: string[] }[]): Uint8Array {
  const out: number[] = [];
  const rec = (type: number, dtype: number, payload: number[]) => {
    const len = 4 + payload.length;
    out.push(len >> 8, len & 255, type, dtype, ...payload);
  };
  const i16 = (...v: number[]) => v.flatMap((x) => [(x >> 8) & 255, x & 255]);
  const i32 = (...v: number[]) => v.flatMap((x) => [(x >>> 24) & 255, (x >>> 16) & 255, (x >>> 8) & 255, x & 255]);
  const str = (s: string) => {
    const b = [...s].map((c) => c.charCodeAt(0));
    if (b.length % 2) b.push(0);
    return b;
  };
  // 1e-3 and 1e-9 as GDSII 8-byte reals.
  const units = [0x3e, 0x41, 0x89, 0x37, 0x4b, 0xc6, 0xa7, 0xf0, 0x39, 0x44, 0xb8, 0x2f, 0xa0, 0x9b, 0x5a, 0x54];
  const stamp = i16(2026, 1, 1, 0, 0, 0, 2026, 1, 1, 0, 0, 0);
  rec(0x00, 2, i16(600));
  rec(0x01, 2, stamp);
  rec(0x02, 6, str("TEST"));
  rec(0x03, 5, units);
  cells.forEach((c, k) => {
    rec(0x05, 2, stamp);
    rec(0x06, 6, str(c.name));
    rec(0x08, 0, []);
    rec(0x0d, 2, i16(1 + k));
    rec(0x0e, 2, i16(0));
    rec(0x10, 3, i32(0, 0, 1000, 0, 1000, 500, 0, 500, 0, 0));
    rec(0x11, 0, []);
    (c.refs ?? []).forEach((r, j) => {
      rec(0x0a, 0, []);
      rec(0x12, 6, str(r));
      rec(0x10, 3, i32(2000 * (j + 1), 0));
      rec(0x11, 0, []);
    });
    rec(0x07, 0, []);
  });
  rec(0x04, 0, []);
  return Uint8Array.from(out);
}

type Reported = Map<string, { type: string; cells?: number; top?: string }>;

async function waitFor(reported: Reported, uri: vscode.Uri, pred: (m: { type: string; cells?: number; top?: string }) => boolean) {
  const t0 = Date.now();
  while (Date.now() - t0 < 45000) {
    const m = reported.get(uri.toString());
    if (m?.type === "error") throw new Error(`webview reported: ${(m as { message?: string }).message}`);
    if (m && pred(m)) return m;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`timed out, last message: ${JSON.stringify(reported.get(uri.toString()))}`);
}

suite("GDS Inspector", () => {
  const dir = process.env.GDS_TEST_DIR!;
  const uri = vscode.Uri.file(path.join(dir, "fixture.gds"));
  let reported: Reported;

  suiteSetup(async () => {
    await vscode.workspace.fs.writeFile(uri, gds([{ name: "SUB" }, { name: "TOP", refs: ["SUB", "SUB"] }]));
    const ext = vscode.extensions.getExtension("OutBlade.gds-inspector")!;
    reported = ((await ext.activate()) as { reported: Reported }).reported;
  });

  test("opens .gds files in the layout editor", async () => {
    await vscode.commands.executeCommand("vscode.open", uri);
    const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
    assert.ok(tab?.input instanceof vscode.TabInputCustom, "active tab is a custom editor");
    assert.strictEqual((tab!.input as vscode.TabInputCustom).viewType, "gdsInspector.layout");
    const m = await waitFor(reported, uri, (x) => x.type === "loaded");
    assert.strictEqual(m.cells, 2);
    assert.strictEqual(m.top, "TOP");
  });

  test("reloads when the file changes on disk", async () => {
    await vscode.workspace.fs.writeFile(uri, gds([{ name: "A" }, { name: "B" }, { name: "TOP", refs: ["A", "B"] }]));
    const m = await waitFor(reported, uri, (x) => x.type === "loaded" && x.cells === 3);
    assert.strictEqual(m.top, "TOP");
  });

  test("exports the report and the view", async () => {
    const out = vscode.Uri.file(process.env.GDS_TEST_SAVE_DIR!);
    const waitFile = async (name: string) => {
      const t0 = Date.now();
      while (Date.now() - t0 < 30000) {
        try {
          return await vscode.workspace.fs.readFile(vscode.Uri.joinPath(out, name));
        } catch {
          await new Promise((r) => setTimeout(r, 200));
        }
      }
      throw new Error(`${name} was not written`);
    };
    // Give the report a moment after the reload of the previous test.
    await new Promise((r) => setTimeout(r, 1500));
    await vscode.commands.executeCommand("gdsInspector.export.json");
    const report = JSON.parse(new TextDecoder().decode(await waitFile("fixture.report.json")));
    assert.strictEqual(report.status, "ok");
    assert.strictEqual(report.file_info.cell_count, 3);
    await vscode.commands.executeCommand("gdsInspector.export.png");
    const png = await waitFile("fixture.png");
    assert.deepStrictEqual(Array.from(png.subarray(0, 4)), [0x89, 0x50, 0x4e, 0x47]);
  });

  test("registers its commands", async () => {
    const all = await vscode.commands.getCommands(true);
    assert.ok(all.includes("gdsInspector.open"));
    assert.ok(all.includes("gdsInspector.openWith"));
    assert.ok(all.includes("gdsInspector.export.svg"));
  });
});
