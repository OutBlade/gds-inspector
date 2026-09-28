/** GDSII 8-byte real: sign bit, 7-bit excess-64 base-16 exponent, 56-bit mantissa. */
export function readReal8(view: DataView, offset: number): number {
  const b0 = view.getUint8(offset);
  const sign = b0 & 0x80 ? -1 : 1;
  const exponent = (b0 & 0x7f) - 64;
  let mantissa = 0;
  for (let i = 1; i < 8; i++) mantissa = mantissa * 256 + view.getUint8(offset + i);
  if (mantissa === 0) return 0;
  return sign * (mantissa / 2 ** 56) * 16 ** exponent;
}

export function writeReal8(view: DataView, offset: number, value: number): void {
  if (value === 0 || !Number.isFinite(value)) {
    for (let i = 0; i < 8; i++) view.setUint8(offset + i, 0);
    return;
  }
  let sign = 0;
  if (value < 0) {
    sign = 0x80;
    value = -value;
  }
  let exponent = 0;
  while (value >= 1) {
    value /= 16;
    exponent++;
  }
  while (value < 1 / 16) {
    value *= 16;
    exponent--;
  }
  let mantissa = Math.round(value * 2 ** 56);
  if (mantissa >= 2 ** 56) {
    mantissa /= 16;
    exponent++;
  }
  view.setUint8(offset, sign | ((exponent + 64) & 0x7f));
  for (let i = 7; i >= 1; i--) {
    view.setUint8(offset + i, mantissa % 256);
    mantissa = Math.floor(mantissa / 256);
  }
}
