/** Formats a length given in µm with a unit that keeps 3 to 4 significant digits. */
export function formatLength(um: number, digits = 3): string {
  const a = Math.abs(um);
  if (a === 0) return "0";
  if (a >= 1000) return `${trim(um / 1000, digits)} mm`;
  if (a >= 1) return `${trim(um, digits)} µm`;
  return `${trim(um * 1000, digits)} nm`;
}

export function formatNm(nm: number): string {
  return formatLength(nm / 1000);
}

function trim(v: number, digits: number) {
  const a = Math.abs(v);
  const d = a >= 100 ? Math.max(0, digits - 3) : a >= 10 ? Math.max(0, digits - 2) : Math.max(0, digits - 1);
  return Number(v.toFixed(d + 1)).toLocaleString("en-US", { maximumFractionDigits: d + 1 });
}

export function formatArea(um2: number): string {
  const a = Math.abs(um2);
  if (a === 0) return "0";
  if (a >= 1e6) return `${(um2 / 1e6).toPrecision(4)} mm²`;
  if (a >= 0.01) return `${Number(um2.toPrecision(4)).toLocaleString("en-US")} µm²`;
  return `${Number((um2 * 1e6).toPrecision(4)).toLocaleString("en-US")} nm²`;
}

export function formatCount(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} G`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)} M`;
  if (n >= 1e4) return `${(n / 1e3).toFixed(1)} k`;
  return n.toLocaleString("en-US");
}

export function formatBytes(b: number): string {
  if (b >= 1 << 30) return `${(b / (1 << 30)).toFixed(2)} GB`;
  if (b >= 1 << 20) return `${(b / (1 << 20)).toFixed(1)} MB`;
  if (b >= 1 << 10) return `${(b / (1 << 10)).toFixed(1)} kB`;
  return `${b} B`;
}

export function formatDuration(s: number): string {
  if (!Number.isFinite(s)) return "n/a";
  if (s < 1) return `${(s * 1000).toFixed(0)} ms`;
  if (s < 120) return `${s.toFixed(1)} s`;
  if (s < 7200) return `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
  return `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`;
}

export function formatPercent(v: number, digits = 2): string {
  return `${v.toFixed(digits)} %`;
}

/** 1, 2 or 5 times a power of ten, not smaller than v. */
export function niceStep(v: number): number {
  if (!(v > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const m = v / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}

export function formatCoord(um: number): string {
  return um.toFixed(3);
}
