# Regenerating the NetLogo fixtures

`test/fixtures/netlogo-7.0.4.json` was recorded from desktop NetLogo 7.0.4 by
`scripts/netlogo-fixtures.mjs` via `test/scenarios.mjs`. It lets the library's
primitives be tested against NetLogo **without NetLogo installed** — the
fixture carries the recorded outputs.

## When you need to regenerate

- NetLogo itself is upgraded (a new `.nlogox` feature changes semantics).
- The library's NetLogo semantics change on purpose and you have checked the
  change against NetLogo by hand.

Do **not** regenerate to make a failing test pass. A mismatch is information.

## How

```bash
NETLOGO_HOME="tools/NetLogo" \
  node scripts/netlogo-fixtures.mjs   # rewrites test/fixtures/netlogo-7.0.4.json
git diff test/fixtures/netlogo-7.0.4.json   # review every changed number
```

Then `npm test` and `npm run typecheck` must both pass, and the change must be
explained in the commit message (which NetLogo version, which scenario, why
the number moved).
