/* camera.js: the viewer's camera. No DOM, so it can be tested in Node.
 *
 * The camera looks at a point (cx, cy) on the ground plane, in metres, at `scale` pixels per metre. The isometric projection is
 *   screen x = ox + (x - y) * scale * cos30     screen y = oy + (x + y) * scale * 0.5 - z * scale
 * with ox and oy chosen so that (cx, cy) sits at the middle of the canvas.
 *
 * Every method that moves the view keeps the camera inside its limits: the scale stays between minScale and maxScale, and the centre
 * stays near the scene, so the map cannot be lost off screen.
 */
(function (root) {
  'use strict';
  const C30 = 0.8660254;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function create(opts) {
    opts = Object.assign({ bounds: [0, 0, 100, 100], width: 1200, height: 700, maxScale: 32, margin: 0.2, fitMargin: 0.06, minFactor: 0.85 }, opts || {});
    const cam = { cx: 0, cy: 0, scale: 1, w: opts.width, h: opts.height, fit: 1, minScale: 1, maxScale: opts.maxScale, bounds: opts.bounds.slice() };

    // The scale that shows the whole scene. An isometric box of ground (dx by dy metres) is (dx + dy) * cos30 wide and (dx + dy) / 2 tall.
    function computeFit() {
      const B = cam.bounds, S = (B[2] - B[0]) + (B[3] - B[1]);
      cam.fit = Math.max(1e-4, Math.min((cam.w * (1 - opts.fitMargin)) / (S * C30 + 1), (cam.h * (1 - opts.fitMargin)) / (S * 0.5 + 1)));
      cam.minScale = cam.fit * opts.minFactor;
      if (cam.maxScale < cam.minScale * 2) cam.maxScale = cam.minScale * 2;
    }
    function clampCentre() {
      const B = cam.bounds, mx = (B[2] - B[0]) * opts.margin, my = (B[3] - B[1]) * opts.margin;
      cam.cx = clamp(cam.cx, B[0] - mx, B[2] + mx); cam.cy = clamp(cam.cy, B[1] - my, B[3] + my);
    }

    // The projection origin that puts the centre in the middle of the canvas.
    cam.view = function () { return { w: cam.w, h: cam.h, scale: cam.scale, ox: cam.w / 2 - (cam.cx - cam.cy) * cam.scale * C30, oy: cam.h / 2 - (cam.cx + cam.cy) * cam.scale * 0.5 }; };

    // The ground point under a canvas pixel.
    cam.screenToWorld = function (px, py) {
      const v = cam.view(), a = (px - v.ox) / (cam.scale * C30), b = (py - v.oy) * 2 / cam.scale;
      return [(a + b) / 2, (b - a) / 2];
    };

    // Drag: the map follows the pointer, so a drag of (dx, dy) pixels moves the centre the opposite way on the ground.
    cam.panScreen = function (dx, dy) {
      const a = dx / (cam.scale * C30), b = 2 * dy / cam.scale;
      cam.cx -= (a + b) / 2; cam.cy -= (b - a) / 2; clampCentre(); return cam;
    };

    // Keys: move the VIEW by (dx, dy) pixels. Moving the view left makes the map slide right, the same as dragging right.
    cam.panView = function (dx, dy) { return cam.panScreen(-dx, -dy); };

    // Zoom by a factor, keeping the ground point under pixel (px, py) where it is. Defaults to the middle of the canvas.
    cam.zoomAt = function (factor, px, py) {
      if (px === undefined) px = cam.w / 2;
      if (py === undefined) py = cam.h / 2;
      const [wx, wy] = cam.screenToWorld(px, py), k2 = clamp(cam.scale * factor, cam.minScale, cam.maxScale);
      const ox2 = px - (wx - wy) * k2 * C30, oy2 = py - (wx + wy) * k2 * 0.5;
      const A = (cam.w / 2 - ox2) / (k2 * C30), B = (cam.h / 2 - oy2) * 2 / k2;
      cam.scale = k2; cam.cx = (A + B) / 2; cam.cy = (B - A) / 2; clampCentre(); return cam;
    };
    cam.zoomTo = function (scale, px, py) { return cam.zoomAt(scale / cam.scale, px, py); };

    // The zoom as a fraction 0..1 on a logarithmic scale between the smallest and largest scale, for a slider.
    cam.zoomFraction = function () { return Math.log(cam.scale / cam.minScale) / Math.log(cam.maxScale / cam.minScale); };
    cam.setZoomFraction = function (t) { return cam.zoomTo(cam.minScale * Math.pow(cam.maxScale / cam.minScale, clamp(t, 0, 1))); };

    cam.fitAll = function () { const B = cam.bounds; cam.cx = (B[0] + B[2]) / 2; cam.cy = (B[1] + B[3]) / 2; cam.scale = cam.fit; return cam; };
    cam.setBounds = function (bounds) { cam.bounds = bounds.slice(); computeFit(); return cam.fitAll(); };
    // The canvas changed size: keep the same ground point at the middle, and keep the scale unless it now falls outside the limits.
    cam.resize = function (w, h) { cam.w = w; cam.h = h; computeFit(); cam.scale = clamp(cam.scale, cam.minScale, cam.maxScale); clampCentre(); return cam; };

    computeFit(); cam.fitAll();
    return cam;
  }

  root.LabCamera = { create, C30 };
})(typeof window !== 'undefined' ? window : globalThis);
