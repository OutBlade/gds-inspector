/** Raw GDSII library as read from the stream. Coordinates are integer database units. */
export interface GdsLibrary {
  name: string;
  /** Size of one database unit in user units (UNITS record, first value). */
  userUnitsPerDb: number;
  /** Size of one database unit in meters (UNITS record, second value). */
  metersPerDb: number;
  cells: GdsCell[];
}

export interface GdsCell {
  name: string;
  boundaries: GdsBoundary[];
  paths: GdsPath[];
  refs: GdsRef[];
  texts: GdsText[];
}

export interface GdsBoundary {
  layer: number;
  datatype: number;
  /** Closed ring, x0 y0 x1 y1 ..., without the repeated closing point. */
  xy: Int32Array | Float64Array;
  /** True when the element came from a BOX record. */
  box?: boolean;
}

export interface GdsPath {
  layer: number;
  datatype: number;
  pathtype: number;
  width: number;
  bgnextn: number;
  endextn: number;
  xy: Int32Array | Float64Array;
}

export interface GdsRef {
  name: string;
  x: number;
  y: number;
  mag: number;
  /** Rotation in degrees, counterclockwise. */
  angle: number;
  /** Reflection about the x axis, applied before rotation. */
  reflect: boolean;
  /** AREF only: columns, rows and the three lattice points. */
  cols: number;
  rows: number;
  colX: number;
  colY: number;
  rowX: number;
  rowY: number;
}

export interface GdsText {
  layer: number;
  texttype: number;
  x: number;
  y: number;
  text: string;
  mag: number;
  angle: number;
}

export const layerKey = (layer: number, datatype: number) => layer * 65536 + datatype;
export const keyLayer = (key: number) => Math.floor(key / 65536);
export const keyDatatype = (key: number) => key % 65536;
export const keyLabel = (key: number) => `${keyLayer(key)}/${keyDatatype(key)}`;
