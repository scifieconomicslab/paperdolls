// Ported from github.com/scifieconomicslab/paperdolls @ f9a1a59 (CC BY 4.0). packages/world/src/types.ts.
// The World format (plan 3.2): one format for every kind of world a model stands on. Coordinates are metres in the world's own frame
// (x to the right, y forward, as the scene format and the engine's projection use them).
export type Pt = [number, number];
export type AttrValue = number | string | boolean | null | string[] | number[];
export type Geom = { type: 'Polygon'; coords: Pt[] } | { type: 'LineString'; coords: Pt[] } | { type: 'Point'; coords: Pt };
export interface Feature { id: string; geom: Geom; attrs: Record<string, AttrValue> }
/** A graph that agents move along: nodes are points, edges join two nodes and remember the feature they came from. */
export interface Network { nodes: Pt[]; edges: [a: number, b: number, length: number, feature: number][] }
/** A regular height grid (metres), row-major: row j is y = y0 + j * dy. The scene format's `terrain`. */
export interface HeightGrid { x0: number; y0: number; dx: number; dy: number; nx: number; ny: number; z: number[] }
export interface Region { id: string; geom: { type: 'Polygon'; coords: Pt[] }; attrs: Record<string, AttrValue> }
export interface World {
  spec: 1;
  frame: { units: 'm'; extent: [number, number, number, number]; north_deg: number };
  source: Record<string, unknown>;                       // where it came from: for OSM the scene's `area` block (name, attribution, origin, rotation ...)
  layers: Record<string, Feature[]>;                     // buildings, roads, landuse, trees, parcels, tiles, nodes ...
  networks: Record<string, Network>;                     // roads ...
  terrain?: HeightGrid;
  regions: Record<string, Region[]>;
}
