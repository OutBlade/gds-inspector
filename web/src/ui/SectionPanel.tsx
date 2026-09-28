import * as S from "../state";
import { formatLength, niceStep } from "../format";
import { IconClose } from "./icons";

const W = 1000;
const H = 200;

export function SectionPanel() {
  const res = S.sectionResult.value!;
  const line = S.sectionLine.value;
  const byKey = S.layerByKey.value;
  if (!line) return null;
  const len = Math.hypot(line.b[0] - line.a[0], line.b[1] - line.a[1]);
  const rows = res
    .map((r) => ({ r, l: byKey.get(r.key) }))
    .filter((x) => x.l && x.l.visible3d)
    .sort((a, b) => a.l!.z - b.l!.z);
  const flat = res.filter((r) => !byKey.get(r.key)?.visible3d && byKey.get(r.key)?.visible);
  let zMin = 0;
  let zMax = 0;
  for (const { l } of rows) {
    zMin = Math.min(zMin, l!.z);
    zMax = Math.max(zMax, l!.z + l!.t);
  }
  const zr = zMax - zMin || 1;
  const sx = W / (len || 1);
  const sz = (H - 16) / zr;
  const step = niceStep(len / 8);
  const ticks: number[] = [];
  for (let t = 0; t <= len + 1e-9; t += step) ticks.push(t);

  return (
    <section class="section-panel" aria-label="Cross-section">
      <header>
        <b>Cross-section A to B</b>
        <span>
          {formatLength(len)} long, stack height {formatLength(zr)} (vertical scale exaggerated)
        </span>
        <button class="icon-btn" aria-label="Close cross-section" onClick={() => {
          S.sectionResult.value = null;
          S.sectionLine.value = null;
        }}>
          <IconClose />
        </button>
      </header>
      {rows.length === 0 ? (
        <p class="hint">No stacked layer crosses this line. Implant and marker layers are listed below when present.</p>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" class="section-svg" role="img" aria-label="Layer profile along the cut">
          <rect x="0" y="0" width={W} height={H} class="sec-bg" />
          {ticks.map((t) => (
            <line x1={t * sx} x2={t * sx} y1="0" y2={H} class="sec-grid" />
          ))}
          {rows.map(({ r, l }) => {
            const y = H - 8 - (l!.z + l!.t - zMin) * sz;
            const h = Math.max(l!.t * sz, 1.5);
            const out = [];
            for (let i = 0; i < r.spans.length; i += 2) {
              out.push(
                <rect x={r.spans[i] * sx} y={y} width={Math.max((r.spans[i + 1] - r.spans[i]) * sx, 0.8)} height={h} fill={l!.color} fill-opacity="0.85">
                  <title>
                    {l!.name}: {formatLength(r.spans[i])} to {formatLength(r.spans[i + 1])}
                  </title>
                </rect>,
              );
            }
            return <g>{out}</g>;
          })}
        </svg>
      )}
      <div class="sec-axis">
        {ticks.map((t) => (
          <span style={{ left: `${(t / (len || 1)) * 100}%` }}>{formatLength(t)}</span>
        ))}
      </div>
      <div class="sec-legend">
        {rows.map(({ l }) => (
          <span>
            <i style={{ background: l!.color }} />
            {l!.name}
          </span>
        ))}
        {flat.length > 0 && <span class="muted">also crossed: {flat.map((r) => byKey.get(r.key)?.name).join(", ")}</span>}
      </div>
    </section>
  );
}
