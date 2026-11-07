#!/bin/sh
# Runs every pack-runtime repro in order and prints its output. Exit status is 0: the repros exhibit behaviour, they do not assert.
# Usage (from the repo root): PAPERDOLLS_NODE_MODULES=<node_modules with jsdom> sh docs/state-machines/repro/run-all.sh
cd "$(dirname "$0")" || exit 1
for f in r[0-9][0-9]-*.js; do echo "=== $f"; timeout 60 node "$f" 2>&1; done
