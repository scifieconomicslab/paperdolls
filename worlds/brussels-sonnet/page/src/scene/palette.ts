// The art bible's palette, authored in OKLCH (worlds/brussels-sonnet/art-bible.md). One file: a bible change is a one-file change.
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
export const ramp = (t: number, [L0, C0, h0]: number[], [L1, C1, h1]: number[]) =>
  oklch(L0 + (L1 - L0) * t, C0 + (C1 - C0) * t, h0 + (h1 - h0) * t);

export type LCH = [number, number, number];
export const P = {
  ground: [0.95, 0.010, 85] as LCH,
  sidewalk: [0.88, 0.012, 80] as LCH,
  kerb: [0.91, 0.010, 80] as LCH,
  road: [0.50, 0.010, 255] as LCH,
  setts: [0.62, 0.012, 75] as LCH,
  walls: [
    { c: [0.60, 0.085, 38] as LCH, w: 0.38 },  // red brick
    { c: [0.68, 0.075, 52] as LCH, w: 0.22 },  // orange brick
    { c: [0.80, 0.045, 88] as LCH, w: 0.22 },  // cream stone / render
    { c: [0.85, 0.015, 90] as LCH, w: 0.18 },  // painted white
  ],
  roofs: [
    { c: [0.38, 0.020, 258] as LCH, w: 0.50 }, // slate
    { c: [0.46, 0.075, 45] as LCH, w: 0.30 },  // clay pantile
    { c: [0.34, 0.015, 250] as LCH, w: 0.20 }, // zinc
  ],
  trim: [0.94, 0.010, 90] as LCH,
  glass: [0.52, 0.035, 235] as LCH,
  veg: [[0.52, 0.095, 140], [0.62, 0.100, 128], [0.70, 0.105, 118]] as LCH[],
  lawn: [0.74, 0.085, 125] as LCH,
  water: [0.66, 0.065, 220] as LCH,
  accent: [[0.58, 0.105, 235], [0.62, 0.100, 205]] as LCH[],
  ink: [0.24, 0.020, 40] as LCH,
  skyTop: [0.84, 0.065, 240] as LCH,
  horizon: [0.94, 0.020, 85] as LCH,
  rampA: [0.93, 0.03, 285] as LCH, rampB: [0.66, 0.10, 307] as LCH, rampC: [0.38, 0.12, 330] as LCH,
  noData: [0.65, 0.005, 90] as LCH,
  soil: [0.55, 0.03, 60] as LCH, rock: [0.45, 0.025, 55] as LCH,
};
export const hex = ([L, C, h]: LCH) => oklch(L, C, h);

// light (bible): key 215 deg (SW), elevation 42 deg, 5200 K; fill 9500 K
export const LIGHT = { keyAz: 215, keyEl: 42, keyHex: '#ffe2c4', keyI: 2.6, fillHex: '#cfe0ff', hemiI: 1.8, exposure: 1.12, shadowTint: '#6e7886' };
