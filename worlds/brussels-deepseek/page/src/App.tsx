// The page: three.js canvas + Mantine shell. Policy view by default, analyst drawer,
// bottom dock with the timeline, the main adoption chart, declared outputs and the legend.
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { ActionIcon, Badge, Button, Divider, Drawer, Group, MantineProvider, Progress, ScrollArea, SegmentedControl, Select, Slider, Stack, Switch, Text, Tooltip } from '@mantine/core';
import { IconInfoCircle, IconLayersSubtract, IconPlayerPause, IconPlayerPlay, IconRefresh, IconRotateClockwise, IconZoomIn, IconZoomOut, IconChartLine } from '@tabler/icons-react';
import info from 'virtual:page';
import { createWorld, type World } from './scene/index.ts';
import { UI_TOKENS, oklch } from './scene/palette.ts';
import { LEGEND } from './scene/data.ts';
import { makeTheme, cssVars } from './theme.ts';

const SEED = 1001;
const TOKENS = UI_TOKENS;
const Q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
const SNAPSHOT = !!Q?.has('snapshot');
const DEV = Q?.get('dev') === '1';
const SNAP_TICK = Q?.has('t') ? Math.max(0, Number(Q.get('t')) || 0) : 270;  // categorical state has IQR 0; contract fallback 0.75 x horizon
const M_PER_TICK = 4;                                                        // playback: 4 months a second
const QCOLOURS = [oklch(0.50, 0.09, 255), oklch(0.58, 0.10, 240), oklch(0.66, 0.10, 222), oklch(0.72, 0.09, 200), oklch(0.76, 0.08, 185)];

type Description = any;

function worldOf() {
  const structures = info.scene.structures?.length ? info.scene.structures : info.scene.buildings;
  const [w, h] = info.scene.area.extent_m;
  return {
    spec: 1,
    frame: { units: 'm', extent: [0, 0, w, h], north_deg: 0 },
    source: info.scene.area,
    layers: { buildings: structures, roads: info.scene.roads, landuse: info.scene.landuse, trees: info.scene.trees ?? [] },
    networks: { roads: { nodes: [], edges: [] } },
    regions: {},
  };
}

function defaults(d: Description): Record<string, number | string | boolean> {
  const p: Record<string, number | string | boolean> = {};
  for (const [k, s] of Object.entries<any>(d.params)) p[k] = s.default;
  return p;
}

const GROUPS = ['Policy', 'Finance', 'Households', 'Behaviour', 'Costs', 'Run'];
const fmt = (v: number | undefined, unit: string | undefined) => {
  if (v === undefined || Number.isNaN(v)) return 'no data';
  if (unit === '€') {
    if (Math.abs(v) >= 1e6) return `€${(v / 1e6).toFixed(2)}M`;
    if (Math.abs(v) >= 1e3) return `€${(v / 1e3).toFixed(0)}k`;
    return `€${v.toFixed(0)}`;
  }
  if (unit === 'share of units') return `${(v * 100).toFixed(1)} %`;
  if (unit === 'units' || unit === 'buildings' || unit === 'households' || unit === 'votes' || unit === 'measures') return Math.round(v).toLocaleString('en-GB');
  if (unit === 'hours') return `${v.toFixed(1)} h`;
  return Number(v).toFixed(2);
};

function Spark({ values }: { values: number[] }) {
  const clean = values.filter((v) => Number.isFinite(v));
  if (clean.length < 2) return <div className="pd-spark-empty" />;
  const min = Math.min(...clean), max = Math.max(...clean);
  const span = max - min || 1;
  const pts = clean.map((v, i) => `${(i / (clean.length - 1)) * 100},${24 - ((v - min) / span) * 20}`).join(' ');
  return (
    <svg className="pd-spark" viewBox="0 0 100 26" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={pts} fill="none" stroke="var(--pd-accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function AdoptionChart({ history, horizon, tick }: { history: Record<string, number[]>; horizon: number; tick: number }) {
  const W = 560, H = 150, L = 34, R = 8, T = 10, B = 24;
  const n = history['adoption:Q1']?.length ?? 0;
  const x = (i: number) => L + (i / Math.max(1, horizon)) * (W - L - R);
  const y = (v: number) => T + (1 - Math.max(0, Math.min(1, v))) * (H - T - B);
  const paths = ['Q1', 'Q2', 'Q3', 'Q4', 'Q5'].map((q, qi) => {
    const vals = history[`adoption:${q}`] ?? [];
    const pts = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' L ');
    return { q, qi, d: pts ? `M ${pts}` : '' };
  });
  return (
    <svg className="pd-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby="chartTitle chartDesc">
      <title id="chartTitle">Share of units retrofitted by income quintile</title>
      <desc id="chartDesc">Five lines, Q1 lowest income to Q5 highest, from month 0 to month {horizon}. Values are the model's declared adoption-by-quintile series.</desc>
      {[0, 0.25, 0.5, 0.75, 1].map((v) => (
        <g key={v}>
          <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--pd-line)" strokeWidth="1" />
          <text x={L - 6} y={y(v) + 3} textAnchor="end" className="pd-chart-tick">{(v * 100).toFixed(0)}%</text>
        </g>
      ))}
      {[0, 90, 180, 270, 360].filter((t) => t <= horizon).map((t) => (
        <text key={t} x={x(t)} y={H - 6} textAnchor="middle" className="pd-chart-tick">{t}</text>
      ))}
      {paths.map((p) => p.d ? <path key={p.q} d={p.d} fill="none" stroke={QCOLOURS[p.qi]} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" /> : null)}
      <line x1={x(tick)} x2={x(tick)} y1={T} y2={H - B} stroke="var(--pd-text)" strokeWidth="1" strokeDasharray="2 3" opacity="0.55" />
      <text x={W - R} y={T + 9} textAnchor="end" className="pd-chart-tick">month</text>
    </svg>
  );
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const kitRef = useRef<World | null>(null);
  const [lens, setLens] = useState(Q?.get('lens') === '1');
  const modelRef = useRef<any>(null);
  const runRef = useRef<any>(null);
  const historyRef = useRef<Record<string, number[]>>({});
  const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const playingRef = useRef(!reduced && !SNAPSHOT);
  const [playing, setPlaying] = useState(!reduced && !SNAPSHOT);
  const [desc, setDesc] = useState<Description | null>(null);
  const [params, setParams] = useState<Record<string, any>>({});
  const [tick, setTick] = useState(0);
  const [series, setSeries] = useState<Record<string, number[]>>({});
  const [analyst, setAnalyst] = useState(false);
  const [showAssumptions, setShowAssumptions] = useState(false);
  const [frameError, setFrameError] = useState<string | null>(null);
  const scenarios = (info.binding.scenarios ?? []) as any[];
  const [scenario, setScenario] = useState<string>(scenarios[0]?.id ?? '');
  const [chartVersion, setChartVersion] = useState(0);

  useEffect(() => { document.title = info.title; }, []);

  const pushHistory = useCallback((s: Record<string, number[]>) => {
    for (const [name, vals] of Object.entries(s)) {
      vals.forEach((v, i) => {
        const k = `${name}:${i}`;
        const h = historyRef.current[k] ?? (historyRef.current[k] = []);
        h.push(v);
        if (h.length > 400) h.shift();
      });
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const url = URL.createObjectURL(new Blob([info.modelBundle], { type: 'text/javascript' }));
      const mod = await import(/* @vite-ignore */ url);
      if (cancelled) return;
      modelRef.current = mod.default;
      const d = mod.default.describe();
      setDesc(d);
      const p = defaults(d);
      setParams(p);
      runRef.current = mod.default.start({ params: p, scenario: [], world: worldOf(), data: {}, seed: SEED });
      historyRef.current = {};
      pushHistory(runRef.current.frame.series);
      setSeries({ ...runRef.current.frame.series });
      setChartVersion((v) => v + 1);
    })().catch((e) => setFrameError(String(e?.message ?? e)));
    return () => { cancelled = true; };
  }, [pushHistory]);

  useEffect(() => {
    if (!desc || !canvasRef.current) return;
    const kit = createWorld(canvasRef.current, info.scene, { binding: info.binding, snapshot: SNAPSHOT, reduced, query: Q });
    kitRef.current = kit;
    kit.resize(canvasRef.current.clientWidth, canvasRef.current.clientHeight);
    if (SNAPSHOT && runRef.current) {
      for (let i = 0; i < SNAP_TICK && !runRef.current.done; i += 1) runRef.current.step();
      setTick(runRef.current.frame.t);
    }
    kit.update(runRef.current?.frame ?? null);

    let raf = 0, last = performance.now(), acc = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      const run = runRef.current;
      if (playingRef.current && run && !run.done) {
        acc += dt * M_PER_TICK;
        const n = Math.floor(acc);
        if (n >= 1) {
          try {
            for (let i = 0; i < n && !run.done; i += 1) run.step();
            const f = run.frame;
            kit.update(f);
            pushHistory(f.series);
            setTick(f.t);
            setSeries({ ...f.series });
            setChartVersion((v) => v + 1);
          } catch (e: any) {
            setFrameError(String(e?.message ?? e));
            playingRef.current = false; setPlaying(false);
          }
          acc -= n;
        }
      }
    };
    raf = requestAnimationFrame(loop);
    const ro = new ResizeObserver(() => {
      if (canvasRef.current) kit.resize(canvasRef.current.clientWidth, canvasRef.current.clientHeight);
    });
    ro.observe(canvasRef.current);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); kit.destroy(); };
  }, [desc, pushHistory, reduced]);

  const startRun = useCallback((next: Record<string, any>, scenarioId: string, applyScenario: boolean) => {
    if (!modelRef.current) return;
    const sc = scenarios.find((s) => s.id === scenarioId);
    const effective = applyScenario ? { ...defaults(desc), ...(sc?.params ?? {}) } : { ...defaults(desc), ...next };
    try {
      runRef.current = modelRef.current.start({ params: effective, scenario: [], world: worldOf(), data: {}, seed: SEED });
      setFrameError(null);
    } catch (e: any) {
      setFrameError(String(e?.message ?? e));
      return;
    }
    setParams(effective);
    historyRef.current = {};
    pushHistory(runRef.current.frame.series);
    setTick(0);
    setSeries({ ...runRef.current.frame.series });
    setChartVersion((v) => v + 1);
    kitRef.current?.update(runRef.current.frame);
  }, [scenarios, desc, pushHistory]);

  const onScenario = useCallback((id: string) => { setScenario(id); startRun(params, id, true); }, [params, startRun]);
  const restart = useCallback(() => startRun(params, scenario, true), [params, scenario, startRun]);
  const setLever = useCallback((k: string, v: any) => {
    const next = { ...params, [k]: v };
    setParams(next);
    startRun(next, scenario, false);
  }, [params, scenario, startRun]);

  const toggle = useCallback(() => { setPlaying((p) => { playingRef.current = !p; kitRef.current?.setPlaying(!p); return !p; }); }, []);
  const toggleLens = useCallback(() => { setLens((l) => { kitRef.current?.setLens(!l); return !l; }); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return;
      if (e.key === ' ') { e.preventDefault(); toggle(); }
      else if (e.key.toLowerCase() === 'l' && !e.ctrlKey && !e.metaKey && !e.altKey) toggleLens();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle, toggleLens]);

  const look = info.binding.look;
  const top = info.binding.bindings?.[0]?.top_color;
  const rampCss = top?.reverse ? `linear-gradient(270deg, ${LEGEND.stops.join(',')})` : LEGEND.css;
  const domain = top?.domain ?? [0, 2];
  const horizon = desc?.time?.horizon ?? 360;
  const unit = desc?.time?.unit ?? 'months';
  const chips = info.binding.architecture ?? [];
  const outputs: string[] = info.binding.dashboard?.outputs ?? [];
  const edgeList: string[][] = info.binding.causal_graph?.confirmed ? info.binding.causal_graph.edges ?? [] : [];
  const paramEntries = Object.entries<any>(desc?.params ?? {});
  const levers = paramEntries.filter(([, s]) => s.tier !== 'structural' && s.tier !== 'assumption');
  const assumptions = paramEntries.filter(([, s]) => s.tier === 'assumption' || s.tier === 'structural');

  const control = ([k, s]: [string, any]) => {
    if (s.type === 'number' || s.type === 'integer') {
      return (
        <div className="pd-control" key={k}>
          <div className="pd-control-head">
            <span>{s.label ?? k}</span>
            <span className="pd-value">{Number(params[k]).toFixed(s.step && s.step < 1 ? 2 : 0)}{s.unit ? ` ${s.unit}` : ''}</span>
          </div>
          <Slider
            value={Number(params[k])} min={s.min} max={s.max} step={s.step ?? 1}
            onChange={(v) => setParams((p) => ({ ...p, [k]: v }))}
            onChangeEnd={(v) => setLever(k, v)}
            disabled={s.tier === 'structural'}
            aria-label={s.label ?? k} size="sm"
          />
        </div>
      );
    }
    if (s.type === 'boolean') {
      return (
        <div className="pd-control pd-control-row" key={k}>
          <span>{s.label ?? k}</span>
          <Switch size="xs" checked={!!params[k]} onChange={(e) => setLever(k, e.currentTarget.checked)} aria-label={s.label ?? k} />
        </div>
      );
    }
    if (s.type === 'choice') {
      return (
        <div className="pd-control" key={k}>
          <div className="pd-control-head"><span>{s.label ?? k}</span></div>
          <Select
            size="xs" value={String(params[k])} onChange={(v) => v && setLever(k, v)}
            data={s.values.map((c: any) => ({ label: c.label ?? c.value, value: c.value }))}
            allowDeselect={false} aria-label={s.label ?? k}
          />
        </div>
      );
    }
    return null;
  };

  if (SNAPSHOT) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: TOKENS.bg }}>
        <canvas ref={canvasRef} className="pd-canvas" tabIndex={0} style={{ width: '100vw', height: '100vh' }} aria-label={`Snapshot map of ${info.title}`} />
      </div>
    );
  }

  return (
    <MantineProvider theme={makeTheme(TOKENS)} forceColorScheme="light">
      <div className="pd-root" style={cssVars(TOKENS) as CSSProperties}>
        <div className="pd-main">
          <div className="pd-canvas-wrap">
            <canvas
              ref={canvasRef} className="pd-canvas" tabIndex={0}
              aria-label={`Interactive isometric map of ${info.title}. Drag or use A and D to pan; scroll or use W and S to zoom; F to fit; R to rotate; L for the data lens.`}
            />

            <div className="pd-float pd-worldcard">
              <div className="pd-eyebrow">Model world</div>
              <div className="pd-title">{info.title}</div>
              <Group gap={6} mt={7} wrap="nowrap">
                <Badge size="sm" radius="sm" variant="filled" tt="none">{look}</Badge>
                <Badge size="sm" radius="sm" variant="default" tt="none">{info.binding.family} · {info.binding.region}</Badge>
                <Badge size="sm" radius="sm" variant="outline" tt="none">model, not forecast</Badge>
              </Group>
            </div>

            <Group gap={8} className="pd-float pd-cam">
              <Tooltip label="Zoom in (W)"><ActionIcon size="lg" aria-label="Zoom in" onClick={() => kitRef.current?.zoom(1.2)}><IconZoomIn size={17} stroke={1.6} /></ActionIcon></Tooltip>
              <Tooltip label="Zoom out (S)"><ActionIcon size="lg" aria-label="Zoom out" onClick={() => kitRef.current?.zoom(1 / 1.2)}><IconZoomOut size={17} stroke={1.6} /></ActionIcon></Tooltip>
              <Tooltip label="Fit the municipality (F)"><ActionIcon size="lg" aria-label="Fit map" onClick={() => kitRef.current?.fit()}><IconRefresh size={17} stroke={1.6} /></ActionIcon></Tooltip>
              <Tooltip label="Rotate 90° (E / R; Q back)"><ActionIcon size="lg" aria-label="Rotate 90 degrees" onClick={() => kitRef.current?.rotate()}><IconRotateClockwise size={17} stroke={1.6} /></ActionIcon></Tooltip>
              <Tooltip label={lens ? 'Data lens on (L)' : 'Data lens off (L)'}><ActionIcon size="lg" aria-label="Toggle data lens" aria-pressed={lens} variant={lens ? 'filled' : 'default'} onClick={toggleLens}><IconLayersSubtract size={17} stroke={1.6} /></ActionIcon></Tooltip>
              <Tooltip label="About this model"><ActionIcon size="lg" aria-label="About" onClick={() => setAnalyst(true)}><IconInfoCircle size={17} stroke={1.6} /></ActionIcon></Tooltip>
            </Group>

            {!playing ? <div className="pd-paused">Paused</div> : null}
            {frameError ? <div className="pd-error" role="alert">Model error: {frameError}</div> : null}
            {DEV ? <DevPanel /> : null}
          </div>

          <aside className="pd-side">
            <div className="pd-side-head">Controls</div>
            <ScrollArea h="100%">
              <div className="pd-side-body">
                <Text size="xs" c="dimmed" lh={1.5}>{info.description}</Text>
                <Text size="xs" c="dimmed" mt={6} lh={1.4}>Every number in this model is a placeholder. It is a model run, not a forecast.</Text>
                <Divider my={12} />
                {scenarios.length ? (
                  <>
                    <div className="pd-panel-head" style={{ marginBottom: 8 }}>Scenario</div>
                    <Select
                      size="xs" value={scenario} onChange={(v) => v && onScenario(v)}
                      data={scenarios.map((s) => ({ value: s.id, label: s.label }))}
                      aria-label="Scenario" allowDeselect={false}
                    />
                    <Group mt={10} gap={8}>
                      <Button size="xs" variant="default" onClick={restart} leftSection={<IconRefresh size={14} />}>Reset run</Button>
                    </Group>
                  </>
                ) : null}
                <Divider my={12} />
                <div className="pd-panel-head" style={{ marginBottom: 4 }}>Levers</div>
                {GROUPS.map((g) => {
                  const rows = levers.filter(([, s]) => (s.group ?? 'Policy') === g);
                  if (!rows.length) return null;
                  return <div key={g} className="pd-group"><div className="pd-group-head">{g}</div>{rows.map(control)}</div>;
                })}
                <Divider my={12} />
                <Group justify="space-between" align="center">
                  <div className="pd-panel-head" style={{ margin: 0 }}>Assumptions</div>
                  <Switch size="xs" checked={showAssumptions} onChange={(e) => setShowAssumptions(e.currentTarget.checked)} aria-label="Show assumption parameters" />
                </Group>
                {showAssumptions ? (
                  <>
                    <Text size="xs" c="dimmed" mt={4} mb={6} lh={1.45}>Labelled guesses. Moving one starts a new run from month 0 with the same seed.</Text>
                    {GROUPS.map((g) => {
                      const rows = assumptions.filter(([, s]) => (s.group ?? 'Policy') === g);
                      if (!rows.length) return null;
                      return <div key={g} className="pd-group"><div className="pd-group-head">{g}</div>{rows.map(control)}</div>;
                    })}
                  </>
                ) : null}
                <div className="pd-note">
                  People, vehicles, smoke, birds and most trees are decoration. The church is a real structure whose spire is emphasised;
                  storeys and unit counts are guessed where OSM is silent. The palette is a proposal. Ridge or coping shows the retrofit state;
                  the teal pennant shows a passed shared measure; the pale sage cladding counts the completed storeys.
                </div>
                <div className="pd-credit">
                  <strong>{info.binding.family.toUpperCase()} · {info.binding.region.toUpperCase()} · {info.binding.palette_look ?? ''}</strong><br />
                  Model: {info.binding.model_licence ?? 'not declared'}<br />
                  Map: © OpenStreetMap contributors (ODbL)<br />
                  paperdolls · CC BY 4.0, Sci-Fi Economics Lab<br />
                  Colour-figure concept after Colorfigures, April Zhu (MIT)
                </div>
              </div>
            </ScrollArea>
          </aside>
        </div>

        <div className="pd-dock">
          <div className="pd-timeline">
            <div className="pd-panel-head">Time</div>
            <div className="pd-timeline-row">
              <ActionIcon size="lg" aria-label={playing ? 'Pause' : 'Play'} onClick={toggle} variant="filled">
                {playing ? <IconPlayerPause size={17} /> : <IconPlayerPlay size={17} />}
              </ActionIcon>
              <div>
                <div className="pd-tick">{tick} / {horizon}</div>
                <div className="pd-unit">{unit}</div>
              </div>
            </div>
            <Progress value={horizon ? (tick / horizon) * 100 : 0} size="sm" radius="xl" aria-label="Timeline" />
            <div className="pd-unit">4 months a second</div>
          </div>

          <div className="pd-chart-panel">
            <Group justify="space-between" align="baseline" mb={4}>
              <div className="pd-panel-head" style={{ margin: 0 }}><IconChartLine size={13} stroke={1.6} /> Adoption by income quintile</div>
              <div className="pd-chart-key">
                {['Q1', 'Q2', 'Q3', 'Q4', 'Q5'].map((q, i) => <span key={q}><i style={{ background: QCOLOURS[i] }} />{q}</span>)}
              </div>
            </Group>
            <AdoptionChart history={historyRef.current} horizon={horizon} tick={tick} />
            <div className="pd-unit">Share of units fully retrofitted, Q1 lowest income to Q5 highest. Values are the model's declared series.</div>
            <details className="pd-table-fallback">
              <summary>Data table</summary>
              <table>
                <thead><tr><th>Month</th>{['Q1', 'Q2', 'Q3', 'Q4', 'Q5'].map((q) => <th key={q}>{q}</th>)}</tr></thead>
                <tbody>
                  {[0, Math.round(horizon / 4), Math.round(horizon / 2), Math.round((3 * horizon) / 4), horizon].filter((t, i, a) => a.indexOf(t) === i).map((t) => (
                    <tr key={t}><td>{t}</td>{['Q1', 'Q2', 'Q3', 'Q4', 'Q5'].map((q) => <td key={q}>{(historyRef.current[`adoption:${q}`]?.[t] * 100).toFixed(1)}%</td>)}</tr>
                  ))}
                </tbody>
              </table>
              <span className="pd-visually-hidden">{chartVersion}</span>
            </details>
          </div>

          <div>
            <div className="pd-panel-head">Declared outputs</div>
            <div className="pd-stats">
              {outputs.flatMap((name) => {
                const s = desc?.series?.[name];
                if (!s) return [];
                return (s.y as string[]).map((pen, i) => {
                  const vals = historyRef.current[`${name}:${i}`] ?? [];
                  const latest = series[name]?.[i];
                  return (
                    <div className="pd-stat" key={name + pen}>
                      <div className="pd-stat-label" title={s.label ? String(s.label) : name}>{s.label ? `${s.label}` : name}</div>
                      <div className="pd-stat-value">{fmt(latest, s.unit)}</div>
                      <Spark values={vals} />
                    </div>
                  );
                });
              })}
            </div>
          </div>

          <div>
            <div className="pd-panel-head">Legend</div>
            {top ? (
              <>
                <div className="pd-legend-row">
                  <svg className="pd-roof-icon" viewBox="0 0 40 24" aria-hidden="true">
                    <polygon points="4,20 20,6 36,20" fill="#4b5158" />
                    <rect x="16" y="3.5" width="8" height="3.5" fill={LEGEND.stops[2]} />
                    <rect x="6" y="20" width="28" height="3" fill="var(--pd-line)" />
                  </svg>
                  <div style={{ flex: 1 }}>
                    <div className="pd-ramp" style={{ background: rampCss }} />
                    <div className="pd-ramp-labels"><span>no unit</span><span>{top.label ?? top.field}</span><span>all units</span></div>
                  </div>
                </div>
                <div className="pd-unit">{lens ? 'Data lens: whole roofs and upper walls.' : 'Ridge cap or coping band; press L for the data lens.'}</div>
              </>
            ) : null}
            {chips.map((a: any) => {
              const sw = a.colour ?? (a.scale?.type === 'categorical' ? Object.values(a.scale.palette ?? {})[0] : a.scale?.ramp?.[0]) ?? 'var(--pd-accent)';
              return <span className="pd-chip" key={a.label}><span className="pd-swatch" style={{ background: sw as string }} />{a.label}</span>;
            })}
            <div className="pd-nodata"><span className="pd-swatch pd-hatch" style={{ backgroundColor: 'var(--pd-nodata)' }} />No data — rental, not modelled</div>
            {edgeList.length ? (
              <details className="pd-impact">
                <summary>Impact (confirmed graph, {edgeList.length} edges)</summary>
                <div className="pd-impact-list">
                  {edgeList.map((e) => <div className="pd-impact-edge" key={e.join('-')}><span>{e[0]}</span><span className="pd-arrow">→</span><span>{e[1]}</span></div>)}
                </div>
              </details>
            ) : null}
          </div>
        </div>
      </div>

      <Drawer opened={analyst} onClose={() => setAnalyst(false)} title="About this world" position="right" size="md" scrollAreaComponent={ScrollArea}>
        <Stack gap={10}>
          <div>
            <Text size="sm" fw={600}>{info.title}</Text>
            <Text size="xs" c="dimmed" mt={4} lh={1.5}>{info.description}</Text>
          </div>
          <Divider />
          <Group justify="space-between"><Text size="xs" c="dimmed">Look</Text><Text size="xs">{look}</Text></Group>
          <Group justify="space-between"><Text size="xs" c="dimmed">World family</Text><Text size="xs">{info.binding.family}</Text></Group>
          <Group justify="space-between"><Text size="xs" c="dimmed">Palette</Text><Text size="xs">{info.binding.region} · {info.binding.palette_look ?? ''}</Text></Group>
          <Group justify="space-between"><Text size="xs" c="dimmed">Model version</Text><Text size="xs">{info.binding.model_version ?? 'not declared'}</Text></Group>
          <Group justify="space-between"><Text size="xs" c="dimmed">Household seed</Text><Text size="xs" ff="monospace">{String(params.seed)}</Text></Group>
          <Group justify="space-between"><Text size="xs" c="dimmed">Scene seed</Text><Text size="xs" ff="monospace">{String(params['scene-seed'])}</Text></Group>
          <Group justify="space-between"><Text size="xs" c="dimmed">Tick</Text><Text size="xs" ff="monospace">{tick} / {horizon} {unit}</Text></Group>
          <Group justify="space-between"><Text size="xs" c="dimmed">Simulation thread</Text><Text size="xs">main thread, about 6 ms a month; not a worker</Text></Group>
          <Divider />
          <Text size="xs" fw={600}>Controls</Text>
          <Group justify="space-between"><Text size="xs" c="dimmed">Pan</Text><Text size="xs">Drag · A / D</Text></Group>
          <Group justify="space-between"><Text size="xs" c="dimmed">Zoom</Text><Text size="xs">Scroll · W / S</Text></Group>
          <Group justify="space-between"><Text size="xs" c="dimmed">Fit / rotate</Text><Text size="xs">F / Q · E (R)</Text></Group>
          <Group justify="space-between"><Text size="xs" c="dimmed">Data lens</Text><Text size="xs">L</Text></Group>
          <Group justify="space-between"><Text size="xs" c="dimmed">Play / pause</Text><Text size="xs">Space</Text></Group>
          <Divider />
          <Text size="xs" fw={600}>Assumptions and provenance</Text>
          <Text size="xs" c="dimmed" lh={1.5}>
            The map is OpenStreetMap relation 58258 (Jette). 9,216 mapped structures; 5,403 dwelling buildings are model agents,
            the rest are context. 98 % of dwelling storeys and 100 % of dwelling unit counts are guesses (unit = 80 m², floor = footprint × storeys × 0.8),
            and 93 % of economic classes are a seeded fallback. The church landmark is real; its raised spire is a choice.
          </Text>
          <Text size="xs" c="dimmed" lh={1.5}>
            Decorative and labelled: traffic, parked cars, pedestrians, chimney smoke, birds, trees outside the mapped set, lamps,
            markings, plot surfaces and the palette. People are paper dolls: one paper tone, garments only.
          </Text>
          <Text size="xs" c="dimmed" lh={1.5}>
            Parity: the TypeScript port was checked against NetLogo 7.0.4 by procedure fixtures and a 200-run ensemble; see
            sim-code/parity.md. Every number in the model is a placeholder, so nothing here is a finding.
          </Text>
          <Text size="xs" c="dimmed">{info.artBibleStatus ? `Art bible: ${info.artBibleStatus.split(' — ')[0]}` : ''}</Text>
          <Text size="xs" c="dimmed">No network at view time. This file is self-contained.</Text>
          <Button
            size="xs" variant="default"
            onClick={() => {
              const blob = new Blob([JSON.stringify({ title: info.title, look, seed: SEED, tick, params, series }, null, 2)], { type: 'application/json' });
              const a = document.createElement('a');
              a.href = URL.createObjectURL(blob);
              a.download = 'series.json';
              a.click();
            }}
          >
            Download raw series
          </Button>
          {DEV ? <Text size="xs" c="dimmed">dev mode: frame checks are on in the model; errors would appear on the canvas.</Text> : null}
        </Stack>
      </Drawer>
    </MantineProvider>
  );
}

function DevPanel() {
  const [v, setV] = useState<any>(null);
  useEffect(() => {
    const id = setInterval(() => {
      const infoFn = (window as any).__paperdollsInfo;
      const rep = (window as any).__paperdollsReport;
      setV({ ...(infoFn ? infoFn() : {}), ...(rep ? { buildMs: rep.buildMs, structures: rep.structures, data: rep.data } : {}) });
    }, 1000);
    return () => clearInterval(id);
  }, []);
  return <div className="pd-dev" role="status">dev · calls {v?.calls ?? '—'} · tris {v?.triangles ? Math.round(v.triangles / 1000) + 'k' : '—'} · build {v?.buildMs ?? '—'} ms · entities {v?.data?.withData ?? '—'} · no data {v?.data?.noData ?? '—'}</div>;
}
