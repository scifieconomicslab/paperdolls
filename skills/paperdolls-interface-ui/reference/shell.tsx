// paperdolls — Mantine shell (reference; copy and adapt per world).
// Layout: fluid canvas + right sidebar + full-width bottom dock + analyst drawer.
// Policy view is the default; the analyst layer is explicit. See
// skills/paperdolls-interface-ui/SKILL.md for the polish contract.

import { useState, type ReactNode } from 'react';
import { ActionIcon, Button, Divider, Drawer, Group, MantineProvider, Paper, ScrollArea, Slider, Stack, Text, Tooltip } from '@mantine/core';
import { IconFocus, IconInfoCircle, IconPlayerPause, IconPlayerPlay, IconRotateClockwise } from '@tabler/icons-react';
import { makeTheme, cssVars, type UiTokens } from './theme.ts';

export interface ShellProps {
  tokens: UiTokens;
  title: string;
  description: string;
  attribution: ReactNode;
  canvas: ReactNode;
  controls: ReactNode;
  timeline: { tick: number; horizon: number; unit: string; playing: boolean; speed: number; onPlay(): void; onSpeed(n: number): void };
  legend: ReactNode;
  outputs: ReactNode;
  impact?: ReactNode;
  analyst: ReactNode;
  onFit(): void;
  onRotate(): void;
}

export function Shell(p: ShellProps) {
  const [analyst, setAnalyst] = useState(false);
  return (
    <MantineProvider theme={makeTheme(p.tokens)} forceColorScheme="light">
      <div style={{ ...(cssVars(p.tokens) as React.CSSProperties), height: '100vh', display: 'grid', gridTemplateRows: '1fr auto', background: 'var(--pd-bg)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 268px', minHeight: 0 }}>
          {/* canvas */}
          <div style={{ position: 'relative', overflow: 'hidden' }}>
            {p.canvas}
            <Group gap={8} style={{ position: 'absolute', top: 12, right: 12 }}>
              <Tooltip label="Fit the map (F)"><ActionIcon size="lg" aria-label="Fit map" onClick={p.onFit}><IconFocus size={18} stroke={1.5} /></ActionIcon></Tooltip>
              <Tooltip label="Rotate 90° (R)"><ActionIcon size="lg" aria-label="Rotate 90 degrees" onClick={p.onRotate}><IconRotateClockwise size={18} stroke={1.5} /></ActionIcon></Tooltip>
            </Group>
          </div>

          {/* right sidebar: controls only */}
          <Paper radius={0} style={{ borderLeft: '1px solid var(--pd-line)', overflow: 'hidden' }}>
            <ScrollArea h="100%" p={16}>
              <Group justify="space-between" mb={4}>
                <Text fw={600}>{p.title}</Text>
                <Tooltip label="About this model"><ActionIcon size="sm" aria-label="About" onClick={() => setAnalyst(true)}><IconInfoCircle size={16} stroke={1.5} /></ActionIcon></Tooltip>
              </Group>
              <Text size="xs" c="dimmed" mb={12}>{p.description}</Text>
              <Divider mb={12} />
              {p.controls}
              <Divider my={12} />
              <Text size="xs" c="dimmed">{p.attribution}</Text>
            </ScrollArea>
          </Paper>
        </div>

        {/* bottom dock */}
        <div style={{ borderTop: '1px solid var(--pd-line)', background: 'var(--pd-surface)', display: 'grid', gridTemplateColumns: '260px 1fr 1fr', gap: 16, padding: '10px 16px', minHeight: 128 }}>
          <Stack gap={6}>
            <Group gap={8}>
              <ActionIcon size="lg" aria-label={p.timeline.playing ? 'Pause' : 'Play'} onClick={p.timeline.onPlay}>
                {p.timeline.playing ? <IconPlayerPause size={18} /> : <IconPlayerPlay size={18} />}
              </ActionIcon>
              <Text size="sm" fw={600} ff="monospace">{p.timeline.tick} / {p.timeline.horizon} {p.timeline.unit}</Text>
            </Group>
            <Text size="xs" c="dimmed">Speed</Text>
            <Slider value={p.timeline.speed} min={0.25} max={4} step={0.25} onChange={p.timeline.onSpeed} aria-label="Playback speed" />
          </Stack>
          <div>{p.outputs}</div>
          <div>{p.impact ?? p.legend}</div>
        </div>
      </div>

      <Drawer opened={analyst} onClose={() => setAnalyst(false)} title="Analyst view" position="right" size="md" scrollAreaComponent={ScrollArea}>
        {p.analyst}
      </Drawer>
    </MantineProvider>
  );
}
