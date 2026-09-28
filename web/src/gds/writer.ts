import { Rec } from "./parser";
import { writeReal8 } from "./real8";

/** Coordinates are in user units (µm by default) and rounded to database units on write. */
export interface WriterRef {
  cell: string;
  x: number;
  y: number;
  angle?: number;
  mag?: number;
  reflect?: boolean;
  /** AREF: columns, rows and pitch vectors in user units. */
  cols?: number;
  rows?: number;
  colPitch?: [number, number];
  rowPitch?: [number, number];
}

export interface WriterCell {
  name: string;
  polygons?: { layer: number; datatype?: number; points: number[] }[];
  paths?: {
    layer: number;
    datatype?: number;
    width: number;
    pathtype?: number;
    bgnextn?: number;
    endextn?: number;
    points: number[];
  }[];
  refs?: WriterRef[];
  texts?: { layer: number; texttype?: number; x: number; y: number; text: string }[];
}

export interface WriterLibrary {
  name?: string;
  /** Meters per user unit, 1e-6 for µm. */
  unit?: number;
  /** Meters per database unit, 1e-9 for 1 nm grid. */
  precision?: number;
  cells: WriterCell[];
}

class ByteSink {
  buf = new ArrayBuffer(1 << 16);
  view = new DataView(this.buf);
  len = 0;
  ensure(n: number) {
    if (this.len + n <= this.buf.byteLength) return;
    let cap = this.buf.byteLength * 2;
    while (cap < this.len + n) cap *= 2;
    const next = new ArrayBuffer(cap);
    new Uint8Array(next).set(new Uint8Array(this.buf, 0, this.len));
    this.buf = next;
    this.view = new DataView(next);
  }
  record(rec: number, dtype: number, payload: number) {
    const total = 4 + payload;
    this.ensure(total);
    this.view.setUint16(this.len, total);
    this.view.setUint8(this.len + 2, rec);
    this.view.setUint8(this.len + 3, dtype);
    this.len += 4;
  }
  empty(rec: number) {
    this.record(rec, 0, 0);
  }
  i16(rec: number, values: number[]) {
    this.record(rec, 2, values.length * 2);
    for (const v of values) {
      this.view.setInt16(this.len, v);
      this.len += 2;
    }
  }
  i32(rec: number, values: ArrayLike<number>) {
    this.record(rec, 3, values.length * 4);
    for (let i = 0; i < values.length; i++) {
      this.view.setInt32(this.len, values[i]);
      this.len += 4;
    }
  }
  real8(rec: number, values: number[]) {
    this.record(rec, 5, values.length * 8);
    for (const v of values) {
      writeReal8(this.view, this.len, v);
      this.len += 8;
    }
  }
  ascii(rec: number, s: string) {
    const padded = s.length % 2 ? s + "\0" : s;
    this.record(rec, 6, padded.length);
    for (let i = 0; i < padded.length; i++) this.view.setUint8(this.len + i, padded.charCodeAt(i) & 0xff);
    this.len += padded.length;
  }
  bytes() {
    return this.buf.slice(0, this.len);
  }
}

const STAMP = [2026, 1, 1, 0, 0, 0];

export function writeGds(lib: WriterLibrary): ArrayBuffer {
  const unit = lib.unit ?? 1e-6;
  const precision = lib.precision ?? 1e-9;
  const scale = unit / precision;
  const db = (v: number) => Math.round(v * scale);
  const s = new ByteSink();

  s.i16(Rec.HEADER, [600]);
  s.i16(Rec.BGNLIB, [...STAMP, ...STAMP]);
  s.ascii(Rec.LIBNAME, lib.name ?? "LIB");
  s.real8(Rec.UNITS, [precision / unit, precision]);

  for (const c of lib.cells) {
    s.i16(Rec.BGNSTR, [...STAMP, ...STAMP]);
    s.ascii(Rec.STRNAME, c.name);
    for (const p of c.polygons ?? []) {
      s.empty(Rec.BOUNDARY);
      s.i16(Rec.LAYER, [p.layer]);
      s.i16(Rec.DATATYPE, [p.datatype ?? 0]);
      const pts = p.points.map(db);
      pts.push(pts[0], pts[1]);
      s.i32(Rec.XY, pts);
      s.empty(Rec.ENDEL);
    }
    for (const p of c.paths ?? []) {
      s.empty(Rec.PATH);
      s.i16(Rec.LAYER, [p.layer]);
      s.i16(Rec.DATATYPE, [p.datatype ?? 0]);
      if (p.pathtype) s.i16(Rec.PATHTYPE, [p.pathtype]);
      s.i32(Rec.WIDTH, [db(p.width)]);
      if (p.pathtype === 4) {
        s.i32(Rec.BGNEXTN, [db(p.bgnextn ?? 0)]);
        s.i32(Rec.ENDEXTN, [db(p.endextn ?? 0)]);
      }
      s.i32(Rec.XY, p.points.map(db));
      s.empty(Rec.ENDEL);
    }
    for (const r of c.refs ?? []) {
      const aref = (r.cols ?? 1) > 1 || (r.rows ?? 1) > 1;
      s.empty(aref ? Rec.AREF : Rec.SREF);
      s.ascii(Rec.SNAME, r.cell);
      if (r.reflect || r.mag !== undefined || r.angle !== undefined) {
        s.i16(Rec.STRANS, [r.reflect ? -32768 : 0]);
        if (r.mag !== undefined) s.real8(Rec.MAG, [r.mag]);
        if (r.angle !== undefined) s.real8(Rec.ANGLE, [r.angle]);
      }
      if (aref) {
        const cols = r.cols ?? 1;
        const rows = r.rows ?? 1;
        const cp = r.colPitch ?? [0, 0];
        const rp = r.rowPitch ?? [0, 0];
        s.i16(Rec.COLROW, [cols, rows]);
        s.i32(Rec.XY, [
          db(r.x),
          db(r.y),
          db(r.x + cp[0] * cols),
          db(r.y + cp[1] * cols),
          db(r.x + rp[0] * rows),
          db(r.y + rp[1] * rows),
        ]);
      } else {
        s.i32(Rec.XY, [db(r.x), db(r.y)]);
      }
      s.empty(Rec.ENDEL);
    }
    for (const t of c.texts ?? []) {
      s.empty(Rec.TEXT);
      s.i16(Rec.LAYER, [t.layer]);
      s.i16(Rec.TEXTTYPE, [t.texttype ?? 0]);
      s.i32(Rec.XY, [db(t.x), db(t.y)]);
      s.ascii(Rec.STRING, t.text);
      s.empty(Rec.ENDEL);
    }
    s.empty(Rec.ENDSTR);
  }
  s.empty(Rec.ENDLIB);
  return s.bytes();
}

export const rect = (x0: number, y0: number, x1: number, y1: number) => [x0, y0, x1, y0, x1, y1, x0, y1];
