// The art bible's palette (worlds/brussels-inkling/art-bible.md), authored in OKLCH.
// palette-method.md §4: author [L, C, h], convert once. Every scene colour comes from here.

export function oklch(L: number, C: number, hDeg: number): string {
  const h = (hDeg * Math.PI) / 180, a = C * Math.cos(h), b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  const lin = [
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];
  const enc = (x: number) => {
    x = Math.min(1, Math.max(0, x));
    return x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
  };
  return '#' + lin.map((x) => Math.round(enc(x) * 255).toString(16).padStart(2, '0')).join('');
}

export type LCH = [number, number, number];
export const hex = (c: LCH) => oklch(c[0], c[1], c[2]);

export const P = {
  ground: [0.93, 0.012, 85] as LCH,
  sidewalk: [0.875, 0.014, 78] as LCH,
  kerb: [0.88, 0.012, 85] as LCH,
  road: [0.55, 0.008, 250] as LCH,
  walls: [
    [0.56, 0.075, 35],   // red brick
    [0.62, 0.062, 48],   // brown brick
    [0.74, 0.052, 80],   // gault / Flemish yellow
    [0.84, 0.016, 88],   // render
  ] as LCH[],
  roofs: [
    [0.40, 0.020, 255],  // slate
    [0.44, 0.065, 42],   // clay pantile
    [0.34, 0.028, 32],   // dark glazed tile
  ] as LCH[],
  trim: [0.93, 0.010, 90] as LCH,
  glass: [0.52, 0.032, 238] as LCH,
  veg: [
    [0.56, 0.095, 140],  // green
    [0.62, 0.085, 118],  // olive
    [0.66, 0.105, 125],  // fresh late-May
  ] as LCH[],
  lawn: [0.68, 0.075, 128] as LCH,
  water: [0.60, 0.055, 222] as LCH,
  accent: [
    [0.55, 0.105, 172],  // bottle green — doors, awnings, shopfronts
    [0.50, 0.095, 205],  // deep teal — enamel signs
  ] as LCH[],
  ink: [0.22, 0.018, 45] as LCH,
  skyTop: [0.78, 0.055, 245] as LCH,
  horizon: [0.93, 0.030, 90] as LCH,
  noData: [0.64, 0.008, 90] as LCH,
  soil: [0.55, 0.030, 60] as LCH,
  rock: [0.45, 0.025, 55] as LCH,
  paving: [0.87, 0.016, 70] as LCH,
  concrete: [0.78, 0.010, 90] as LCH,
  metal: [0.62, 0.008, 250] as LCH,
  wood: [0.45, 0.055, 60] as LCH,
  dark: [0.26, 0.015, 40] as LCH,
  paper: [0.94, 0.015, 85] as LCH,
  tramBallast: [0.46, 0.008, 90] as LCH,
};

// Light (art bible §Light; light-and-time.md §2 kelvin table). 3 pm, late May: high sun, short shadows.
export const LIGHT = {
  keyAzimuthDeg: 220, keyElevationDeg: 50,
  key: '#ffedd6', keyIntensity: 2.7,          // 4,900 K
  fill: '#dfe8ff', fillIntensity: 1.72,       // 8,500 K
  lamp: '#ffb46b',                            // 2,700 K (windows only; mid-afternoon, lamps off)
  exposure: 1.32,
};

// Data ramp "plum" (palette-method §3): L 0.93 -> 0.35, C 0.025 -> 0.13, h 318 -> 352.
export function plum(t: number): string {
  const x = Math.min(1, Math.max(0, t));
  const L = 0.93 + (0.35 - 0.93) * x;
  const C = 0.025 + 0.105 * Math.sin(Math.min(1, x * 1.15) * Math.PI / 2);
  const h = 318 + 34 * x;
  return oklch(L, C, h);
}
export const RAMP_STOPS = [0, 0.25, 0.5, 0.75, 1].map(plum);
export const NO_DATA = hex(P.noData);

/** UI tokens taken from the same table, so chrome and world read as one object (palette-method §6). */
export const UI_TOKENS = {
  bg: oklch(0.95, 0.010, 80),
  surface: oklch(0.985, 0.006, 85),
  text: oklch(0.24, 0.020, 40),
  dim: oklch(0.48, 0.018, 50),
  line: oklch(0.88, 0.012, 75),
  accent: oklch(0.42, 0.095, 172),
  data: plum(0.75),
  noData: NO_DATA,
};
