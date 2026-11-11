import { T } from './theme';
// Impact view: ONLY the user-confirmed causal graph (sim-code/model-binding.json). Nodes whose model parameter differs from its default are marked.
export interface Graph { nodes: string[]; edges: string[][] }
const POS: Record<string, [number, number, 'in' | 'mid' | 'out']> = {
  'energy-scenario': [90, 14, 'in'], 'cost-per-m2': [90, 36, 'in'], 'delivery-mode': [90, 58, 'in'], 'deduction-rate': [90, 80, 'in'], 'rebate-lag-months': [90, 102, 'in'], 'loan-rate': [90, 124, 'in'],
  'credit-access': [90, 146, 'in'], income: [90, 168, 'in'], savings: [90, 190, 'in'], 'neighbour-adoption': [90, 212, 'in'], canvassing: [90, 234, 'in'],
  npv: [200, 50, 'mid'], 'can-finance': [200, 120, 'mid'], 'consider-prob': [200, 200, 'mid'], 'shared-support': [300, 200, 'mid'], 'shared-approved': [300, 150, 'mid'],
  adoption: [400, 120, 'out'], 'public-cost': [400, 60, 'out'], 'bills-saved': [400, 180, 'out'],
};
const PARAM_OF: Record<string, string[]> = { 'energy-scenario': ['energy-scenario'], 'cost-per-m2': ['cost-per-m2'], 'delivery-mode': ['delivery-mode'], 'deduction-rate': ['deduction-rate'], 'rebate-lag-months': ['rebate-lag-months'], 'loan-rate': ['loan-rate'], 'credit-access': ['credit-access'], savings: ['savings-scale', 'savings-months-of-income', 'savings-usable-share'], 'shared-approved': ['vote-threshold', 'shared-share', 'shared-measure?'], 'consider-prob': ['consider-prob-base', 'neighbour-boost', 'peer-effect?', 'canvass-boost'] };
export function Impact({ graph, changed }: { graph: Graph; changed: Set<string> }) {
  const on = (n: string) => (PARAM_OF[n] ?? []).some((p) => changed.has(p));
  return (
    <svg role="img" aria-label="Impact view: the confirmed causal graph" viewBox="0 0 480 248" width="100%" height="100%" style={{ display: 'block', maxHeight: 230 }}>
      <title>Confirmed causal graph</title><desc>{graph.edges.map((e) => `${e[0]} affects ${e[1]}`).join('; ')}</desc>
      <defs><marker id="arr" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L6 3L0 6z" fill={T.dim} /></marker></defs>
      {graph.edges.map(([a, b], i) => { const A = POS[a], B = POS[b]; if (!A || !B) return null; const hot = on(a); return <path key={i} d={`M${A[0] + 44} ${A[1]} C ${A[0] + 84} ${A[1]}, ${B[0] - 72} ${B[1]}, ${B[0] - 46} ${B[1]}`} fill="none" stroke={hot ? T.accent : T.line} strokeWidth={hot ? 1.5 : 1} markerEnd="url(#arr)" opacity={hot ? 1 : 0.9} />; })}
      {graph.nodes.map((n) => { const p = POS[n]; if (!p) return null; const hot = on(n); return (
        <g key={n}><rect x={p[0] - 44} y={p[1] - 8} width={88} height={16} rx={4} fill={hot ? T.accentSoft : T.surface} stroke={hot ? T.accent : T.line} /><text x={p[0]} y={p[1] + 3.5} textAnchor="middle" fontSize={9} fill={T.text}>{n}</text></g>); })}
    </svg>
  );
}
