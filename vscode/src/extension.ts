import * as vscode from "vscode";

const VIEW_TYPE = "gdsInspector.layout";

/** Messages from the webview, see web/src/host.ts. */
type ViewMessage =
  | { type: "ready" }
  | { type: "loaded"; cells: number; top: string; placements: number }
  | { type: "error"; message: string }
  | { type: "save"; name: string; bytes: Uint8Array };

class LayoutDocument implements vscode.CustomDocument {
  constructor(readonly uri: vscode.Uri) {}
  dispose() {}
}

/** Last state reported by each open layout; the integration tests read it. */
export const reported = new Map<string, ViewMessage>();

/** The layout panel that was focused last, target of the export commands. */
let activePanel: vscode.WebviewPanel | undefined;

class LayoutEditorProvider implements vscode.CustomReadonlyEditorProvider<LayoutDocument> {
  constructor(private readonly context: vscode.ExtensionContext) {}

  openCustomDocument(uri: vscode.Uri): LayoutDocument {
    return new LayoutDocument(uri);
  }

  async resolveCustomEditor(document: LayoutDocument, panel: vscode.WebviewPanel): Promise<void> {
    const media = vscode.Uri.joinPath(this.context.extensionUri, "media");
    panel.webview.options = { enableScripts: true, localResourceRoots: [media] };
    panel.webview.html = await this.html(panel.webview, media);

    const uri = document.uri;
    const name = uri.path.split("/").pop() ?? "layout.gds";
    const send = async (type: "open" | "reload") => {
      try {
        // A plain Uint8Array crosses into the webview as binary; a Node Buffer would not.
        const bytes = new Uint8Array(await vscode.workspace.fs.readFile(uri));
        const lyp = type === "open" ? await findLayerProperties(uri) : undefined;
        await panel.webview.postMessage({ type, name: name.replace(/\.gz$/i, ""), bytes, lyp });
      } catch (e) {
        vscode.window.showErrorMessage(`GDS Inspector: could not read ${name}: ${(e as Error).message}`);
      }
    };

    const disposables: vscode.Disposable[] = [];
    activePanel = panel;
    panel.onDidChangeViewState((e) => {
      if (e.webviewPanel.active) activePanel = e.webviewPanel;
    }, undefined, disposables);
    panel.webview.onDidReceiveMessage(
      async (m: ViewMessage) => {
        reported.set(uri.toString(), m);
        if (m.type === "ready") await send("open");
        else if (m.type === "error") vscode.window.showErrorMessage(`GDS Inspector: ${m.message}`);
        else if (m.type === "save") await saveExport(uri, m.name, m.bytes);
      },
      undefined,
      disposables,
    );

    // Reload when the file is rewritten, for example by a layout or place and route run.
    const folder = vscode.Uri.joinPath(uri, "..");
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, name));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const changed = () => {
      clearTimeout(timer);
      timer = setTimeout(() => send("reload"), 400);
    };
    watcher.onDidChange(changed, undefined, disposables);
    watcher.onDidCreate(changed, undefined, disposables);
    disposables.push(watcher);

    vscode.workspace.onDidChangeConfiguration(
      async (e) => {
        if (!e.affectsConfiguration("gdsInspector.layerProperties")) return;
        const text = await findLayerProperties(uri);
        if (text) panel.webview.postMessage({ type: "lyp", text });
      },
      undefined,
      disposables,
    );

    panel.onDidDispose(() => {
      if (activePanel === panel) activePanel = undefined;
      clearTimeout(timer);
      reported.delete(uri.toString());
      for (const d of disposables) d.dispose();
    });
  }

  /** The web app's index.html with resource URLs rewritten for the webview and a strict CSP. */
  private async html(webview: vscode.Webview, media: vscode.Uri): Promise<string> {
    const raw = new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(media, "index.html")));
    const nonce = makeNonce();
    const base = webview.asWebviewUri(media).toString();
    const csp = [
      "default-src 'none'",
      `script-src 'nonce-${nonce}'`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `img-src ${webview.cspSource} data: blob:`,
      `font-src ${webview.cspSource}`,
      "worker-src blob:",
      "connect-src blob: data:",
    ].join("; ");
    return raw
      .replace(/\s+crossorigin(="[^"]*")?/g, "")
      .replace(/<link rel="icon"[^>]*>/, "")
      .replace(/(src|href)="\.\/([^"]+)"/g, (_m, attr, path) => `${attr}="${base}/${path}"`)
      .replace(/<script /g, `<script nonce="${nonce}" `)
      .replace("<head>", `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`);
  }
}

function makeNonce() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < 32; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

async function exists(uri: vscode.Uri) {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

/**
 * KLayout layer properties for a layout: the configured file, else `<name>.lyp`
 * next to it, else the only `.lyp` in its folder.
 */
async function findLayerProperties(uri: vscode.Uri): Promise<string | undefined> {
  const decode = async (u: vscode.Uri) => new TextDecoder().decode(await vscode.workspace.fs.readFile(u));
  const setting = vscode.workspace.getConfiguration("gdsInspector", uri).get<string>("layerProperties")?.trim();
  if (setting) {
    const ws = vscode.workspace.getWorkspaceFolder(uri);
    const isAbsolute = /^([a-zA-Z]:[\\/]|[\\/])/.test(setting);
    const target = isAbsolute ? vscode.Uri.file(setting) : ws ? vscode.Uri.joinPath(ws.uri, setting) : undefined;
    if (target && (await exists(target))) return decode(target);
    vscode.window.showWarningMessage(`GDS Inspector: layer properties file not found: ${setting}`);
  }
  const folder = vscode.Uri.joinPath(uri, "..");
  const stem = (uri.path.split("/").pop() ?? "").replace(/\.gz$/i, "").replace(/\.[^.]+$/, "");
  const sibling = vscode.Uri.joinPath(folder, `${stem}.lyp`);
  if (await exists(sibling)) return decode(sibling);
  try {
    const lyps = (await vscode.workspace.fs.readDirectory(folder)).filter(([n, t]) => t === vscode.FileType.File && /\.lyp$/i.test(n));
    if (lyps.length === 1) return decode(vscode.Uri.joinPath(folder, lyps[0][0]));
  } catch {
    /* folder not listable */
  }
  return undefined;
}

async function saveExport(layout: vscode.Uri, name: string, bytes: Uint8Array) {
  // The integration tests cannot answer a dialog; they point exports at a folder instead.
  const testDir = process.env.GDS_TEST_SAVE_DIR;
  if (testDir) {
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(vscode.Uri.file(testDir), name), bytes);
    return;
  }
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const filters: Record<string, string[]> =
    ext === "png" ? { Image: ["png"] } : ext === "svg" ? { "SVG image": ["svg"] } : ext === "json" ? { JSON: ["json"] } : ext === "csv" ? { CSV: ["csv"] } : {};
  const target = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.joinPath(layout, "..", name), filters });
  if (!target) return;
  await vscode.workspace.fs.writeFile(target, bytes);
  const open = await vscode.window.showInformationMessage(`Saved ${target.path.split("/").pop()}`, "Reveal");
  if (open) vscode.commands.executeCommand("revealFileInOS", target);
}

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(VIEW_TYPE, new LayoutEditorProvider(context), {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: true,
    }),
    vscode.commands.registerCommand("gdsInspector.open", async () => {
      const picked = await vscode.window.showOpenDialog({
        canSelectMany: false,
        filters: { "GDSII layout": ["gds", "gds2", "gdsii", "gdsx", "gz"] },
        title: "Open GDSII layout",
      });
      if (picked?.[0]) await vscode.commands.executeCommand("vscode.openWith", picked[0], VIEW_TYPE);
    }),
    vscode.commands.registerCommand("gdsInspector.openWith", async (uri?: vscode.Uri) => {
      if (uri) await vscode.commands.executeCommand("vscode.openWith", uri, VIEW_TYPE);
    }),
    ...(["png", "svg", "json", "csv"] as const).map((format) =>
      vscode.commands.registerCommand(`gdsInspector.export.${format}`, () => {
        if (!activePanel) {
          vscode.window.showInformationMessage("GDS Inspector: open a layout first.");
          return;
        }
        activePanel.webview.postMessage({ type: "export", format });
      }),
    ),
  );
  return { reported };
}

export function deactivate() {}
