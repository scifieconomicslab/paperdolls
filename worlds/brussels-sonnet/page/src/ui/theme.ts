import { createTheme } from '@mantine/core';
import { oklch, P, hex } from '../scene/palette';
// One Mantine theme from the art bible's palette (ui tokens). No colour is hard-coded in components.
export const T = {
  bg: oklch(0.965, 0.008, 85), surface: oklch(0.985, 0.006, 85), text: oklch(0.24, 0.02, 40), dim: oklch(0.46, 0.02, 60), line: oklch(0.87, 0.012, 80),
  accent: oklch(0.50, 0.105, 235), accentSoft: oklch(0.93, 0.03, 235), data: hex(P.rampC), rampA: hex(P.rampA), rampB: hex(P.rampB), noData: hex(P.noData),
  q: [0, 1, 2, 3, 4].map((k) => oklch(0.78 - k * 0.115, 0.08 + k * 0.012, 285 + k * 12)),
};
export const theme = createTheme({
  primaryColor: 'pd', colors: { pd: Array(10).fill(T.accent) as any },
  fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', fontFamilyMonospace: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  defaultRadius: 'md', headings: { fontWeight: '600' },
  components: { ActionIcon: { defaultProps: { variant: 'default' } }, Paper: { defaultProps: { withBorder: true } }, Tooltip: { defaultProps: { withArrow: true } } },
});
export const cssVars = { '--pd-bg': T.bg, '--pd-surface': T.surface, '--pd-text': T.text, '--pd-dim': T.dim, '--pd-line': T.line, '--pd-accent': T.accent, '--pd-data': T.data, '--pd-nodata': T.noData, '--mantine-color-dimmed': T.dim, '--mantine-color-placeholder': T.dim } as React.CSSProperties;
export const HATCH = `repeating-linear-gradient(45deg, ${T.noData} 0 3px, oklch(0.80 0.005 90) 3px 6px)`;
