# Bench

Checks that run against a **built** page, not against the source.

```bash
npm install    # once; playwright

# one self-contained file
node check-single-file.mjs ../../worlds/<world>/visual/index.html

# frame-rate gate (real GPU via ANGLE/GL)
node fps.mjs ../../worlds/<world>/visual/index.html --runs 3000 --dpr 1

# Gate-4 snapshots (the page implements ?snapshot=1)
node screenshots.mjs --world ../../worlds/<world>

# beauty-review captures: overview / neighbourhood / street / lens / clip
node screenshots.mjs --world ../../worlds/<world> --beauty --round 1

# measure a round against the exemplar and build board.png + extras.png
python review.py pack ../../worlds/<world>/visual/review/round-1 --exemplar ../../reference/exemplars/real-nw-ashford

# lower-level helpers (pack calls the same measurements)
python review.py squint <png>
python review.py sheet <out.png> <a.png> <b.png> --labels a,b
python review.py diff <clip-0.png> <clip-5.png>
```

`browser.mjs` picks `CHROMIUM_PATH`, Brave, Chromium or Chrome, then falls back
to playwright's bundled browser. FPS is measured at 1440×900; p50 ≤ 16.7 ms and
p95 ≤ 33 ms pass. A software renderer is reported honestly, never accepted.

`screenshots.mjs` writes `top-down.png`, `iso-0.png`, `iso-90.png` to the
world's `map-data/verify/`.
