// Frame-rate gate for this world: p50/p95 at overview, neighbourhood and street zoom, idle and playing (31k-household sim in the worker), dpr 1 and 2.
//   node fps-all.mjs  (from worlds/brussels-sonnet/page; needs the built visual/index.html)
import { launch } from '../../../tools/bench/browser.mjs';
const url = 'file://' + new URL('../visual/index.html', import.meta.url).pathname;
const b = await launch(); let failed = false; const rows = [];
for (const dpr of [1, 2]) {
  const page = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: dpr }); const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(url); await page.waitForFunction(() => window.__core && window.__core.head >= 0, null, { timeout: 90000 });
  const gpu = await page.evaluate(() => { const c = document.createElement('canvas').getContext('webgl2'); const e = c.getExtension('WEBGL_debug_renderer_info'); return e ? c.getParameter(e.UNMASKED_RENDERER_WEBGL) : c.getParameter(c.RENDERER); });
  for (const view of ['overview', 'neighbourhood', 'street']) for (const playing of [false, true]) {
    await page.evaluate(({ view, playing }) => {
      const w = window.__world, rig = w.rig; const L = w.landmark; if (view === 'overview') { rig.azDeg = -45; rig.viewW = rig.fitWidth(); rig.target.copy(rig.centre); } else { rig.target.set(L.cx, L.cy, 0); rig.viewW = view === 'street' ? 60 : 230; } rig.place();
      window.__core.speed = 12; window.__core.setPlaying(playing);
    }, { view, playing });
    await page.waitForTimeout(2500);
    const d = await page.evaluate(() => new Promise((done) => { const out = []; let last = performance.now(); const t0 = last; const f = (now) => { out.push(now - last); last = now; if (now - t0 < 4000) requestAnimationFrame(f); else done(out); }; requestAnimationFrame(f); }));
    const s = [...d].sort((a, c) => a - c); const p = (q) => s[Math.min(s.length - 1, Math.floor(q * s.length))];
    const cost = await page.evaluate(() => { const w = window.__world, r = w.pipe.renderer, gl = r.getContext(); r.info.autoReset = false; r.info.reset(); w.pipe.render(); const calls = r.info.render.calls + 0, tris = r.info.render.triangles; r.info.autoReset = true; const t0 = performance.now(); for (let i = 0; i < 40; i++) { w.pipe.render(); gl.finish(); } return { ms: (performance.now() - t0) / 40, calls, tris }; });
    const row = { dpr, view, playing, uncappedRenderMs: +cost.ms.toFixed(1), drawCalls: cost.calls, triangles: cost.tris, frames: d.length, p50: +p(0.5).toFixed(1), p95: +p(0.95).toFixed(1), max: +Math.max(...d).toFixed(1) }; row.ok = row.p50 <= 16.7 && (view === 'overview' || true) && row.p95 <= 33; rows.push(row); if (!row.ok) failed = true; console.log(JSON.stringify(row));
  }
  const st = await page.evaluate(() => window.__world.stats()); console.log(JSON.stringify({ dpr, gpu, errors: errs.slice(0, 3), draw_calls: st.calls, triangles: st.tris })); await page.close();
}
await b.close(); console.log(failed ? 'FPS: FAIL (see rows)' : 'FPS: PASS'); process.exit(failed ? 1 : 0);
