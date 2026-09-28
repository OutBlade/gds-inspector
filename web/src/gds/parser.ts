import { readReal8 } from "./real8";
import type { GdsBoundary, GdsCell, GdsLibrary, GdsPath, GdsRef, GdsText } from "./types";

export const Rec = {
  HEADER: 0x00,
  BGNLIB: 0x01,
  LIBNAME: 0x02,
  UNITS: 0x03,
  ENDLIB: 0x04,
  BGNSTR: 0x05,
  STRNAME: 0x06,
  ENDSTR: 0x07,
  BOUNDARY: 0x08,
  PATH: 0x09,
  SREF: 0x0a,
  AREF: 0x0b,
  TEXT: 0x0c,
  LAYER: 0x0d,
  DATATYPE: 0x0e,
  WIDTH: 0x0f,
  XY: 0x10,
  ENDEL: 0x11,
  SNAME: 0x12,
  COLROW: 0x13,
  NODE: 0x15,
  TEXTTYPE: 0x16,
  PRESENTATION: 0x17,
  STRING: 0x19,
  STRANS: 0x1a,
  MAG: 0x1b,
  ANGLE: 0x1c,
  PATHTYPE: 0x21,
  BOX: 0x2d,
  BOXTYPE: 0x2e,
  BGNEXTN: 0x30,
  ENDEXTN: 0x31,
} as const;

export class GdsParseError extends Error {}

const decoder = new TextDecoder("latin1");

// Cell names repeat for every reference, so decoded names are cached by their bytes.
const nameCache = new Map<string, string>();

function readAscii(bytes: Uint8Array, start: number, len: number): string {
  let end = start + len;
  while (end > start && bytes[end - 1] === 0) end--;
  const n = end - start;
  if (n > 64) return decoder.decode(bytes.subarray(start, end));
  // TextDecoder has a high fixed cost per call in browsers; short strings are built directly.
  let s = "";
  for (let i = start; i < end; i++) s += String.fromCharCode(bytes[i]);
  const hit = nameCache.get(s);
  if (hit !== undefined) return hit;
  if (nameCache.size < 100_000) nameCache.set(s, s);
  return s;
}

type Element =
  | { kind: "boundary"; box: boolean }
  | { kind: "path" }
  | { kind: "ref"; aref: boolean }
  | { kind: "text" }
  | { kind: "node" };

/**
 * Reads a GDSII stream. Unknown records are skipped, so vendor extensions and
 * properties do not stop the parse.
 */
export function parseGds(buffer: ArrayBuffer, onProgress?: (fraction: number) => void): GdsLibrary {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const size = buffer.byteLength;
  const lib: GdsLibrary = { name: "", userUnitsPerDb: 1e-3, metersPerDb: 1e-9, cells: [] };

  let cell: GdsCell | null = null;
  let el: Element | null = null;
  let layer = 0;
  let datatype = 0;
  let width = 0;
  let pathtype = 0;
  let bgnextn = 0;
  let endextn = 0;
  let xy: Int32Array | null = null;
  let sname = "";
  let text = "";
  let reflect = false;
  let mag = 1;
  let angle = 0;
  let cols = 1;
  let rows = 1;
  let sawHeader = false;

  let pos = 0;
  let nextReport = 0;
  while (pos + 4 <= size) {
    const len = view.getUint16(pos);
    const rec = bytes[pos + 2];
    if (len === 0) {
      // Zero padding after ENDLIB (tape block fill) or a corrupt stream.
      if (!cell) break;
      throw new GdsParseError(`Zero-length record at byte ${pos}`);
    }
    if (len < 4 || pos + len > size) throw new GdsParseError(`Truncated record at byte ${pos}`);
    const d = pos + 4;
    const dlen = len - 4;

    if (!sawHeader) {
      if (rec !== Rec.HEADER) throw new GdsParseError("Not a GDSII stream (missing HEADER record)");
      sawHeader = true;
    }

    switch (rec) {
      case Rec.LIBNAME:
        lib.name = readAscii(bytes, d, dlen);
        break;
      case Rec.UNITS:
        lib.userUnitsPerDb = readReal8(view, d);
        lib.metersPerDb = readReal8(view, d + 8);
        break;
      case Rec.BGNSTR:
        cell = { name: "", boundaries: [], paths: [], refs: [], texts: [] };
        break;
      case Rec.STRNAME:
        if (cell) cell.name = readAscii(bytes, d, dlen);
        break;
      case Rec.ENDSTR:
        if (cell) lib.cells.push(cell);
        cell = null;
        break;
      case Rec.BOUNDARY:
        el = { kind: "boundary", box: false };
        break;
      case Rec.BOX:
        el = { kind: "boundary", box: true };
        break;
      case Rec.PATH:
        el = { kind: "path" };
        width = 0;
        pathtype = 0;
        bgnextn = 0;
        endextn = 0;
        break;
      case Rec.SREF:
      case Rec.AREF:
        el = { kind: "ref", aref: rec === Rec.AREF };
        reflect = false;
        mag = 1;
        angle = 0;
        cols = 1;
        rows = 1;
        break;
      case Rec.TEXT:
        el = { kind: "text" };
        mag = 1;
        angle = 0;
        break;
      case Rec.NODE:
        el = { kind: "node" };
        break;
      case Rec.LAYER:
        layer = view.getInt16(d);
        break;
      case Rec.DATATYPE:
      case Rec.TEXTTYPE:
      case Rec.BOXTYPE:
        datatype = view.getInt16(d);
        break;
      case Rec.WIDTH:
        width = view.getInt32(d);
        break;
      case Rec.PATHTYPE:
        pathtype = view.getInt16(d);
        break;
      case Rec.BGNEXTN:
        bgnextn = view.getInt32(d);
        break;
      case Rec.ENDEXTN:
        endextn = view.getInt32(d);
        break;
      case Rec.SNAME:
        sname = readAscii(bytes, d, dlen);
        break;
      case Rec.STRING:
        text = readAscii(bytes, d, dlen);
        break;
      case Rec.STRANS:
        reflect = (view.getUint16(d) & 0x8000) !== 0;
        break;
      case Rec.MAG:
        mag = readReal8(view, d);
        break;
      case Rec.ANGLE:
        angle = readReal8(view, d);
        break;
      case Rec.COLROW:
        cols = view.getInt16(d);
        rows = view.getInt16(d + 2);
        break;
      case Rec.XY: {
        const n = dlen >> 2;
        xy = new Int32Array(n);
        for (let i = 0; i < n; i++) xy[i] = view.getInt32(d + i * 4);
        break;
      }
      case Rec.ENDEL:
        if (cell && el && xy) finishElement(cell, el);
        el = null;
        xy = null;
        break;
      case Rec.ENDLIB:
        onProgress?.(1);
        return lib;
    }

    pos += len;
    if (onProgress && pos >= nextReport) {
      onProgress(pos / size);
      nextReport = pos + 4_000_000;
    }
  }
  if (!sawHeader) throw new GdsParseError("Empty file");
  return lib;

  function finishElement(c: GdsCell, e: Element) {
    const pts = xy!;
    switch (e.kind) {
      case "boundary": {
        let n = pts.length;
        if (n >= 4 && pts[0] === pts[n - 2] && pts[1] === pts[n - 1]) n -= 2;
        if (n < 6) return;
        const b: GdsBoundary = { layer, datatype, xy: n === pts.length ? pts : pts.slice(0, n) };
        if (e.box) b.box = true;
        c.boundaries.push(b);
        return;
      }
      case "path": {
        if (pts.length < 4) return;
        const p: GdsPath = { layer, datatype, pathtype, width, bgnextn, endextn, xy: pts };
        c.paths.push(p);
        return;
      }
      case "ref": {
        const r: GdsRef = {
          name: sname,
          x: pts[0],
          y: pts[1],
          mag,
          angle,
          reflect,
          cols: 1,
          rows: 1,
          colX: 0,
          colY: 0,
          rowX: 0,
          rowY: 0,
        };
        if (e.aref && pts.length >= 6 && cols > 0 && rows > 0) {
          r.cols = cols;
          r.rows = rows;
          r.colX = (pts[2] - pts[0]) / cols;
          r.colY = (pts[3] - pts[1]) / cols;
          r.rowX = (pts[4] - pts[0]) / rows;
          r.rowY = (pts[5] - pts[1]) / rows;
        }
        c.refs.push(r);
        return;
      }
      case "text": {
        const t: GdsText = { layer, texttype: datatype, x: pts[0], y: pts[1], text, mag, angle };
        c.texts.push(t);
        return;
      }
    }
  }
}

/** Accepts plain or gzip-compressed GDSII bytes. */
export async function maybeGunzip(buffer: ArrayBuffer): Promise<ArrayBuffer> {
  const b = new Uint8Array(buffer, 0, Math.min(2, buffer.byteLength));
  if (b[0] !== 0x1f || b[1] !== 0x8b) return buffer;
  const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).arrayBuffer();
}
