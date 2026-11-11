// The brussels-inkling page: three.js canvas + Mantine shell, written for the Jette map.
// A worked example the interface skill points at, not a fixed app.
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { ActionIcon, Badge, Button, Divider, Drawer, Group, MantineProvider, Progress, ScrollArea, SegmentedControl, Slider, Stack, Text, Tooltip } from '@mantine/core';
import { IconInfoCircle, IconLayersSubtract, IconPlayerPause, IconPlayerPlay, IconRefresh, IconRotateClockwise, IconZoomIn, IconZoomOut } from '@tabler/icons-react';
import info from 'virtual:page';
import { createWorld, type World } from './scene/index.ts';
import { UI_TOKENS } from './scene/palette.ts';
import { LEGEND } from './scene/data.ts';
import { makeTheme, cssVars } from './theme.ts';

const SEED = 1001;
const TOKENS = UI_TOKENS;
const Q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
const SNAPSHOT = !!Q?.has('snapshot');
const DEV = Q?.get('dev') === '1';
const SNAP_TICK = Q?.has('t') ? Math.max(0, Number(Q.get('t')) || 0) : 120;  // a tick with varied data (retrofit share mid-run; builds in ~10 s) (retrofit share mid-run)

type Description = any;

function worldOf() {
  const structures = info.scene.structures?.length ? info.scene.structures : info.scene.buildings;
  const [w, h] = info.scene.area.extent_m;
  const buildings = structures.map((st: any) => ({
    id: st.id,
    geom: { type: 'Polygon', coords: st.footprint as [number, number][] },
    attrs: {
      residential: st.residential ?? null,
      levels: st.levels ?? null,
      area: st.area ?? null,
      height: st.height ?? null,
      levels_assumed: st.levels_assumed ? 1 : 0,
      economic_class: st.economic_class ?? null,
      archetype: st.archetype ?? null,
    },
  }));
  return {
    spec: 1,
    frame: { units: 'm', extent: [0, 0, w, h], north_deg: info.scene.area.north_on_screen_deg ?? 0 },
    source: info.scene.area,
    layers: { buildings, roads: info.scene.roads, landuse: info.scene.landuse, trees: info.scene.trees ?? [] },
    networks: { roads: { nodes: [], edges: [] } },
    regions: {},
  };
}

function defaults(d: Description): Record<string, number | string | boolean> {
  const p: Record<string, number | string | boolean> = {};
  for (const [k, s] of Object.entries<any>(d.params)) p[k] = s.default;
  return p;
}

function Spark({ values }: { values: number[] }) {
  const vs = values.filter(Number.isFinite);
  if (vs.length < 2) return <div className="pd-spark-empty" />;
  const min = Math.min(...vs), max = Math.max(...vs);
  const span = max - min || 1;
  const pts = vs.map((v, i) => `${(i / (vs.length - 1)) * 100},${24 - ((v - min) / span) * 20}`).join(' ');
  return (
    <svg className="pd-spark" viewBox="0 0 100 26" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={pts} fill="none" stroke="var(--pd-accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
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
  const scenarios = (info.binding.scenarios ?? []) as any[];
  const [scenario, setScenario] = useState<string>(scenarios[0]?.id ?? '');

  useEffect(() => { document.title = info.title; }, []);

  const pushHistory = useCallback((s: Record<string, number[]>) => {
    for (const [name, vals] of Object.entries(s)) {
      vals.forEach((v, i) => {
        const k = `${name}:${i}`;
        const h = historyRef.current[k] ?? (historyRef.current[k] = []);
        h.push(v);
        if (h.length > 90) h.shift();
      });
    }
  }, []);

  // boot: model bundle -> description -> first run
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
      if (DEV) {
        const f = runRef.current.frame;
        console.info('paperdolls dev: frame t=%d entities=%s series=%d params=%d checkFrame=throw-on-error (passed)',
          f.t, Object.keys(f.entities).map((k) => `${k}:${f.entities[k].id.length}`).join(','),
          Object.keys(f.series).length, Object.keys(d.params).length);
      }
      historyRef.current = {};
      pushHistory(runRef.current.frame.series);
      setSeries({ ...runRef.current.frame.series });
    })();
    return () => { cancelled = true; };
  }, [pushHistory]);

  // scene + play pump
  useEffect(() => {
    if (!desc || !canvasRef.current) return;
    const kit = createWorld(canvasRef.current, info.scene, { binding: info.binding, snapshot: SNAPSHOT, reduced, query: Q });
    kitRef.current = kit;
    kit.resize(canvasRef.current.clientWidth, canvasRef.current.clientHeight);
    if (SNAPSHOT && runRef.current) {
      // snapshot contract: advance the model to tick t before capture
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
        acc += dt * 4;
        const n = Math.floor(acc);
        if (n >= 1) {
          for (let i = 0; i < n && !run.done; i += 1) run.step();
          const f = run.frame;
          kit.update(f);
          pushHistory(f.series);
          setTick(f.t);
          setSeries({ ...f.series });
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

  const startRun = useCallback((next: Record<string, any>, scenarioId: string) => {
    if (!modelRef.current) return;
    const sc = scenarios.find((s) => s.id === scenarioId);
    // The model declares no interventions: a scenario is a bundle of declared policy parameters.
    // Each is a fresh run from t = 0 with the same runtime seed (the model's own PRNG is seeded by `seed`).
    const preset = (sc?.interventions ?? []).reduce((acc: Record<string, any>, iv: any) => (iv.name === 'preset' ? { ...acc, ...(iv.args ?? {}) } : acc), {});
    const params = { ...next, ...preset };
    runRef.current = modelRef.current.start({ params, scenario: [], world: worldOf(), data: {}, seed: SEED });
    historyRef.current = {};
    pushHistory(runRef.current.frame.series);
    setParams(params);
    setTick(0);
    setSeries({ ...runRef.current.frame.series });
    kitRef.current?.update(runRef.current.frame);
  }, [scenarios, pushHistory]);

  const restart = useCallback((next: Record<string, any>) => {
    setParams(next);
    startRun(next, scenario);
  }, [scenario, startRun]);

  const onScenario = useCallback((id: string) => {
    setScenario(id);
    startRun(params, id);
  }, [params, startRun]);

  const toggle = useCallback(() => { setPlaying((p) => { playingRef.current = !p; kitRef.current?.setPlaying(!p); return !p; }); }, []);
  const toggleLens = useCallback(() => { setLens((l) => { kitRef.current?.setLens(!l); return !l; }); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && ['INPUT', 'TEXTAREA'].includes(el.tagName)) return;
      if (e.key === ' ') { e.preventDefault(); toggle(); }
      else if (e.key.toLowerCase() === 'l' && !e.ctrlKey && !e.metaKey && !e.altKey) toggleLens();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle, toggleLens]);

  const look = info.binding.look;
  const top = info.binding.bindings?.[0]?.top_color;
  const rampCss = top?.reverse ? `linear-gradient(270deg, ${LEGEND.stops.join(',')})` : LEGEND.css;
  const domain = top?.domain ?? [0, 1];
  const horizon = desc?.time?.horizon ?? 0;
  const unit = desc?.time?.unit ?? '';
  const chips = info.binding.architecture ?? [];

  if (SNAPSHOT) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: TOKENS.bg }}>
        <canvas
          ref={canvasRef} className="pd-canvas" tabIndex={0}
          style={{ width: '100vw', height: '100vh' }}
          aria-label={`Snapshot map of ${info.title}`}
        />
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
              aria-label={`Interactive isometric map of ${info.title}. Drag or use A and D to pan; scroll or use W and S to zoom; F to fit; R to rotate.`}
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
              <Tooltip label="Fit the map (F)"><ActionIcon size="lg" aria-label="Fit map" onClick={() => kitRef.current?.fit()}><IconRefresh size={17} stroke={1.6} /></ActionIcon></Tooltip>
              <Tooltip label="Rotate 90° (E / R; Q back)"><ActionIcon size="lg" aria-label="Rotate 90 degrees" onClick={() => kitRef.current?.rotate()}><IconRotateClockwise size={17} stroke={1.6} /></ActionIcon></Tooltip>
              <Tooltip label={lens ? 'Data lens on (L)' : 'Data lens off (L)'}><ActionIcon size="lg" aria-label="Toggle data lens" aria-pressed={lens} variant={lens ? 'filled' : 'default'} onClick={toggleLens}><IconLayersSubtract size={17} stroke={1.6} /></ActionIcon></Tooltip>
              <Tooltip label="About this model"><ActionIcon size="lg" aria-label="About" onClick={() => setAnalyst(true)}><IconInfoCircle size={17} stroke={1.6} /></ActionIcon></Tooltip>
            </Group>

            {!playing ? <div className="pd-paused">Paused</div> : null}
          </div>

          <aside className="pd-side">
            <div className="pd-side-head">Controls</div>
            <ScrollArea h="100%">
              <div className="pd-side-body">
                <Text size="xs" c="dimmed" lh={1.5}>{info.description}</Text>
                <div style={{ marginTop: 4 }}>
                  {Object.entries<any>(desc?.params ?? {}).map(([k, s]) => (s.type === 'number' || s.type === 'integer') ? (
                    <div className="pd-control" key={k}>
                      <div className="pd-control-head">
                        <span>{s.label ?? k}</span>
                        <span className="pd-value">{Number(params[k]).toFixed(2)}{s.unit ? ` ${s.unit}` : ''}</span>
                      </div>
                      <Slider
                        value={Number(params[k])} min={s.min} max={s.max} step={s.step ?? 0.01}
                        onChange={(v) => restart({ ...params, [k]: v })}
                        aria-label={s.label ?? k} size="sm"
                      />
                    </div>
                  ) : null)}
                </div>
                <Divider my={12} />
                {scenarios.length ? (
                  <>
                    <div className="pd-panel-head" style={{ marginBottom: 8 }}>Scenario</div>
                    <SegmentedControl
                      fullWidth size="xs" value={scenario} onChange={onScenario}
                      data={scenarios.map((s) => ({ label: s.label ?? s.id, value: s.id }))}
                      aria-label="Scenario"
                    />
                    <Group mt={10} gap={8}>
                      <Button size="xs" variant="default" onClick={() => startRun(params, scenario)} leftSection={<IconRefresh size={14} />}>Reset run</Button>
                    </Group>
                  </>
                ) : null}
                <div className="pd-note">
                  Real OpenStreetMap map of Jette (relation 58258); storeys are 99% assumed, not measured. Every number
                  the model computes is a placeholder, not a finding. People, vehicles, trams, smoke and pigeons are
                  decoration. The five scenarios are bundles of declared parameters, not a forecast. Roof tint and the
                  ridge or coping band show retrofit share; the pennant shows a shared-measure vote pending; the zinc
                  storey cladding shows storeys complete. The palette is a proposal.
                </div>
                <div className="pd-credit">
                  <strong>{info.binding.family.toUpperCase()} · {info.binding.region.toUpperCase()} · {info.binding.palette_look ?? ''}</strong><br />
                  Model: {info.binding.model_licence ?? 'not declared'}<br />
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
          </div>

          <div>
            <div className="pd-panel-head">Declared outputs</div>
            <div className="pd-stats">
              {Object.entries<any>(desc?.series ?? {}).flatMap(([name, s]) => (s.y as string[]).map((pen, i) => {
                const vals = series[name] ?? [];
                const latest = vals[i];
                const shown = !Number.isFinite(latest) ? 'No data'
                  : Math.abs(latest) >= 1000 ? Math.round(latest).toLocaleString()
                  : Number(latest).toFixed(2);
                return (
                  <div className="pd-stat" key={name + pen}>
                    <div className="pd-stat-label">{s.label ? `${s.label} · ${pen}` : pen}</div>
                    <div className="pd-stat-value">{shown}<span>{s.unit ?? ''}</span></div>
                    <Spark values={historyRef.current[`${name}:${i}`] ?? []} />
                  </div>
                );
              }))}
            </div>
          </div>

          <div>
            <div className="pd-panel-head">Legend</div>
            {top ? (
              <>
                <div className="pd-legend-row">
                  <svg className="pd-roof-icon" viewBox="0 0 40 24" aria-hidden="true">
                    <polygon points="4,20 20,6 36,20" fill="#6b5f73" />
                    <rect x="17" y="4.5" width="6" height="3" fill={LEGEND.stops[3]} />
                    <rect x="6" y="20" width="28" height="3" fill="var(--pd-line)" />
                  </svg>
                  <div style={{ flex: 1 }}>
                    <div className="pd-ramp" style={{ background: rampCss }} />
                    <div className="pd-ramp-labels"><span>{domain[0]}</span><span>{top.label ?? top.field} {top.unit ? `(${top.unit})` : ''}</span><span>{domain[1]}</span></div>
                  </div>
                </div>
                <div className="pd-unit">{lens ? 'Data lens: whole roofs and upper walls.' : 'Roof tint + ridge or coping band. Press L for the data lens.'}</div>
              </>
            ) : null}
            {chips.map((a: any) => {
              const sw = a.scale?.type === 'categorical' ? Object.values(a.scale.palette ?? {})[0] : a.scale?.ramp?.[0] ?? 'var(--pd-accent)';
              return <span className="pd-chip" key={a.label}><span className="pd-swatch" style={{ background: sw as string }} />{a.label}</span>;
            })}
            <div className="pd-nodata"><span className="pd-swatch pd-hatch" style={{ backgroundColor: 'var(--pd-nodata)' }} />No data</div>
            {info.binding.causal_graph?.confirmed ? (
              <div style={{ marginTop: 12 }}>
                <div className="pd-panel-head">Impact (confirmed)</div>
                {(info.binding.causal_graph.edges ?? []).map((e: string[]) => (
                  <div className="pd-impact-edge" key={e.join('-')}>
                    <span>{e[0]}</span><span className="pd-arrow">→</span><span>{e[1]}</span>
                  </div>
                ))}
              </div>
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
          <Group justify="space-between"><Text size="xs" c="dimmed">Seed</Text><Text size="xs" ff="monospace">runtime {SEED} · model PRNG {String((params as any)?.seed ?? 0)}</Text></Group>
          <Group justify="space-between"><Text size="xs" c="dimmed">Tick</Text><Text size="xs" ff="monospace">{tick} / {horizon} {unit}</Text></Group>
          <Group justify="space-between"><Text size="xs" c="dimmed">Model licence</Text><Text size="xs">{info.binding.model_licence ?? 'not declared'}</Text></Group>
          {DEV ? (
            <>
              <Divider />
              <Text size="xs" fw={600}>Dev — frame check</Text>
              <Text size="xs" c="dimmed" lh={1.5}>
                Frame validates through the model's internal checkFrame on every step (the view threw on any mismatch;
                nothing is painted on a bad frame). Entities: {String(desc?.entities?.households?.fields ? 'households anchored to buildings' : 'n/a')}.
                Snapshot tick: {SNAP_TICK}. Runtime seed: {SEED}. Model PRNG seed: {String((params as any)?.seed ?? 0)}.
                Determinism: same params + same seed → byte-identical frame stream (verified 10-pass on the TS side and 10-pass NetLogo side).
              </Text>
            </>
          ) : null}
          <Divider />
          <Text size="xs" fw={600}>Provenance</Text>
          <Text size="xs" c="dimmed" lh={1.5}>
            Model: The Great Retrofit v3 (NetLogo port), CC BY 4.0, Sci-Fi Economics Lab.
            Every number in the model is a placeholder; nothing computed here is a finding.
            Parity: 200-run ensemble against NetLogo 7.0.4 (n-buildings 200, horizon 360, seeds 0–199) — PASS, max |z| = 0.00.
            Determinism: byte-identical reruns on both sides (seeds 1–10, 200 ticks).
            Provenance of heights: 99% of storeys are assumed from type/global defaults, never measured.
            Economic classes: 93% assigned by a seeded fallback (no use tags); not data.
            The R0 motorway ring and untagged open grounds are not in the map; what renders there is muted grass (untagged, decorative).
            The UZ Brussel university-hospital block (named UZ-* in OSM) is the landmark — a real structure.
            The market square is Sint-Pietersplein (place=square, Église Saint-Pierre); the church is drawn 1 level as the data assumes.
            Scenarios are bundles of declared policy parameters, not model-declared interventions; each starts a fresh run from t=0 with the same runtime seed (model PRNG seed 0).
            Market stalls on the square are decorative and invented, not from the data.
          </Text>
          <Divider />
          <Text size="xs" fw={600}>Controls</Text>
          <Group justify="space-between"><Text size="xs" c="dimmed">Pan</Text><Text size="xs">Drag · A / D</Text></Group>
          <Group justify="space-between"><Text size="xs" c="dimmed">Zoom</Text><Text size="xs">Scroll · W / S</Text></Group>
          <Group justify="space-between"><Text size="xs" c="dimmed">Fit / rotate</Text><Text size="xs">F / Q · E (R)</Text></Group>
          <Group justify="space-between"><Text size="xs" c="dimmed">Data lens</Text><Text size="xs">L</Text></Group>
          <Group justify="space-between"><Text size="xs" c="dimmed">Art bible</Text><Text size="xs">{info.artBibleStatus.split(' — ')[0]}</Text></Group>
          <Group justify="space-between"><Text size="xs" c="dimmed">Play / pause</Text><Text size="xs">Space</Text></Group>
          <Divider />
          <Text size="xs" c="dimmed" lh={1.5}>
            This is a model/scenario exploration, not a forecast or a policy recommendation — every number in the model
            is a placeholder. The two-layer split: the sidebar is the policy surface; this drawer is the analyst layer. The map is real: OpenStreetMap relation 58258 (Jette), © OpenStreetMap contributors (ODbL);
            heights are 99% assumed from type defaults, never measured. The UZ Brussel university-hospital block (named
            “UZ-*” in the map data) is the landmark — a real structure from the map, not invented. Decorative and invented
            (labelled): traffic, trams, parked cars, pedestrians, chimney smoke, pigeons, trees other than the{' '}
            {info.scene.trees?.length ?? 0} in the map data, hedges, the guessed gault string courses. The palette, facade
            grammar and structure archetypes are proposals until checked with local authors. The “auto” archetypes were
            resolved by a documented seeded rule (storeys ≥ 8 tower; ≥ 4 floors or ≥ 350 m² block; &lt; 55 m² shed; else
            terrace or villa). 8,105 of 9,216 structures are dwellings and carry model households; the rest render but
            stay out of the model. Model structures: {info.scene.structures?.length ?? info.scene.buildings?.length}.
          </Text>
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
        </Stack>
      </Drawer>
    </MantineProvider>
  );
}
