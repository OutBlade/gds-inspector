/**
 * Bridge to an embedding editor. Inside a VS Code webview (also Cursor,
 * Windsurf and other forks) the file comes from the extension and downloads
 * go back to it; in a normal browser tab every function here is a no-op.
 */

interface VsCodeApi {
  postMessage(message: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const api: VsCodeApi | null = typeof acquireVsCodeApi === "function" ? acquireVsCodeApi() : null;

export const embedded = api !== null;

export type HostMessage =
  | { type: "open"; name: string; bytes: Uint8Array; lyp?: string }
  | { type: "reload"; name: string; bytes: Uint8Array }
  | { type: "lyp"; text: string }
  | { type: "export"; format: "png" | "svg" | "json" | "csv" };

export type ViewMessage =
  | { type: "ready" }
  | { type: "loaded"; cells: number; top: string; placements: number }
  | { type: "error"; message: string }
  | { type: "save"; name: string; bytes: Uint8Array };

export function post(message: ViewMessage) {
  api?.postMessage(message);
}

export function onHostMessage(cb: (m: HostMessage) => void) {
  window.addEventListener("message", (e: MessageEvent) => {
    const m = e.data as HostMessage | undefined;
    if (m && typeof m === "object" && typeof m.type === "string") cb(m);
  });
}

/** The editor's color theme, read from the classes VS Code puts on the body. */
export function hostTheme(): "dark" | "light" {
  const c = document.body.classList;
  return c.contains("vscode-light") || c.contains("vscode-high-contrast-light") ? "light" : "dark";
}

export function onHostTheme(cb: (t: "dark" | "light") => void) {
  new MutationObserver(() => cb(hostTheme())).observe(document.body, { attributes: true, attributeFilter: ["class"] });
}

export function saveFile(name: string, bytes: Uint8Array) {
  post({ type: "save", name, bytes });
}

/** Copies bytes into a standalone buffer that can be handed to the worker. */
export function ownBuffer(bytes: Uint8Array | ArrayBuffer | ArrayLike<number> | { data: ArrayLike<number> }): ArrayBuffer {
  const src =
    bytes instanceof ArrayBuffer
      ? new Uint8Array(bytes)
      : ArrayBuffer.isView(bytes) || "length" in bytes
        ? (bytes as ArrayLike<number>)
        : bytes.data;
  return Uint8Array.from(src).buffer;
}
