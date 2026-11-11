// The art bible's palette (worlds/brussels-deepseek/art-bible.md), authored in OKLCH.
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
  ground: [0.965, 0.012, 80] as LCH,
  sidewalk: [0.965, 0.010, 78] as LCH,
  kerb: [0.96, 0.008, 82] as LCH,
  road: [0.46, 0.012, 250] as LCH,
  walls: [
    [0.57, 0.093, 38],   // red-brown Brussels brick
    [0.63, 0.072, 50],   // brown brick
    [0.78, 0.060, 82],   // yellow brick
    [0.90, 0.016, 90],   // white-painted render
  ] as LCH[],
  roofs: [
    [0.34, 0.022, 255],  // slate
    [0.40, 0.035, 30],   // dark clay
    [0.54, 0.012, 240],  // zinc (flat roofs)
  ] as LCH[],
  trim: [0.93, 0.012, 85] as LCH,
  glass: [0.50, 0.030, 240] as LCH,
  veg: [
    [0.55, 0.090, 140],
    [0.62, 0.085, 125],
    [0.68, 0.075, 95],
  ] as LCH[],
  lawn: [0.70, 0.070, 130] as LCH,
  water: [0.62, 0.060, 220] as LCH,
  accent: [
    [0.58, 0.120, 190],  // teal
    [0.68, 0.120, 80],   // ochre
  ] as LCH[],
  ink: [0.24, 0.020, 40] as LCH,
  skyTop: [0.78, 0.060, 245] as LCH,
  horizon: [0.94, 0.022, 80] as LCH,
  noData: [0.65, 0.005, 90] as LCH,
  soil: [0.52, 0.030, 60] as LCH,
  rock: [0.44, 0.025, 55] as LCH,
  paving: [0.95, 0.012, 75] as LCH,
  concrete: [0.78, 0.010, 90] as LCH,
  metal: [0.62, 0.008, 250] as LCH,
  dark: [0.26, 0.015, 40] as LCH,
  paper: [0.94, 0.015, 85] as LCH,
  cladding: [0.80, 0.030, 135] as LCH,
  pennant: [0.52, 0.110, 195] as LCH,
};

// Light (art bible §Light; light-and-time.md §2 kelvin table): 3 pm late May, clear.
export const LIGHT = {
  keyAzimuthDeg: 175, keyElevationDeg: 42,
  key: '#ffe0b8', keyIntensity: 2.7,          // ~5,000 K
  fill: '#d6e1ff', fillIntensity: 1.45,       // 9,000 K
  lamp: '#ffb46b',                            // 2,700 K
  exposure: 1.3,
};

// Data ramp "plum" (palette-method §3): ordered, monotonic L, hue 300 → 340.
// Low state is a muted grey-plum so the beauty view stays brick-and-slate; only a
// fully retrofitted building takes the deep plum.
export function plum(t: number): string {
  const x = Math.min(1, Math.max(0, t));
  const L = x <= 0.5 ? 0.63 + (0.50 - 0.63) * (x / 0.5) : 0.50 + (0.38 - 0.50) * ((x - 0.5) / 0.5);
  const C = 0.035 + 0.065 * x;
  const h = 300 + 40 * x;
  return oklch(L, C, h);
}
export const RAMP_STOPS = [0, 0.5, 1].map(plum);
export const NO_DATA = hex(P.noData);

/** UI tokens taken from the same table, so chrome and world read as one object (palette-method §6). */
export const UI_TOKENS = {
  bg: oklch(0.95, 0.010, 80),
  surface: oklch(0.985, 0.006, 85),
  text: oklch(0.24, 0.020, 40),
  dim: oklch(0.48, 0.018, 50),
  line: oklch(0.88, 0.012, 75),
  accent: oklch(0.46, 0.095, 195),
  data: plum(0.72),
  noData: NO_DATA,
};
