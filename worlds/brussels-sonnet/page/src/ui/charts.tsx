import { useMemo, useState } from 'react';
import { T } from './theme';

export interface Line { name: string; values: number[]; color: string; dashed?: boolean }
const fmt = (v: number, unit?: string) => { if (!Number.isFinite(v)) return 'no data'; const a = Math.abs(v); const s = a >= 1e6 ? (v / 1e6).toFixed(2) + ' M' : a >= 1e4 ? Math.round(v / 1e3) + ' k' : a >= 100 ? Math.round(v).toString() : a >= 1 ? v.toFixed(1) : v.toFixed(3); return unit ? `${s} ${unit}` : s; };
export { fmt };

/** One question, one chart: values over time. Zero baseline; NaN breaks the line (never drawn as zero); direct labels at the line ends; the cursor reads values. */
export function LineChart({ lines, horizon, tick, unit, xUnit, height = 150, title, desc }: { lines: Line[]; horizon: number; tick: number; unit?: string; xUnit: string; height?: number; title: string; desc: string }) {
  const W = 560, H = height, L = 44, R = 46, Tp = 8, Bt = 22; const [hover, setHover] = useState<number | null>(null);
  const all = lines.flatMap((l) => l.values.filter(Number.isFinite)); const ymax = Math.max(1e-9, ...all) * 1.08; const ymin = Math.min(0, ...all);
  const x = (t: number) => L + (t / horizon) * (W - L - R), y = (v: number) => Tp + (1 - (v - ymin) / (ymax - ymin)) * (H - Tp - Bt);
  const path = (l: Line) => { let d = '', pen = false; l.values.forEach((v, t) => { if (!Number.isFinite(v)) { pen = false; return; } d += `${pen ? 'L' : 'M'}${x(t).toFixed(1)} ${y(v).toFixed(1)}`; pen = true; }); return d; };
  const ticks = useMemo(() => { const n = 4; return Array.from({ length: n + 1 }, (_, i) => ymin + ((ymax - ymin) * i) / n); }, [ymin, ymax]);
  const xt = useMemo(() => { const step = horizon > 120 ? 60 : horizon > 36 ? 12 : 6; const a: number[] = []; for (let t = 0; t <= horizon; t += step) a.push(t); return a; }, [horizon]);
  const ht = hover ?? Math.min(tick, lines[0] ? lines[0].values.length - 1 : 0);
  return (
    <svg role="img" aria-label={title} viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ display: 'block' }}
      onPointerMove={(e) => { const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect(); const px = ((e.clientX - r.left) / r.width) * W; setHover(Math.max(0, Math.min(horizon, Math.round(((px - L) / (W - L - R)) * horizon)))); }} onPointerLeave={() => setHover(null)}>
      <title>{title}</title><desc>{desc}</desc>
      {ticks.map((tv, i) => (<g key={i}><line x1={L} x2={W - R} y1={y(tv)} y2={y(tv)} stroke={T.line} strokeWidth={1} /><text x={L - 6} y={y(tv) + 3} textAnchor="end" fontSize={10} fill={T.dim} fontFamily="ui-monospace, monospace">{fmt(tv)}</text></g>))}
      {xt.map((t) => (<text key={t} x={x(t)} y={H - 6} textAnchor="middle" fontSize={10} fill={T.dim} fontFamily="ui-monospace, monospace">{t}</text>))}
      <text x={W - R + 4} y={H - 6} fontSize={10} fill={T.dim}>{xUnit}</text>
      <line x1={x(ht)} x2={x(ht)} y1={Tp} y2={H - Bt} stroke={T.accent} strokeWidth={1} opacity={0.6} />
      {lines.map((l) => (<path key={l.name} d={path(l)} fill="none" stroke={l.color} strokeWidth={l.dashed ? 1.5 : 2} strokeDasharray={l.dashed ? '4 3' : undefined} />))}
      {lines.map((l) => { const lastT = (() => { for (let t = l.values.length - 1; t >= 0; t--) if (Number.isFinite(l.values[t])) return t; return -1; })(); if (lastT < 0 || l.dashed) return null; return (<text key={'t' + l.name} x={x(lastT) + 5} y={y(l.values[lastT]) + 3} fontSize={10} fill={l.color}>{l.name}</text>); })}
      {lines.filter((l) => !l.dashed).map((l) => { const v = l.values[ht]; if (v === undefined) return null; return Number.isFinite(v) ? <circle key={'c' + l.name} cx={x(ht)} cy={y(v)} r={3} fill={l.color} /> : null; })}
    </svg>
  );
}

export function Spark({ values, w = 96, h = 22, color }: { values: number[]; w?: number; h?: number; color?: string }) {
  const f = values.filter(Number.isFinite); if (!f.length) return <svg width={w} height={h} aria-hidden="true" />;
  const mx = Math.max(1e-9, ...f), mn = Math.min(0, ...f); const x = (t: number) => (t / Math.max(1, values.length - 1)) * (w - 2) + 1, y = (v: number) => h - 2 - ((v - mn) / (mx - mn)) * (h - 4);
  let d = '', pen = false; values.forEach((v, t) => { if (!Number.isFinite(v)) { pen = false; return; } d += `${pen ? 'L' : 'M'}${x(t).toFixed(1)} ${y(v).toFixed(1)}`; pen = true; });
  return <svg width={w} height={h} aria-hidden="true"><path d={d} fill="none" stroke={color ?? T.accent} strokeWidth={1.5} /></svg>;
}
