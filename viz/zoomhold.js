/* zoomhold.js: smooth zooming by letting the compositor do it. No drawing, so it can be tested in Node.
 *
 * While the wheel (or a key, a slider or a pinch) is changing the scale, the canvas that is already drawn is moved and scaled with a CSS transform,
 * which the browser applies on the GPU with no JavaScript and no raster work, whatever the scene size. Nothing is redrawn until the scale has been
 * still for settleMs (a wheel sends events a few frames apart, so a pause of a frame or two is not the end of a zoom), and then one real frame is drawn
 * and the transform is cleared. A zoom that stretches the picture beyond 0.3 to 8 times (minRatio, maxRatio) is drawn for real and becomes the new base.
 * People and vehicles hold still for the length of a zoom.
 *
 *   const hold = ZoomHold.create(canvas, { settleMs: 120 });
 *   // each frame:
 *   if (hold.shouldRender(view, performance.now())) { renderFrame(...); hold.rendered(view); }
 *
 * view is { w, h, scale, ox, oy } in css pixels. The canvas must be inside a box that clips it and takes the pointer events, because a transformed
 * element reports a transformed bounding box.
 */
(function (root) {
  'use strict';
  function create(el, opts) {
    opts = Object.assign({ settleMs: 120, minRatio: 0.3, maxRatio: 8 }, opts || {});
    let drawn = null, prevScale = NaN, lastChange = -Infinity;
    const clear = () => { el.style.transform = 'none'; };
    return {
      // true when the caller should draw a real frame now; false when the canvas has been stretched to match the view instead
      shouldRender(view, now) {
        if (!drawn || drawn.w !== view.w || drawn.h !== view.h) return true;
        if (view.scale !== prevScale) { if (prevScale === prevScale) lastChange = now; prevScale = view.scale; }
        if (now - lastChange >= opts.settleMs) return true;
        const r = view.scale / drawn.scale;
        if (r < opts.minRatio || r > opts.maxRatio) return true;
        el.style.transformOrigin = '0 0';
        el.style.transform = 'translate(' + (view.ox - drawn.ox * r) + 'px, ' + (view.oy - drawn.oy * r) + 'px) scale(' + r + ')';
        return false;
      },
      // the caller drew a real frame at this view: it is now the base, and the canvas shows it as it is
      rendered(view) { drawn = { w: view.w, h: view.h, scale: view.scale, ox: view.ox, oy: view.oy }; prevScale = view.scale; clear(); },
      // forget the base (after the canvas is resized or cleared)
      reset() { drawn = null; prevScale = NaN; lastChange = -Infinity; clear(); }
    };
  }
  root.ZoomHold = { create };
})(typeof window !== 'undefined' ? window : globalThis);
