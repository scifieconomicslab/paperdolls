/* controls.js: mouse, touch and keyboard input for a LabCamera.
 *
 *   drag            pan (mouse button 1 or 2, or one finger)
 *   mouse wheel     zoom, anchored on the cursor (a trackpad pinch also arrives as a wheel event)
 *   pinch           zoom and pan (two fingers)
 *   A and D         pan left and right (hold to keep moving)
 *   W and S         zoom in and out (hold to keep zooming)
 *
 * `smoothZoom: true` eases a wheel zoom in over a few frames (about 14 per second of the distance left, so about 200 ms) instead of applying it at once;
 * notches add up, the point under the cursor stays under it, and controls.tick(dt) does the easing, so it is testable. `controls.setOption(name, value)` changes it live.
 *
 * Keys are ignored while a text field, a menu or a text area has the focus, when Ctrl, Alt or Meta is down, and after the window
 * loses focus. Motion is time based, so it runs at the same speed at any frame rate.
 *
 *   const controls = LabControls.attach(canvas, camera, { onChange: redraw });
 *   controls.destroy();
 *
 * `opts.raf: false` turns off the animation loop; call `controls.tick(seconds)` yourself, which is how the tests drive it.
 */
(function (root) {
  'use strict';
  const KEYS = { a: 'left', d: 'right', w: 'in', s: 'out' };
  const TYPING = new Set(['text', 'search', 'url', 'tel', 'email', 'password', 'number', 'date', 'datetime-local', 'month', 'time', 'week']);

  // true when the key press belongs to a form field and not to the viewer
  function isTyping(el) {
    if (!el || !el.tagName) return false;
    const tag = el.tagName.toUpperCase();
    if (tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable) return true;
    return tag === 'INPUT' && TYPING.has((el.type || 'text').toLowerCase());
  }

  function attach(canvas, cam, opts) {
    const doc = canvas.ownerDocument, win = doc.defaultView || root;
    opts = Object.assign({ onChange() {}, panSpeed: 520, zoomRate: 0.9, raf: true, keys: true, smoothZoom: false, zoomEase: 14 }, opts || {});
    const held = new Set(), pointers = new Map();
    let pinch = null, rafId = 0, last = 0;
    let pend = 0, pendX, pendY;           // smoothZoom: the zoom still to apply, as a log of the factor, and where it is anchored
    const rect = () => canvas.getBoundingClientRect();

    // ---- pointer: drag to pan, two fingers to pinch ----
    function down(e) {
      if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1) return;
      pointers.set(e.pointerId, [e.clientX, e.clientY]);
      if (canvas.setPointerCapture) { try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* a synthetic pointer has nothing to capture */ } }
      canvas.classList.add('dragging');
      if (pointers.size === 2) { const p = [...pointers.values()]; pinch = Math.hypot(p[0][0] - p[1][0], p[0][1] - p[1][1]); }
    }
    function move(e) {
      if (!pointers.has(e.pointerId)) return;
      const prev = pointers.get(e.pointerId), cur = [e.clientX, e.clientY];
      pointers.set(e.pointerId, cur);
      if (pointers.size === 1) cam.panScreen(cur[0] - prev[0], cur[1] - prev[1]);
      else if (pointers.size === 2) {
        const p = [...pointers.values()], d = Math.hypot(p[0][0] - p[1][0], p[0][1] - p[1][1]), r = rect();
        cam.panScreen((cur[0] - prev[0]) / 2, (cur[1] - prev[1]) / 2);                  // each finger carries half of the midpoint's movement
        if (pinch && d > 0) cam.zoomAt(d / pinch, (p[0][0] + p[1][0]) / 2 - r.left, (p[0][1] + p[1][1]) / 2 - r.top);
        pinch = d;
      } else return;
      opts.onChange();
    }
    function up(e) { pointers.delete(e.pointerId); pinch = null; if (!pointers.size) canvas.classList.remove('dragging'); }

    // ---- wheel: zoom about the cursor ----
    function wheel(e) {
      e.preventDefault();
      let dy = e.deltaY;
      if (e.deltaMode === 1) dy *= 16; else if (e.deltaMode === 2) dy *= canvas.clientHeight || 700;     // lines and pages to pixels
      const r = rect(), f = Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0016));                                // a pinch on a trackpad sets ctrlKey and sends small steps
      if (opts.smoothZoom) { pend += Math.log(f); pendX = e.clientX - r.left; pendY = e.clientY - r.top; startLoop(); return; }   // eased in by tick()
      cam.zoomAt(f, e.clientX - r.left, e.clientY - r.top);
      opts.onChange();
    }

    // ---- keys: A and D pan, W and S zoom ----
    function keydown(e) {
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      const k = (e.key || '').toLowerCase();
      if (!(k in KEYS)) return;
      held.add(KEYS[k]);
      startLoop();
    }
    function keyup(e) { const k = (e.key || '').toLowerCase(); if (k in KEYS) held.delete(KEYS[k]); }
    const release = () => { held.clear(); pointers.clear(); pinch = null; canvas.classList.remove('dragging'); };

    // Move the camera for `dt` seconds with whatever keys are held. Returns true when the view changed.
    function tick(dt) {
      let moved = false;
      const px = opts.panSpeed * dt;
      if (held.has('left')) { cam.panView(-px, 0); moved = true; }           // A: the view moves left, so the map slides right
      if (held.has('right')) { cam.panView(px, 0); moved = true; }           // D
      if (held.has('in')) { cam.zoomAt(Math.exp(opts.zoomRate * dt)); moved = true; }     // W: about the middle of the canvas
      if (held.has('out')) { cam.zoomAt(Math.exp(-opts.zoomRate * dt)); moved = true; }   // S
      if (pend !== 0) {                  // an eased wheel zoom: a fraction of what is left each frame (ease-out), whatever the frame rate
        const part = Math.abs(pend) < 1e-4 ? pend : pend * (1 - Math.exp(-opts.zoomEase * dt)), before = cam.scale;
        cam.zoomAt(Math.exp(part), pendX, pendY); pend -= part; moved = true;
        if (Math.abs(Math.log(cam.scale / before)) < Math.abs(part) * 0.5) pend = 0;      // the camera's limit: nothing more to chase
        if (Math.abs(pend) < 1e-9) pend = 0;
      }
      if (moved) opts.onChange();
      return moved;
    }
    function loop(now) {
      rafId = 0;
      if (!held.size && pend === 0) { last = 0; return; }
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;       // a long pause must not make the view jump
      last = now; tick(dt);
      rafId = win.requestAnimationFrame(loop);
    }
    function startLoop() { if (opts.raf && !rafId) { last = 0; rafId = win.requestAnimationFrame(loop); } }

    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    for (const t of ['pointerup', 'pointercancel', 'pointerleave', 'lostpointercapture']) canvas.addEventListener(t, up);
    canvas.addEventListener('wheel', wheel, { passive: false });
    if (opts.keys) { doc.addEventListener('keydown', keydown); doc.addEventListener('keyup', keyup); win.addEventListener('blur', release); }

    return {
      tick, held: () => [...held].sort(), pendingZoom: () => pend,
      setOption(name, value) { opts[name] = value; if (name === 'smoothZoom' && !value) pend = 0; },
      destroy() {
        canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointermove', move);
        for (const t of ['pointerup', 'pointercancel', 'pointerleave', 'lostpointercapture']) canvas.removeEventListener(t, up);
        canvas.removeEventListener('wheel', wheel);
        doc.removeEventListener('keydown', keydown); doc.removeEventListener('keyup', keyup); win.removeEventListener('blur', release);
        if (rafId) win.cancelAnimationFrame(rafId);
        release();
      }
    };
  }

  root.LabControls = { attach, isTyping };
})(typeof window !== 'undefined' ? window : globalThis);
