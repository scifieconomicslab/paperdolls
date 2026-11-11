// Shared browser launcher for the bench scripts.
// Real GPU first (ANGLE/GL); SwiftShader is not a verdict.
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

const CANDIDATES = [
  process.env.CHROMIUM_PATH,
  '/usr/bin/brave-browser',
  '/opt/brave.com/brave/brave',
  '/usr/bin/chromium',
  '/usr/bin/google-chrome',
].filter(Boolean);

export function findExecutable() {
  for (const p of CANDIDATES) if (existsSync(p)) return p;
  return undefined; // playwright's bundled chromium
}

export async function launch() {
  const executablePath = findExecutable();
  return chromium.launch({
    ...(executablePath ? { executablePath } : {}),
    args: ['--use-angle=gl', '--ignore-gpu-blocklist', '--enable-gpu'],
  });
}
