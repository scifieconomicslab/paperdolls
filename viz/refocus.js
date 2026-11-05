/* refocus.js: the picture stretches while you zoom, then comes into focus. No drawing and no DOM beyond a few style properties, so it is tested in Node.
 *
 * It sits on top of zoomhold.js. While the scale changes, the drawn canvas is stretched (the compositor does it). When the zoom stops, the real frame
 * is drawn on a SECOND canvas stacked on top, invisible, so the stretched picture stays up while sprites and layers finish; when that frame is whole
 * (isDone) or after maxWaitMs, it fades in over fadeMs and the two swap roles. The viewer never sees a half-drawn frame or a pop.
 *
 * Optional dressing, all driven by the same events: a reticle (four corner brackets, any element) that seeks at the cursor while the picture is out of
 * focus and locks when the sharp frame arrives, and a blur on the stretched picture in proportion to the stretch, like a lens that has lost focus.
 *
 *   const rf = Refocus.create({ hold, front, back, reticle, isDone: () => nothingPending });
 *   rf.anchor(x, y);                                        // where the reticle goes (the cursor, in css pixels inside the stage)
 *   rf.frame(view, performance.now(), canvas => renderOn(canvas));   // each animation frame
 *
 * hold must be bound to front. enabled: false gives the plain behaviour (draw on the front canvas when zoomhold says so).
 */
(function (root) {
  'use strict';
  function create(o) {
    o = Object.assign({ fadeMs: 160, maxWaitMs: 500, lockMs: 700, blur: false, maxBlur: 6, blurK: 4, enabled: true, isDone: () => true }, o);
    const hold = o.hold, reticle = o.reticle;
    let front = o.front, back = o.back, state = 'live', since = 0, fadeEnd = 0, lockUntil = 0, ax = null, ay = null;
    const hideBack = () => { back.style.transition = 'none'; back.style.opacity = '0'; };
    const layers = () => { front.style.zIndex = '1'; back.style.zIndex = '2'; };
    const cue = (cls) => { if (reticle) reticle.className = cls; };
    function seek() {
      lockUntil = 0;
      if (reticle) { if (ax !== null) { reticle.style.left = ax + 'px'; reticle.style.top = ay + 'px'; } cue('fx seek'); }
    }
    function applyBlur() {
      if (!o.blur) return;
      const px = Math.min(o.maxBlur, o.blurK * Math.abs(Math.log(hold.ratio())));
      front.style.filter = px > 0.2 ? 'blur(' + px.toFixed(1) + 'px)' : 'none';
    }
    function finish(view, now) {                              // the back canvas is whole and shown: it becomes the front, the old front is hidden and becomes the back
      hold.rebind(back); hold.rendered(view);
      front.style.transition = 'none'; front.style.opacity = '0'; front.style.transform = 'none'; front.style.filter = 'none';
      const t = front; front = back; back = t;
      hideBack(); layers(); state = 'live';
      if (reticle) { cue('fx lock'); lockUntil = now + o.lockMs; }
    }
    function startFade(view, now) {
      if (!(o.fadeMs > 0)) { finish(view, now); return; }
      back.style.transition = 'opacity ' + o.fadeMs + 'ms ease-out'; back.style.opacity = '1';
      fadeEnd = now + o.fadeMs; state = 'fade';
      if (reticle) cue('fx lock');
    }
    function refine(view, now, render) {
      render(back);
      if (o.isDone() || now - since >= o.maxWaitMs) startFade(view, now);
    }
    hideBack(); layers();
    return {
      state: () => state, front: () => front, back: () => back,
      anchor(x, y) { ax = x; ay = y; },
      set(name, value) { o[name] = value; if (name === 'enabled' && !value) this.reset(); },
      reset() { hold.reset(); hold.rebind(front); hideBack(); front.style.filter = 'none'; state = 'live'; lockUntil = 0; cue(''); },
      frame(view, now, render) {
        const want = hold.shouldRender(view, now);
        if (lockUntil && now >= lockUntil) { lockUntil = 0; cue(''); }
        if (!o.enabled) { if (want) { render(front); hold.rendered(view); } return; }
        if (state === 'live') {
          if (want) { render(front); hold.rendered(view); } else { state = 'zoom'; seek(); applyBlur(); }
        } else if (state === 'zoom') {
          if (!want) applyBlur(); else { state = 'refine'; since = now; refine(view, now, render); }
        } else if (state === 'refine') {
          if (!want) { hideBack(); state = 'zoom'; seek(); applyBlur(); } else refine(view, now, render);
        } else {                                              // fade
          if (!want) { hideBack(); state = 'zoom'; seek(); applyBlur(); }
          else { render(back); if (now >= fadeEnd) finish(view, now); }
        }
      }
    };
  }
  root.Refocus = { create };
})(typeof window !== 'undefined' ? window : globalThis);
