// Ported from github.com/scifieconomicslab/paperdolls @ f9a1a59 (CC BY 4.0).
// `wrap: false` runs the scenario on a copy of the host model whose view does not wrap (NetLogo 7 sets the topology on the view, not in code).
// The black-box scenarios: NetLogo code run by scripts/netlogo-fixtures.mjs, and mirrored in test/netlogo.test.ts. The setup always starts with
// `ca` on a world it sizes itself. Metrics are NetLogo reporters; their results are stored by metric name.
const PAIRS = [[0, 1], [0, 2], [1, 2], [2, 3], [3, 0], [1, 3]];
const L = '[3 1 4 1 5 9 2 6 5 3 5]';
export const POS = [[9.5, 9.5], [-9.7, -9.6], [3.25, -7.5], [0, 0]];
const crtAt = pts => pts.map(([x, y]) => `crt 1 [ setxy ${x} ${y} ]`).join(' ');
const HEADS = [[10, 350], [350, 10], [0, 180], [180, 0], [90, 271], [45.5, 300]];
export const SCENARIOS = [
  { name: 'geometry-wrap', setup: `ca resize-world -10 10 -10 10 ${crtAt(POS)} ask turtle 0 [ set heading 33 ] reset-ticks`,
    metrics: {
      distance: `(list ${PAIRS.map(([a, b]) => `[distance turtle ${b}] of turtle ${a}`).join(' ')})`,
      towards: `(list ${PAIRS.map(([a, b]) => `[towards turtle ${b}] of turtle ${a}`).join(' ')})`,
      patchAt: `[ (list [pxcor] of patch-at 2 3 [pycor] of patch-at 2 3 [pxcor] of patch-at -1.6 0.4 [pycor] of patch-at -1.6 0.4) ] of turtle 0`,
      patchAhead: `[ (list [pxcor] of patch-ahead 2.5 [pycor] of patch-ahead 2.5) ] of turtle 0`,
      distancexy: `[ (list distancexy 10 -10 distancexy -3.3 4.4) ] of turtle 2`,
    } },
  { name: 'motion-wrap', setup: `ca resize-world -10 10 -10 10 crt 1 [ setxy 0 0 set heading 0 repeat 50 [ rt 37 fd 1.3 ] lt 400 bk 2.2 ] reset-ticks`,
    metrics: { state: `[ (list xcor ycor heading) ] of turtle 0` } },
  { name: 'radius-cone', setup: `ca resize-world -10 10 -10 10 crt 1 [ setxy 9.6 -0.2 set heading 60 ] ${crtAt([[-9.8, 0.1], [9, 3], [5, -0.2], [-8.9, -1]])} reset-ticks`,
    metrics: {
      patchesInRadius: `sort [ pxcor * 1000 + pycor ] of [ patches in-radius 3.5 ] of turtle 0`,
      turtlesInRadius: `sort [ who ] of [ turtles in-radius 2.5 ] of turtle 0`,
      patchesInCone: `sort [ pxcor * 1000 + pycor ] of [ patches in-cone 4 70 ] of turtle 0`,
    } },
  { name: 'neighbors-wrap', setup: 'ca resize-world -4 4 -4 4 reset-ticks',
    metrics: { n8corner: 'sort [ pxcor * 1000 + pycor ] of [ neighbors ] of patch -4 -4', n4corner: 'sort [ pxcor * 1000 + pycor ] of [ neighbors4 ] of patch -4 -4', n8mid: 'sort [ pxcor * 1000 + pycor ] of [ neighbors ] of patch 1 2' } },
  { name: 'neighbors-box', wrap: false, setup: 'ca resize-world -4 4 -4 4 reset-ticks',
    metrics: { n8corner: 'sort [ pxcor * 1000 + pycor ] of [ neighbors ] of patch -4 -4', n4corner: 'sort [ pxcor * 1000 + pycor ] of [ neighbors4 ] of patch -4 -4', n8edge: 'sort [ pxcor * 1000 + pycor ] of [ neighbors ] of patch 0 4' } },
  { name: 'diffuse-wrap', setup: 'ca resize-world -3 3 -3 3 ask patches [ set countdown pxcor * 3 + pycor * pycor ] diffuse countdown 0.5 diffuse countdown 0.3 reset-ticks',
    metrics: { values: 'map [ p -> [countdown] of p ] sort patches' } },
  { name: 'diffuse-box', wrap: false, setup: 'ca resize-world -3 3 -3 3 ask patches [ set countdown pxcor * 3 + pycor * pycor ] diffuse countdown 0.5 diffuse countdown 0.3 reset-ticks',
    metrics: { values: 'map [ p -> [countdown] of p ] sort patches' } },
  { name: 'diffuse4-wrap', setup: 'ca resize-world -3 3 -3 3 ask patches [ set countdown pxcor * 3 + pycor * pycor ] diffuse4 countdown 0.4 reset-ticks',
    metrics: { values: 'map [ p -> [countdown] of p ] sort patches' } },
  { name: 'lists', setup: 'ca reset-ticks',
    metrics: { stats: `(list mean ${L} median ${L} variance ${L} standard-deviation ${L} sum ${L} max ${L} min ${L} median [4 1 3 2])` } },
  { name: 'hatch-sprout', setup: 'ca resize-world -10 10 -10 10 crt 1 [ setxy 1.5 2.5 set heading 77 set energy 12.5 hatch 2 [ fd 1 set energy energy + 1 ] ] ask patch 2 -3 [ sprout 3 [ set energy 7 ] ] reset-ticks',
    metrics: { turtles: 'map [ t -> [ (list who xcor ycor energy) ] of t ] sort turtles', hatchedHeadings: 'map [ t -> [heading] of t ] sort turtles with [ who < 3 ]' } },
  { name: 'links-undirected', setup: `ca resize-world -10 10 -10 10 crt 6 ask turtle 0 [ create-links-with other turtles ] ask turtle 1 [ create-link-with turtle 2 create-link-with turtle 0 ] reset-ticks`,
    metrics: { links: 'count links', n0: '[count link-neighbors] of turtle 0', n1: '[sort [who] of link-neighbors] of turtle 1', my1: '[count my-links] of turtle 1', ends: 'map [ l -> [ (list [who] of end1 [who] of end2) ] of l ] sort links' } },
  { name: 'links-die', setup: `ca resize-world -10 10 -10 10 crt 6 ask turtle 0 [ create-links-with other turtles ] ask turtle 1 [ create-link-with turtle 2 ] ask turtle 0 [ die ] reset-ticks`,
    metrics: { links: 'count links', n1: '[sort [who] of link-neighbors] of turtle 1' } },
  { name: 'links-directed', setup: `ca resize-world -10 10 -10 10 crt 5 ask turtle 3 [ create-link-to turtle 4 create-link-to turtle 0 ] ask turtle 4 [ create-link-to turtle 3 ] ask turtle 3 [ create-link-to turtle 4 ] reset-ticks`,
    metrics: { links: 'count links', out3: '[sort [who] of out-link-neighbors] of turtle 3', in3: '[sort [who] of in-link-neighbors] of turtle 3', myOut4: '[count my-out-links] of turtle 4', myIn0: '[count my-in-links] of turtle 0' } },
  { name: 'sorting', setup: 'ca crt 6 [ set energy (who * 7) mod 11 ] reset-ticks',
    metrics: { sortOn: 'map [ t -> [who] of t ] sort-on [ energy ] turtles', maxN: 'sort [ who ] of max-n-of 3 turtles [ energy ]', minN: 'sort [ who ] of min-n-of 2 turtles [ energy ]', maxOne: '[who] of max-one-of turtles [ energy ]', minOne: '[who] of min-one-of turtles [ energy ]' } },
  { name: 'headings', setup: 'ca reset-ticks',
    metrics: { subtract: `(list ${HEADS.map(([a, b]) => `subtract-headings ${a} ${b}`).join(' ')})` } },
  { name: 'random', setup: 'ca random-seed 4321 reset-ticks',
    metrics: { normal: 'n-values 3000 [ random-normal 10 3 ]', poisson: 'n-values 3000 [ random-poisson 4 ]', poisson40: 'n-values 2000 [ random-poisson 40 ]', exponential: 'n-values 3000 [ random-exponential 2 ]', int7: 'n-values 3000 [ random 7 ]', float: 'n-values 3000 [ random-float 5 ]' } },
  { name: 'sampling', setup: 'ca random-seed 99 crt 5 set max-sheep n-values 2000 [ sort [ who ] of n-of 2 turtles ] reset-ticks',
    metrics: { nOf2: 'max-sheep', oneOf: 'n-values 3000 [ [who] of one-of turtles ]' } },
  { name: 'ask-order', setup: 'ca random-seed 7 crt 5 set max-sheep [] repeat 2000 [ let firsts [] ask turtles [ set firsts lput who firsts ] set max-sheep lput first firsts max-sheep ] reset-ticks',
    metrics: { first: 'max-sheep' } },
];
