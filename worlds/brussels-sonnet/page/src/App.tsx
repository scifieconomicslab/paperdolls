import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Accordion, ActionIcon, Badge, Button, Divider, Drawer, Group, MantineProvider, Paper, ScrollArea, SegmentedControl, Select, Slider, Stack, Switch, Table, Tabs, Text, Tooltip } from '@mantine/core';
import '@mantine/core/styles.css';
import { IconContrast, IconDownload, IconFocus, IconInfoCircle, IconPlayerPause, IconPlayerPlay, IconPlayerTrackNext, IconRotateClockwise, IconZoomIn, IconZoomOut } from '@tabler/icons-react';
import { theme, T, cssVars, HATCH } from './ui/theme';
import { LineChart, Spark, fmt, type Line } from './ui/charts';
import { Impact, type Graph } from './ui/impact';
import { STATE_NAMES, rampColor } from './scene/data';
import type { Core, Params } from './core';

const GROUPS = ['Policy', 'Shared parts', 'Behaviour', 'Costs', 'Finance', 'Households', 'Stock', 'Assumptions', 'Run'];
const TIER_LABEL: Record<string, string> = { lever: 'policy lever', assumption: 'assumption', structural: 'run setup' };
const PLOTS: { name: string; label: string; unit: string }[] = [
  { name: 'Adoption by quintile', label: 'Adoption by income quintile', unit: 'share' }, { name: 'State spend (cumulative)', label: 'State spend (cumulative)', unit: 'EUR' },
  { name: 'Bills saved (cumulative)', label: 'Bills saved (cumulative)', unit: 'EUR' }, { name: 'Cost per retrofit', label: 'Cost per retrofit', unit: 'EUR' }, { name: 'cost parts', label: 'Cost parts (base and markup)', unit: 'EUR' },
  { name: 'tenures', label: 'Tenures', unit: 'buildings' }, { name: 'building states', label: 'Building states', unit: 'buildings' }, { name: 'can front cost by quintile', label: 'Can front the cost, by quintile', unit: 'share' },
  { name: 'rebate per euro by quintile', label: 'Rebate per euro, by quintile', unit: 'EUR/EUR' }, { name: 'net cash by quintile', label: 'Net cash, by quintile', unit: 'EUR' },
];
const MONITORS: { key: string; label: string; unit?: string }[] = [{ key: 'monitor:adopted units', label: 'Adopted units' }, { key: 'monitor:public cost', label: 'Public cost', unit: 'EUR' }, { key: 'monitor:bills saved', label: 'Bills saved', unit: 'EUR' }, { key: 'monitor:cost per retrofit', label: 'Cost per retrofit', unit: 'EUR' }];

function useCore(core: Core) { return useSyncExternalStore((cb) => { core.on(cb); return () => { core.off(cb); }; }, () => core.version); }

export function App({ core, scene, binding, parity, dev }: { core: Core; scene: any; binding: any; parity: string; dev: boolean }) {
  useCore(core); const [, force] = useState(0); const world = core.world; const desc = core.desc;
  const canvasHost = useRef<HTMLDivElement>(null); const [lens, setLens] = useState(false); const [drawer, setDrawer] = useState(false); const [tab, setTab] = useState<string | null>('about');
  const [sel, setSel] = useState<number | null>(null); const [hh, setHh] = useState<number[][] | null>(null); const [tag, setTag] = useState<{ bi: number; x: number; y: number } | null>(null);
  const [plot, setPlot] = useState('Adoption by quintile'); const [scn, setScn] = useState<string>('baseline'); const [devMsg, setDevMsg] = useState('');
  
  useEffect(() => { const el = canvasHost.current!; const cv = world.pipe.renderer.domElement; el.appendChild(cv); const ro = new ResizeObserver(() => { world.pipe.resize(); world.rig.place(); }); ro.observe(el); return () => { ro.disconnect(); }; }, [world]);
  useEffect(() => { world.onHover((bi, x, y) => setTag(bi === null ? null : { bi, x, y })); world.onSelect((bi) => { setSel(bi); setHh(null); }); }, [world]);
  useEffect(() => { if (sel === null || !core.runId) return; let live = true; core.sim.households(core.runId, sel).then((r) => { if (live) setHh(r); }); return () => { live = false; }; }, [sel, core.runId, core.head]);
  const toggleLens = () => { const n = !lens; setLens(n); world.setLens(n); };
  useEffect(() => { const k = (e: KeyboardEvent) => { if ((e.target as HTMLElement)?.tagName === 'INPUT' || e.ctrlKey || e.metaKey || e.altKey) return; if (e.key.toLowerCase() === 'l') toggleLens(); if (e.key === ' ' && (e.target as HTMLElement)?.tagName !== 'BUTTON') { e.preventDefault(); core.setPlaying(!core.playing); } }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); });

  const bds = world.bds; const horizon = core.horizon(); const t = core.viewTick; const S = core.series; const SB = core.seriesB;
  const val = (name: string, j = 0, tt = t) => (S[name]?.[tt]?.[j] ?? NaN);
  const plotMeta = PLOTS.find((p) => p.name === plot)!; const ys = desc.series[plot]?.y ?? [];
  const palette = [T.q[0], T.q[1], T.q[2], T.q[3], T.q[4]]; const colorOf = (j: number, n: number) => (n === 5 ? palette[j] : [T.accent, T.q[2], T.q[4], T.noData][j % 4]);
  const lines: Line[] = ys.flatMap((y, j) => { const base: Line = { name: y, color: colorOf(j, ys.length), values: (S[plot] ?? []).map((v) => v?.[j] ?? NaN) }; const out = [base]; if (core.compare && SB[plot]) out.push({ name: y + ' (baseline)', color: colorOf(j, ys.length), dashed: true, values: SB[plot].map((v) => v?.[j] ?? NaN) }); return out; });
  const bsel = sel !== null ? bds[sel] : null; const anchorIdx = useMemo(() => { const m = new Map<number, number>(); if (core.stat) core.stat.anchor.forEach((a, k) => m.set(a, k)); return m; }, [core.stat]);
  const k = sel !== null ? anchorIdx.get(sel) : undefined; const ti = (x: number) => ['owner-occupied', 'condo', 'rental'][x] ?? '?';
  const changed = core.changed; const graph = binding.causal_graph as Graph;
  const states = ['building states']; void states; const bs = [0, 1, 2, 3].map((j) => val('building states', j)); const bsTot = bs.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
  const csv = () => { const names = Object.keys(S); const cols = names.flatMap((n) => (desc.series[n]?.y ?? []).map((y, j) => [n, y, j] as const)); const rows = ['month,' + cols.map((c) => JSON.stringify(c[0] + ': ' + c[1])).join(',')]; for (let tt = 0; tt <= core.head; tt++) rows.push([tt, ...cols.map((c) => S[c[0]]?.[tt]?.[c[2]] ?? '')].join(',')); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([rows.join('\n')], { type: 'text/csv' })); a.download = `brussels-sonnet-seed${core.seed}.csv`; a.click(); };

  const sidebar = (
    <Paper radius={0} style={{ borderWidth: '0 0 0 1px', overflow: 'hidden', background: 'var(--pd-surface)' }}>
      <ScrollArea h="100%" p={16} type="auto">
        <Stack gap={12}>
          <div>
            <Group justify="space-between" mb={4}><Text fw={600} size="md">Jette: retrofit decisions</Text><Tooltip label="About, provenance and parity"><ActionIcon size="sm" aria-label="About this model" onClick={() => setDrawer(true)}><IconInfoCircle size={16} stroke={1.5} /></ActionIcon></Tooltip></Group>
            <Text size="xs" c="dimmed">A model of housing co-ops and retrofit decisions in Jette, Brussels. Every number in the source model is a placeholder: this is a model, not a forecast.</Text>
          </div>
          <Divider />
          {bsel ? (
            <Paper p={12} radius="md" aria-label="Selected building">
              <Group justify="space-between" mb={6}><Text size="sm" fw={600}>{bsel.name ?? (bsel.osm ? `Building (${bsel.osm})` : 'Building')}</Text><Button size="compact-xs" variant="subtle" onClick={() => world.select(null)}>Close</Button></Group>
              <Table withRowBorders={false} verticalSpacing={2} fz="xs"><Table.Tbody>
                <Table.Tr><Table.Td c="dimmed">OSM id</Table.Td><Table.Td ff="monospace">{bsel.id}</Table.Td></Table.Tr>
                <Table.Tr><Table.Td c="dimmed">Footprint</Table.Td><Table.Td ff="monospace">{Math.round(bsel.area)} m²</Table.Td></Table.Tr>
                <Table.Tr><Table.Td c="dimmed">Storeys</Table.Td><Table.Td ff="monospace">{bsel.lv} (assumed)</Table.Td></Table.Tr>
                {bsel.bound && k !== undefined ? (<>
                  <Table.Tr><Table.Td c="dimmed">Tenure</Table.Td><Table.Td>{ti(core.stat.btenure[k])} (simulated)</Table.Td></Table.Tr>
                  <Table.Tr><Table.Td c="dimmed">Units</Table.Td><Table.Td ff="monospace">{core.stat.units[k]}</Table.Td></Table.Tr>
                  <Table.Tr><Table.Td c="dimmed">Adopted units</Table.Td><Table.Td ff="monospace">{core.hist.adopted[t]?.[k] ?? '—'}</Table.Td></Table.Tr>
                  <Table.Tr><Table.Td c="dimmed">State</Table.Td><Table.Td>{STATE_NAMES[core.hist.bstate[t]?.[k] ?? 0]}</Table.Td></Table.Tr>
                  <Table.Tr><Table.Td c="dimmed">Shared measure</Table.Td><Table.Td>{['not needed', 'pending', 'approved'][core.hist.shared[t]?.[k] ?? 0]}</Table.Td></Table.Tr></>) : <Table.Tr><Table.Td colSpan={2} c="dimmed">Not a household home in the model (scenery)</Table.Td></Table.Tr>}
              </Table.Tbody></Table>
              {hh && bsel.bound && <><Text size="xs" c="dimmed" mt={8} mb={4}>Households (latest simulated month)</Text><ScrollArea h={Math.min(150, 22 + hh.length * 20)}><Table fz="xs" verticalSpacing={1} stickyHeader><Table.Thead><Table.Tr><Table.Th>Q</Table.Th><Table.Th ta="right">m²</Table.Th><Table.Th ta="right">income €</Table.Th><Table.Th ta="right">savings €</Table.Th><Table.Th ta="right">stay (mo)</Table.Th><Table.Th>state</Table.Th></Table.Tr></Table.Thead>
                <Table.Tbody>{hh.map((r, i) => <Table.Tr key={i}><Table.Td ff="monospace">{r[0]}</Table.Td><Table.Td ta="right" ff="monospace">{Math.round(r[1])}</Table.Td><Table.Td ta="right" ff="monospace">{Math.round(r[2])}</Table.Td><Table.Td ta="right" ff="monospace">{Math.round(r[3])}</Table.Td><Table.Td ta="right" ff="monospace">{r[4]}</Table.Td><Table.Td>{['none', 'own part', 'complete'][r[5]]}</Table.Td></Table.Tr>)}</Table.Tbody></Table></ScrollArea></>}
            </Paper>) : <Text size="xs" c="dimmed">Click a building to see its households. Drag to pan, wheel to zoom, F to fit.</Text>}
          <Divider />
          <Select label="Scenario" size="xs" value={scn} onChange={(v) => { if (!v) return; setScn(v); const s = binding.scenarios.find((x: any) => x.id === v); const p: Params = { ...core.defaults, seed: core.params.seed, 'scene-seed': core.params['scene-seed'] }; for (const iv of s.interventions) p[iv.name] = iv.value; core.start(p); }} data={binding.scenarios.map((s: any) => ({ value: s.id, label: s.label }))} allowDeselect={false} />
          <Switch size="sm" label="Compare with the baseline" description="Dashed lines: same seed, default parameters" checked={core.compare} onChange={(e) => core.setCompare(e.currentTarget.checked)} />
          <Divider />
          <Text size="xs" c="dimmed">Changing a control restarts the run from month 0 with the same seed ({String(core.params.seed)}).</Text>
          <Accordion multiple defaultValue={['Policy']} variant="separated" chevronPosition="left">
            {GROUPS.map((g) => { const ps = Object.entries(desc.params).filter(([, s]) => (s.group ?? 'Run') === g); if (!ps.length) return null; return (
              <Accordion.Item key={g} value={g}><Accordion.Control>{g}</Accordion.Control><Accordion.Panel><Stack gap={10}>{ps.map(([name, s]) => (
                <div key={name}>
                  {s.type === 'boolean' ? <Switch size="xs" label={name} checked={!!core.params[name]} onChange={(e) => core.setParam(name, e.currentTarget.checked, true)} /> :
                   s.type === 'choice' ? <Select size="xs" label={name} value={String(core.params[name])} data={s.values.map((v) => v.value)} allowDeselect={false} onChange={(v) => v && core.setParam(name, v, true)} /> :
                   (s.type === 'number' || s.type === 'integer') ? (<>
                     <Group justify="space-between" gap={4}><Text size="xs" id={'lbl-' + name}>{name}</Text><Text size="xs" ff="monospace">{fmt(Number(core.params[name]))}{s.unit ? ' ' + s.unit : ''}</Text></Group>
                     <Slider size="xs" aria-labelledby={'lbl-' + name} min={s.min} max={s.max} step={s.step} value={Number(core.params[name])} label={null} onChange={(v) => { core.params = { ...core.params, [name]: v }; force((n) => n + 1); }} onChangeEnd={(v) => core.setParam(name, v, true)} /></>) : null}
                  <Text size="10px" c="dimmed">{TIER_LABEL[s.tier ?? 'assumption']}{s.type !== 'boolean' && s.type !== 'choice' ? `, ${s.min} to ${s.max}` : ''}</Text>
                </div>))}</Stack></Accordion.Panel></Accordion.Item>); })}
          </Accordion>
          <Divider />
          <Text size="xs" c="dimmed">© OpenStreetMap contributors (ODbL). paperdolls: CC BY 4.0, Sci-Fi Economics Lab. Colour-figure look after Colorfigures by April Zhu (MIT).</Text>
        </Stack>
      </ScrollArea>
    </Paper>);

  const dock = (
    <div style={{ borderTop: '1px solid var(--pd-line)', background: 'var(--pd-surface)', display: 'grid', gridTemplateColumns: '300px minmax(0,1fr) 470px', gap: 16, padding: '12px 16px', height: 292, boxSizing: 'border-box' }}>
      <Stack gap={8} style={{ minWidth: 0 }}>
        <Group gap={8} wrap="nowrap">
          <ActionIcon size="lg" aria-label={core.playing ? 'Pause' : 'Play'} onClick={() => core.setPlaying(!core.playing)}>{core.playing ? <IconPlayerPause size={18} stroke={1.5} /> : <IconPlayerPlay size={18} stroke={1.5} />}</ActionIcon>
          <Tooltip label="Run to the end of the horizon"><ActionIcon size="lg" aria-label="Run to the end" onClick={() => { core.setPlaying(false); core.runTo(horizon); }}><IconPlayerTrackNext size={18} stroke={1.5} /></ActionIcon></Tooltip>
          <Text size="sm" fw={600} ff="monospace" aria-live="polite">month {t} / {horizon}</Text>
        </Group>
        <Slider size="xs" min={0} max={Math.max(1, core.head)} value={Math.min(t, Math.max(1, core.head))} onChange={(v) => core.seek(v)} aria-label="Month" label={(v) => `month ${v}`} />
        <Group gap={8} wrap="nowrap"><Text size="xs" c="dimmed" w={70}>Speed</Text><Slider size="xs" style={{ flex: 1 }} min={1} max={24} step={1} value={core.speed} onChange={(v) => { core.speed = v; force((n) => n + 1); }} aria-label="Playback speed in months per second" label={(v) => `${v} months/s`} /></Group>
        <Divider />
        <Text size="xs" fw={600}>Legend</Text>
        <Stack gap={3}>
          {[0, 1, 2].map((s) => (<Group key={s} gap={8} wrap="nowrap"><div style={{ width: 22, height: 10, borderRadius: 2, background: rampColor(s) }} /><Text size="xs">{STATE_NAMES[s]}</Text></Group>))}
          <Group gap={8} wrap="nowrap"><div style={{ width: 22, height: 10, borderRadius: 2, background: HATCH }} /><Text size="xs">Rental: not modelled (no data)</Text></Group>
          <Text size="10px" c="dimmed">Ridge cap or coping band: state. Pennant: pale pending, plum approved shared measure. Pale cladding: storeys retrofitted, bottom up. L: data lens.</Text>
        </Stack>
      </Stack>
      <Stack gap={6} style={{ minWidth: 0 }}>
        <Group justify="space-between" wrap="nowrap" gap={8}>
          <Select size="xs" aria-label="Output" data={PLOTS.map((p) => ({ value: p.name, label: p.label }))} value={plot} onChange={(v) => v && setPlot(v)} allowDeselect={false} style={{ width: 250 }} />
          <Text size="xs" c="dimmed">{plotMeta.unit}, by {desc.time.unit}{core.compare ? ' · dashed: baseline' : ''}</Text>
        </Group>
        <LineChart lines={lines} horizon={horizon} tick={t} unit={plotMeta.unit} xUnit={desc.time.unit} height={150} title={plotMeta.label} desc={`Line chart of ${plotMeta.label} over ${horizon} ${desc.time.unit}`} />
        <Group gap={16} wrap="nowrap" align="flex-end">
          {MONITORS.map((m) => (<div key={m.key} style={{ minWidth: 0 }}><Text size="10px" c="dimmed">{m.label}</Text><Group gap={6} wrap="nowrap"><Text size="sm" ff="monospace" fw={600}>{fmt(val(m.key), m.unit)}</Text><Spark values={(S[m.key] ?? []).map((v) => v?.[0] ?? NaN)} /></Group></div>))}
          <div style={{ flex: 1, minWidth: 100 }}><Text size="10px" c="dimmed">Building states (derived from the counts: share of {bsTot} buildings)</Text>
            <div style={{ display: 'flex', height: 10, borderRadius: 2, overflow: 'hidden', border: '1px solid var(--pd-line)' }} role="img" aria-label={`Building states: ${bs.map((v, j) => `${STATE_NAMES[j]} ${v}`).join(', ')}`}>{bs.map((v, j) => <div key={j} style={{ width: `${(100 * (Number.isFinite(v) ? v : 0)) / Math.max(1, bsTot)}%`, background: j === 3 ? HATCH : rampColor(j) }} />)}</div></div>
        </Group>
      </Stack>
      <div style={{ minWidth: 0 }}>
        <Text size="xs" fw={600}>Impact view <Text span size="10px" c="dimmed">(confirmed causal graph; highlighted: parameters you changed)</Text></Text>
        <Impact graph={graph} changed={changed} />
      </div>
    </div>);

  return (
    <MantineProvider theme={theme} forceColorScheme="light">
      <div style={{ ...cssVars, height: '100vh', display: 'grid', gridTemplateRows: '1fr auto', background: 'var(--pd-bg)', color: 'var(--pd-text)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 296px', minHeight: 0 }}>
          <div style={{ position: 'relative', overflow: 'hidden', minHeight: 0 }}>
            <div ref={canvasHost} style={{ position: 'absolute', inset: 0 }} />
            <Group gap={8} style={{ position: 'absolute', top: 12, right: 12 }}>
              <Tooltip label="Zoom in (W)"><ActionIcon size="lg" aria-label="Zoom in" onClick={() => world.zoom(0.8)}><IconZoomIn size={18} stroke={1.5} /></ActionIcon></Tooltip>
              <Tooltip label="Zoom out (S)"><ActionIcon size="lg" aria-label="Zoom out" onClick={() => world.zoom(1.25)}><IconZoomOut size={18} stroke={1.5} /></ActionIcon></Tooltip>
              <Tooltip label="Fit the map (F)"><ActionIcon size="lg" aria-label="Fit map" onClick={() => world.fit()}><IconFocus size={18} stroke={1.5} /></ActionIcon></Tooltip>
              <Tooltip label="Rotate 90° (R)"><ActionIcon size="lg" aria-label="Rotate 90 degrees" onClick={() => world.rotate(90)}><IconRotateClockwise size={18} stroke={1.5} /></ActionIcon></Tooltip>
              <Tooltip label={lens ? 'Back to the beauty view (L)' : 'Data lens (L)'}><ActionIcon size="lg" aria-label="Toggle data lens" aria-pressed={lens} variant={lens ? 'filled' : 'default'} onClick={toggleLens}><IconContrast size={18} stroke={1.5} /></ActionIcon></Tooltip>
            </Group>
            {core.error && <Paper p={8} style={{ position: 'absolute', bottom: 12, left: 12 }}><Text size="xs" c="red.8">Simulation error: {core.error}</Text></Paper>}
            {tag && bds[tag.bi] && (<div style={{ position: 'fixed', left: tag.x + 14, top: tag.y + 14, pointerEvents: 'none', background: 'var(--pd-surface)', border: '1px solid var(--pd-line)', borderRadius: 6, padding: '4px 8px', fontSize: 12 }}>
              {bds[tag.bi].name ?? bds[tag.bi].osm}{bds[tag.bi].bound ? ` · ${STATE_NAMES[world.data.stateOf(tag.bi) >= 0 ? world.data.stateOf(tag.bi) : 0]}` : ' · scenery'}</div>)}
          </div>
          {sidebar}
        </div>
        {dock}
      </div>
      <Drawer opened={drawer} onClose={() => setDrawer(false)} title="About and analyst view" position="right" size="lg" scrollAreaComponent={ScrollArea}>
        <Tabs value={tab} onChange={setTab}>
          <Tabs.List><Tabs.Tab value="about">About</Tabs.Tab><Tabs.Tab value="prov">Provenance</Tabs.Tab><Tabs.Tab value="parity">Parity</Tabs.Tab><Tabs.Tab value="series">Series</Tabs.Tab>{dev && <Tabs.Tab value="dev">Dev</Tabs.Tab>}</Tabs.List>
          <Tabs.Panel value="about" pt="md"><Stack gap={10}>
            <Text size="sm">This page is a live simulation of the NetLogo model "The Great Retrofit v3" on the buildings of Jette, Brussels. It is a model, not a forecast: its source states that every number in it is a placeholder.</Text>
            <Text size="sm" fw={600}>What is invented or assumed (labelled)</Text>
            <Stack gap={4}>{[
              `Storeys: ${Math.round((100 * scene.buildings.filter((b: any) => b.lva).length) / scene.buildings.length)}% of buildings have no height tag; storeys are assumed by a seeded rule (footprint, terrace rows, avenues).`,
              'Which buildings are homes: 433 tagged dwellings plus 7,672 untagged buildings of 30 m² or more (a guess); 1,111 others are scenery.',
              'Households per building: the model\'s own rule from footprint × storeys, so ≈ 31,000 households; tenure (owner, condo, rental) is the model\'s seeded draw, not real tenure.',
              `Landmark: ${world.landmark.name ?? world.landmark.id}, chosen by a rule (largest named religious building); its tower and spire are decorative.`,
              `Decorative, not model data: ${world.lifeCounts.cars} cars, ${world.lifeCounts.buses} buses, ${world.lifeCounts.trams} trams, ${world.lifeCounts.pedestrians} paper-doll pedestrians, street lamps, parked cars, generated trees, road widths and sidewalks. They stop under reduced motion.`,
              'Palette, light, the moment (3 pm, late May, sunny) and the signature motif (stone banding, bay windows) are a proposal from the art bible.',
              'Roof pennants, cladding and ramp colours show only declared model variables; the legend is drawn from the same functions as the scene.',
              'Map mode has no NetLogo twin; see Parity.'].map((s, i) => <Text key={i} size="xs">• {s}</Text>)}</Stack>
            <Text size="sm" fw={600}>Controls</Text>
            <Text size="xs">Drag or A/D (arrows) to pan; wheel or W/S to zoom; F fit; Q/E or R rotate; L data lens; Space play or pause; click a building to inspect it; double-click to frame it; Esc closes the card.</Text>
            <Text size="sm" fw={600}>Credits</Text>
            <Text size="xs">Map data © OpenStreetMap contributors (ODbL). paperdolls: CC BY 4.0, Sci-Fi Economics Lab. The colour-figure look derives from Colorfigures by April Zhu (MIT). The NetLogo model's licence is not stated in the file. Interface: Mantine, React, three.js, Tabler icons. No network is used at view time.</Text>
          </Stack></Tabs.Panel>
          <Tabs.Panel value="prov" pt="md"><Stack gap={6}>
            <Text size="sm">Source: OpenStreetMap relation 58258 (Jette), fetched 2026-11-11; {scene.buildings.length} buildings, {world.boundCount} bound to households.</Text>
            <Text size="sm">Model: great-retrofit-v3.nlogox (NetLogo 7.0.4) converted to TypeScript, run in a worker. Seed {String(core.seed)}, scene-seed {String(core.params['scene-seed'])}. Same parameters and seed give the same run.</Text>
            <Text size="sm">Parameters that differ from the defaults: {changed.size ? [...changed].map((k) => `${k} = ${String(core.params[k])}`).join('; ') : 'none'}.</Text>
            <Text size="sm">Recorded trajectory: none. Everything shown is the live run.</Text>
            <Button leftSection={<IconDownload size={16} />} variant="default" size="xs" onClick={csv} w={200}>Export series (CSV)</Button>
          </Stack></Tabs.Panel>
          <Tabs.Panel value="parity" pt="md"><Text size="xs" component="pre" style={{ whiteSpace: 'pre-wrap', fontFamily: 'ui-monospace, monospace' }}>{parity}</Text></Tabs.Panel>
          <Tabs.Panel value="series" pt="md"><Table fz="xs" verticalSpacing={2}><Table.Thead><Table.Tr><Table.Th>Series</Table.Th><Table.Th>Month {t}</Table.Th></Table.Tr></Table.Thead><Table.Tbody>
            {Object.keys(desc.series).flatMap((n) => desc.series[n].y.map((y, j) => <Table.Tr key={n + y}><Table.Td>{n.replace('monitor:', '')}: {y}</Table.Td><Table.Td ff="monospace">{fmt(val(n, j), desc.series[n].unit)}</Table.Td></Table.Tr>))}</Table.Tbody></Table></Tabs.Panel>
          {dev && <Tabs.Panel value="dev" pt="md"><Stack gap={6}>
            <Text size="sm">checkFrame runs on every frame inside the model (an error would stop the run): {core.error ? 'ERROR ' + core.error : `clean for ${core.head + 1} frames`}.</Text>
            <Button size="xs" variant="default" w={260} onClick={async () => { setDevMsg('running…'); const r = await core.sim.check({ ...core.params }, core.seed, 60); setDevMsg(`${r.same ? 'PASS' : 'FAIL'}: same params and seed twice gave ${r.same ? 'identical' : 'different'} series over ${r.frames} frames`); }}>Determinism check (60 months, twice)</Button>
            <Text size="xs">{devMsg}</Text><Text size="xs" ff="monospace">{JSON.stringify(world.stats())}</Text></Stack></Tabs.Panel>}
        </Tabs>
      </Drawer>
    </MantineProvider>);
}
void Badge; void SegmentedControl;
