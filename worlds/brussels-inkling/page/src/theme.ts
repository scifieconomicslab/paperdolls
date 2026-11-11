// paperdolls — Mantine theme derived from the look tokens (reference; adapt).
// One theme drives the canvas chrome and the panels, so the page reads as one
// object in every look. Do not hard-code colours in components.

import { createTheme, type MantineColorsTuple, type MantineThemeOverride } from '@mantine/core';

export interface UiTokens {
  bg: string;
  surface: string;
  text: string;
  dim: string;
  line: string;
  accent: string;
  data: string;
  noData: string;
}

export function makeTheme(t: UiTokens): MantineThemeOverride {
  const accent: MantineColorsTuple = [
    t.accent, t.accent, t.accent, t.accent, t.accent,
    t.accent, t.accent, t.accent, t.accent, t.accent,
  ] as unknown as MantineColorsTuple;

  return createTheme({
    primaryColor: 'pd',
    colors: { pd: accent },
    fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
    fontFamilyMonospace: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    defaultRadius: 'md',
    headings: { fontWeight: '600' },
    components: {
      Button: { defaultProps: { radius: 'md' } },
      ActionIcon: { defaultProps: { variant: 'default' } },
      Paper: { defaultProps: { withBorder: true } },
      Tooltip: { defaultProps: { withArrow: true } },
    },
    other: { tokens: t },
  });
}

/** CSS variables the canvas chrome reads. */
export function cssVars(t: UiTokens): Record<string, string> {
  return {
    '--pd-bg': t.bg,
    '--pd-surface': t.surface,
    '--pd-text': t.text,
    '--pd-dim': t.dim,
    '--pd-line': t.line,
    '--pd-accent': t.accent,
    '--pd-data': t.data,
    '--pd-nodata': t.noData,
  };
}
