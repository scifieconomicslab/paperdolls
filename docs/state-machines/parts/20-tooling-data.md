# Part 20: tooling and data pipeline

Scope: `paperdolls/ingest/` (fetch, readers, build, classify, adjacency, elevation, report), `place.py`, `cli.py` (ingest, osm-fetch, place, pack, export,
intake), `pack.py`, `packcheck.py`, `packdev.py`, `viewer_build.py`, `export.py`, `replay_build.py`, `spec.py`, `intake.py`, the `bindScene` flow
(`viz/packruntime.js`) and the three validators (`pack.py`, `viz/packvalidate.js`, `schemas/pack.schema.json`).
Base of the analysis: `main` at 6b74ff7 (re-run on aa2d936 before the fixes). **Status: every confirmed finding below is FIXED** on branch `claude/fix-tooling-4b12df`
by six commits, one per GitHub issue: #8 `d8401e2`, #9 `6ebc83e`, #10 `0180458`, #11 `4c48c0c`, #12 `db9bb18`, #13 `b5a3f6d`. The regression tests are in
`tests/test_tooling_robustness.py` (each is the port of a repro; they fail on aa2d936 and pass now). The repros were kept as they are, apart from the
changes noted in "Changes to the repros" below; their committed output now shows the held behaviour.

How to reproduce (from the repository root, no network: the only server is a local fake bound to 127.0.0.1):

```bash
PAPERDOLLS_NODE_MODULES=/data/ScifiEconomicsLab/scifirender/paperdolls/node_modules /data/ScifiEconomicsLab/TheGreatRetrofit/.venv/bin/python docs/state-machines/repro/tooling_repro.py      # T01..T30, or name some: ... T05 T23
PAPERDOLLS_NODE_MODULES=/data/ScifiEconomicsLab/scifirender/paperdolls/node_modules node docs/state-machines/repro/bindscene_repro.js                                                          # B01..B08
/data/ScifiEconomicsLab/TheGreatRetrofit/.venv/bin/python docs/state-machines/repro/validator_diff.py 3000 1                                                                                   # differential fuzz
```

Observed output of the last full run is committed next to the scripts: `tooling_repro.out.txt`, `bindscene_repro.out.txt`, `validator_diff.out.txt`.
A repro prints `REPRODUCED` when the invalid state or transition happened and `REFUTED` when the code held. For the `B` cases the label only says the
described behaviour was observed; whether it is a defect is judged in the text. **After the fixes all of T01 to T30 print `REFUTED` (the code holds)**; the
docstrings and the "Reachable invalid states" text below describe the behaviour on aa2d936 and are kept as the record of what was wrong.

## Confirmed bugs, ranked by impact

Impact is for the Great Retrofit use (a policymaker map of Jette built from an OSM extract); likelihood is for someone running the documented workflow.
Grouped by cause, which is how the issues should be filed.

| # | Bug | Repro | Impact | Likelihood | Group |
|---|-----|-------|--------|------------|-------|
| 1 | **FIXED (d8401e2, #8)** `place` reuses `out/extract.json` for any later spec: enlarge `place.bbox` and the old, smaller extract is ingested; scene covers the old area, no warning, no refetch | T05 | High: a silently wrong map | Medium (anyone who changes the area through the intake after a first run) | A: cache keyed by nothing |
| 2 | **FIXED (d8401e2, #9)** `fetch_overpass` lets `http.client.IncompleteRead` escape (a dropped connection during the 14 MB / 56 s download). `osm-fetch` and `place` end in a traceback, not `fetch failed` with the hint; same for valid JSON that is not an object | T01, T02, T03 | Medium: nothing is corrupted, the user is shown a stack trace on the one step that needs a retry | Medium to high on a flaky link | B: exceptions escape the CLI boundary |
| 3 | **FIXED (d8401e2, #8)** A truncated or wrong `extract.json` is used on every run; the message (`the ingest failed: Expecting ',' delimiter`) never mentions `--refetch` or deleting the file | T06 | Medium: a stuck pipeline | Low to medium | A |
| 4 | **FIXED (4c48c0c, #11)** Intake loses an answer when two `intake answer` commands overlap (read, modify, rewrite the whole file, no lock, no merge); both print `OK` | T23 | Medium: silent loss of a user decision (the confirmation gate catches only part of it) | Medium if the driving model issues parallel tool calls | F: intake state |
| 5 | **FIXED (0180458, #10)** A half-written `render.yaml` is a `YAMLError` traceback in every intake command; a file truncated to empty makes `intake next` start the interview from question one with `answered: 0` and no warning | T24 | Medium | Low | A (non-atomic writes) |
| 6 | **FIXED (db9bb18, #12)** `ingest` writes a scene with zero buildings and no warning when every building is degenerate (and `Infinity`/`NaN` end up in `scene.json` for an infinite coordinate, which is not JSON) | T09, T10 | Medium: a pack with `from: scene` then has nothing to bind | Low | C: ingest output not validated |
| 7 | **FIXED (b5a3f6d, #13)** Placeholder substitution runs over the whole page: a manifest string or runtime source containing `/*__SCENE__*/` (or any `/*__LIB__*/`) gets the scene or a library spliced in; the `MANIFEST` literal no longer parses and the page is blank | T15 | Medium (blank page, no error) | Very low | E |
| 8 | **FIXED (0180458, #10)** `Path.write_text` straight onto the output for `pack build --out`, `ingest` (3 files), `place` (3 files), `export` and `intake`: a reader sees a prefix; a failure on file 2 or 3 leaves a new scene beside an old or missing report | T14, T18 | Low to medium | Low | A |
| 9 | **FIXED (0180458, #10)** `export --out traj` (no `.npz`): numpy writes `traj.npz`, the command prints `wrote traj`, and the next command fails with `FileNotFoundError` | T22 | Low | Medium | A |
| 10 | **FIXED (6ebc83e, #9)** `pack.validate()` raises `TypeError` (str.join over a non-string) for manifests the JS validator reports as ordinary errors; `pack check`/`pack build` end in a traceback | T28 | Low | Low | G: validators |
| 11 | **FIXED (b5a3f6d, #13)** `pack.build()` reads the manifest three times and validates only the first read; an edit in between is built without validation | T16 | Low | Low | D: repeated reads |
| 12 | **FIXED (b5a3f6d, #13)** `runtime.entry` is not confined to the pack folder when `runtime.files` is absent (absolute path or `..` accepted by `check`, inlined by `build`); `runtime.files` is confined | T17 | Low (a pack is trusted code) | Low | D |
| 13 | **FIXED (6ebc83e, #9)** More uncaught exception types at the CLI: malformed element (`KeyError`), spec `n: abc` (`ValueError`), hand-written `place` block (`ValueError`/`IndexError`/`KeyError`), `pack dev` on invalid YAML (`PackError`) | T07, T08, T19, T27 | Low | Low | B |
| 14 | **FIXED (db9bb18, #12)** `ingest` data hygiene: duplicate scene ids pass through; self-crossing footprints are kept; `--max-buildings -1` miscounts; `--bbox` is silently dropped from the query when a relation is also given | T11, T12, T13, T29 | Low | Low | C |
| 15 | **FIXED (b5a3f6d, #13)** `--include FILE` for a file inside the pack folder that a runtime `require`s: `check`, `build`, `packcheck` and `pack dev` all call `check(path)` without `include`, so the documented flag is refused with `not inlined into the page` | T30 | Low to medium: blocks the documented shared-helper route | Medium for packs using `--include` | D |
| 16 | **FIXED (4c48c0c, #11)** Intake keeps stale bookkeeping across a goal change (`overrides_answered`, `override_keys`, `defaults`), so the overrides question is not asked again and the table can show `you said` for values that were reset | T25 | Low | Low | F |

Machines found sound before and after (no invalid state reached): the dev server lifecycle (T20, T21), the Overpass error paths for HTML error pages and 429 (T04), the intake
confirmation gate (T26), `bindScene` reporting of unknown ids (B01, B02, B07).

---

## M1. Overpass fetch (`ingest/fetch.py`, driven by `cli.cmd_osm_fetch` and `place.run`)

Identity: `fetch_overpass` [fetch.py:20](paperdolls/ingest/fetch.py:20); implicit machine, one request per call, no retry, no resume. Query text from `overpass_query` [query.py:54](paperdolls/ingest/query.py:54).

States and the variables that encode them:

| State | Encoded by |
|-------|-----------|
| idle | no request; `out_path` may or may not exist |
| requested | blocked in `urlopen` (timeout 360 s is per socket operation, not total) |
| body read | `raw` bytes in memory |
| rejected | `FetchError`; `out_path` untouched; for non-JSON, `<out>.raw` written ([fetch.py:37](paperdolls/ingest/fetch.py:37)) |
| saved | `out_path` holds `raw` (written in one `write_bytes`, [fetch.py:45](paperdolls/ingest/fetch.py:45)) |

Files on disk are state: `extract.json` (the cache, see M2), `extract.json.raw` (the rejected body, never read again, never deleted).

Invariants and the lines that keep them:

- `out_path` only ever holds JSON with a non-empty `elements` list and no `error` in `remark`: [fetch.py:35-45](paperdolls/ingest/fetch.py:35). Holds for every answer tested (T04).
- Every failure surfaces as `FetchError` so the CLI can say what to do: [fetch.py:27-32](paperdolls/ingest/fetch.py:27). Does not hold (T01, T03).
- An existing good extract survives a failed fetch: the write is the last statement. Holds (T04).

| From | Event | Guard | To | Side effects | Line |
|------|-------|-------|----|--------------|------|
| idle | `fetch_overpass` | none | requested | POST, User-Agent | 22-25 |
| requested | HTTP error | status 429, 504, 400 give hints | rejected | none | 27-30 |
| requested | URL/OS/timeout error | | rejected | none | 31-32 |
| requested | body cut short | | **escapes as `IncompleteRead`** | none | 26 (T01) |
| body read | not JSON | | rejected | writes `.raw` | 34-38 |
| body read | JSON but not an object | | **escapes as `AttributeError`** | none | 39 (T03) |
| body read | `remark` has "error", or no elements | | rejected | none | 39-44 |
| body read | otherwise | | saved | overwrites `out_path` in place | 45 |

Retries and rate limits: there is no retry, no back-off and no `Retry-After` handling by design (the CLI help says "one request, no retries"). A 429 gives
the hint text only (T04). Stale cache reuse and error-page poisoning: an HTML or 429 answer does not create or change `extract.json` (T04, REFUTED).
Overpass can also answer 200 with partial elements and a `remark` that does not contain the word "error" (for example an out-of-memory remark worded
differently); that would be saved as a complete extract. SUSPECTED: only the substring "error" is checked, and a repro needs a recorded real answer, which the
no-network rule forbids.

Reachable invalid states:

- **T01 FIXED (d8401e2)**, **T02 FIXED (d8401e2)**: a connection dropped mid-body raises `http.client.IncompleteRead` (an `HTTPException`, not an `OSError`). Observed:
  `IncompleteRead escaped (not FetchError): IncompleteRead(28 bytes read, 99972 more expected); out file exists=False`; through the command,
  `exit=1; ... http.client.IncompleteRead`. `place.run` catches only `FetchError` ([place.py:63-67](paperdolls/place.py:63)), so `paperdolls place` fails the same way
  and the query-saved hint, which exists for exactly this case, is never printed. Impact medium, likelihood medium to high (the real fetch is 14 MB over about a minute).
- **T03 FIXED (d8401e2)**: `200` with `[]`: `AttributeError: 'list' object has no attribute 'get'`. Same handling gap.
- **SUSPECTED** slow trickle: `timeout` bounds each socket read, not the whole download, so a server that sends a byte every 300 s never times out. Not reproduced (it takes minutes).
- **SUSPECTED** killed during `write_bytes`: a prefix of `extract.json` stays and M2 then reuses it (see T06 for the consequence, which is confirmed with a hand-made prefix).
- **T29 FIXED (d8401e2)**: `overpass_query(relation=R, bbox=B)` says "either, or both" and `osm-fetch` accepts both, but the query uses only `(area.a)`; the bbox is not in it. Observed: `bbox values in query=False; filter used=True`.

## M2. Place pipeline and the extract cache (`place.py`)

Identity: `place.run` [place.py:33](paperdolls/place.py:33); implicit; the state is the contents of `<output.dir>/` next to `render.yaml`: `query.ql`, `extract.json`,
`scene.json`, `scene_report.md`, `scene_report.json`.

States (derived from which files exist and whether they are consistent with the spec):

| State | Files | Variables |
|-------|-------|-----------|
| empty | none | |
| query saved | `query.ql` only (no network, or fetch failed) | |
| extracted | `extract.json` | consistent with the spec only if it was fetched for the same relation/bbox: **nothing records that** |
| scened | `scene.json` + both reports | scene built from `extract.json` with the spec of the last run |
| partly written | `scene.json` without one or both reports | after a failure between [place.py:74](paperdolls/place.py:74) and 76 |

Invariants that should hold, and what maintains them:

- `extract.json` is for the area the spec names now. **Nothing maintains it**: the only guard is `refetch or not extract.exists()` ([place.py:57](paperdolls/place.py:57)).
- `scene.json`, `scene_report.md`, `scene_report.json` describe the same ingest. Maintained by writing them one after another, no temp file or rename ([place.py:74-76](paperdolls/place.py:74)).
- A scene file used as given (`scene_file`) has the four lists: [place.py:48](paperdolls/place.py:48).

| From | Event | Guard | To | Side effects |
|------|-------|-------|----|--------------|
| any | `place` | `kind` bbox/relation, no `extract.json` | extracted | writes `query.ql`, fetches (M1) |
| any | `place` | `extract.json` exists, no `--refetch` | (unchanged) | **no fetch, whatever the spec says** |
| extracted | ingest ok | | scened | writes scene, then md, then json |
| extracted | ingest error | | extracted | `PlaceError("the ingest failed: ...")` and nothing about refetching |
| any | `place --no-fetch` | no extract | query saved | `PlaceError` |
| any | `place` | `kind` = `extract_file` | | reads the user's file, no copy kept |

Reachable invalid states:

- **T05 FIXED (d8401e2)** (rank 1): spec `bbox` [50.00, 4.00, 50.01, 4.01], extract cached for it; the user enlarges to [49.90, 3.90, 50.10, 4.10] through the intake; `place` makes
  `fetch calls=0; buildings=2 for the NEW (larger) bbox; warnings=[]`. The scene is silently the old area. A changed `relation` fails loudly instead
  (`boundary relation ... is not in the file`), so only the bbox form is silent. Also `max_buildings` and `name` are applied fresh, so the scene mixes new options with old data.
- **T06 FIXED (d8401e2)**: a prefix of a JSON file as `extract.json` fails the same way on every run: `same failure twice=True; message="the ingest failed: Expecting ',' delimiter: line 1 column 65 (char 64)"`. The user must guess to pass `--refetch`.
- **T14/T18 pattern**: scene and reports are three separate writes; a failure on the second leaves a new `scene.json` beside an old report (see M3 for the repro on the `ingest` command, `place` has the same code shape).
- **T07 FIXED (6ebc83e)**: `spec.validate` for `place_scene` checks only `place.kind` and `look.region` ([spec.py:70-73](paperdolls/spec.py:70)), but `place.run` indexes `place["scene_path"]`, `place["extract_path"]`, `place["bbox"]` and `relation`. Observed: `osm_relation: ValueError: give a relation id...; bbox: IndexError: Replacement index 3 out of range...; extract_file: KeyError: 'extract_path'`. The intake would never leave these empty; a hand-written file does.
- REFUTED: a changed `output.dir` starts a clean cache (new folder), so only same-folder reuse is affected.

## M3. Ingest run (`ingest/build.py`, readers, classify, adjacency, elevation, report; `cli.cmd_ingest`)

Identity: `build.ingest` [build.py:80](paperdolls/ingest/build.py:80), a pure function of (file, options) except for the clock in `area.generated`; implicit pipeline:
read, clip, choose rotation, roads and trams, buildings, neighbours, landuse, trees, scene, elevation, report. `cmd_ingest` [cli.py:323](paperdolls/cli.py:323) writes three files.

States and variables: `feats, notes` after reading; `bld, roads, lands, tpts` after clipping; `lat0, lon0, rot` (frame); `road_out, bld_out, land_out, trees`; `scene`, `report`.
Files on disk: `scene.json`, `<stem>_report.md`, `<stem>_report.json` (written in that order, [cli.py:335-338](paperdolls/cli.py:335)).

Invariants and what is meant to maintain them:

1. Building ids are unique in the scene. Not enforced anywhere (ids come straight from the input: `w<id>`, `r<id>#k`, GeoJSON `id`).
2. Each footprint is a simple polygon of at least 3 points with area at least 8 m2: [build.py:249](paperdolls/ingest/build.py:249) enforces the count and area, not simplicity.
3. All coordinates are finite. Not enforced; the origin is a plain min/max ([build.py:150](paperdolls/ingest/build.py:150)).
4. The scene has buildings if the extract had buildings. The only emptiness check is before projection and simplification ([build.py:145](paperdolls/ingest/build.py:145)).
5. `neighbours` only name ids present in `buildings`: holds, built from `bld_out` after filtering ([build.py:272-274](paperdolls/ingest/build.py:272)); with duplicate ids a link is ambiguous.
6. `levels` is 1..60: [classify.py `building_levels`](paperdolls/ingest/classify.py:43) clamps (levels 0, negative or 9999 become the default 2, or 60). REFUTED as a defect; probe: `building:levels` 0, -3 give 2, 9999 gives 60, `height=1e9` is ignored above 400 m.

| From | Event | Guard | To | Side effects | Line |
|------|-------|-------|----|--------------|------|
| (start) | read file | format detected by first character | features | none | readers.py:197 |
| features | boundary relation named | relation found | clip ring set | | build.py:91-98 |
| features | boundary relation named | not found / open ring | `IngestError` | | 93-96 |
| features | clip, no buildings and no roads | | `IngestError` | | 145 |
| clipped | `--max-buildings N` | N truthy and fewer than the count | truncated to the nearest N | counts skipped | 153-156 |
| clipped | project buildings | ring < 3 points or < 8 m2 | dropped, counted in `skipped` | | 249-251 |
| built | elevation file | `ElevationError` | `IngestError` | | 358-359 |
| scene | CLI | | three writes | non-atomic | cli.py:335-338 |

Reachable invalid states (all deterministic, [tooling_repro.py](docs/state-machines/repro/tooling_repro.py)):

- **T08 FIXED (6ebc83e)**: an element without `type`, or a node without `lat`, raises `KeyError` in `read_overpass_json` ([readers.py:101-117](paperdolls/ingest/readers.py:101)); `cmd_ingest` and `place` catch `IngestError` and `ValueError` only. Observed: `no type: exit=1 KeyError: 'type'; node without lat: exit=1 KeyError: 'lat'`. A truncated file is a `ValueError` (JSON decode) and is handled.
- **T09 FIXED (db9bb18)**: a line and a zero-area bowtie as the only buildings, plus a road: `buildings=0; warnings=[]; skipped={'building smaller than 8 m2': 1}` (the 3-point 'line' is not a closed way, so the reader makes it a line feature, not a building, and it is not counted at all). Roads-only extracts are legal and equally silent. Consequence downstream: the toy `bindScene` throws and the pack page reports it (B04).
- **T10 FIXED (db9bb18)**: one building with `lon = Infinity` (Python `json` accepts it; Overpass does not emit it) gives `origin={'lat': 50.05, 'lon': inf}`, `frame rotated nan degrees`, an empty scene, exit 0, and `Infinity` inside `scene.json`, which a strict JSON parser rejects. `pack.load_scene` (Python `json`) accepts it and the page literal embeds it as the JS `Infinity`. NaN lat is dropped silently by `simplify_ring` (NaN comparisons are false), so only the infinite case propagates. Likelihood very low.
- **T11 FIXED (db9bb18)**: `ids=['w1', 'w1']; warnings=[]`. Source: two extracts concatenated, or a hand-edited scene. `bindScene` then handles it with a warning (B01).
- **T12 FIXED (db9bb18)**: `--max-buildings -1` with 3 buildings keeps 2 and reports 4 skipped (`len - N`); `--max-buildings 0` is treated as "no limit". Argparse allows both.
- **T13 FIXED (db9bb18)**: a self-crossing footprint with unequal lobes passes the area test (the shoelace sum is the difference of the lobes): `footprint=[[-8.16, 65.59], [11.26, 6.93], [30.5, 47.03], [-17.78, 45.54]]; self-crossings=1`. The renderer extrudes it as is.
- **T14 FIXED (0180458)**: with `scene_report.md` unwritable, `scene.json` is already replaced and `scene_report.json` is missing: `exit=1; scene.json written=True; scene_report.json written=False; IsADirectoryError`. A rerun after a fix repairs it, so the exposure is the window and an older report beside a new scene.
- REFUTED: zero buildings *and* zero roads is rejected (`nothing to draw`); `--rotation` garbage is a `ValueError` caught by `cmd_ingest`; a bbox with south above north yields `nothing to draw`, loudly.
- REFUTED: `neighbours` referencing a missing id cannot come out of `ingest`; it can come from a hand-edited scene and the toy `bindScene` drops unknown ids but keeps self links and repeats (B05).

Retries and idempotency: ingest is deterministic for the same input and `--seed` (scatter uses `random.Random(f"{seed}:{id}")`), except `area.generated`. Re-running after a failed run is safe; it overwrites all three files.
Concurrency: two `ingest` processes with the same `--out` interleave per file; the pair (scene, report) can end up from different runs. SUSPECTED, not reproduced (needs two real processes racing on one file).

## M4. Pack check and build (`pack.py`, `viewer_build.py`, `cli.cmd_pack`)

Identity: `check` [pack.py:604](paperdolls/pack.py:604), `build` [pack.py:767](paperdolls/pack.py:767), `cmd_pack` build branch [cli.py:305-317](paperdolls/cli.py:305); implicit. No state is kept between runs; the state is the set of files read.

Files read by one build, and how often: `pack.yaml` (in `check`: `load`; in `build`: `load`; in `runtime_files`: `load`, and again by `undeclared_scripts` inside `check`): 3 to 4 reads per build; each runtime file once in `check`'s
existence test and once in `runtime_source`; `--scene` once ([cli.py:306](paperdolls/cli.py:306)); `viz/*.js` and `assets/palettes.json` through `viewer_build._fill`.

Invariants: (1) what is built is what was validated; (2) the page parses (manifest and scene literals are JSON in a script); (3) the runtime inlined is exactly `runtime_files`; (4) the page is within `max_bytes` or the build fails; (5) the output file is complete or absent.

| From | Event | Guard | To | Side effects | Line |
|------|-------|-------|----|--------------|------|
| (start) | `pack build` | scene loads | scene held | none | cli.py:306 |
| scene held | `check` errors | any | `PackError` | exit | pack.py:772-774 |
| validated | read manifest again, read runtime files | file contains `</script` or `<!--` | `PackError` | | pack.py:704-706 |
| built | size over budget | trim stages one by one; still over | `PackError` | | pack.py:793-802 |
| built | write `--out` | | done | `write_text` onto the target | cli.py:310 |

Reachable invalid states:

- **T15 FIXED (b5a3f6d)**: `viewer_build._fill` ([viewer_build.py:23-30](paperdolls/viewer_build.py:23)) replaces `/*__KEY__*/` markers over the whole template in a fixed order, after `build` has already put the runtime source into the template ([pack.py:781](paperdolls/pack.py:781)) and with the manifest JSON inserted before the scene. A manifest string with `/*__SCENE__*/` receives the scene: `MANIFEST literal no longer parses (Expecting ',' delimiter: line 1 column 5530); the scene id w1 appears inside it: True`. A runtime that mentions `/*__VIZLIB__*/`, `/*__PALETTES__*/` etc. in a comment gets the library pasted in. The page is blank; `pack check` passes. Scene strings cannot do this because the scene is substituted last.
- **T16 FIXED (b5a3f6d)** (interleaving injected right after `check()` returns, which is an editor save during a build): `build returned a page (485099 bytes) embedding id 'BAD ID'; check() on the same folder now says ['id: required: ...']`. The dev server is not affected in the long run (its signature is taken first, so the next poll rebuilds), `pack build` is.
- **T17 FIXED (b5a3f6d)**: `runtime.entry` set to an absolute path outside the pack and no `runtime.files`: `check errors=[]; outside file inlined=True`. With `runtime.files` the same path is rejected ([pack.py:126](paperdolls/pack.py:126)).
- **T18 FIXED (0180458)**: non-atomic output. A concurrent reader of a 20 MB `write_text` saw sizes `[0, 2097152, 4194304, ...]`. A browser opened on `pack.html`, or a second `pack build` to the same `--out`, can read a prefix. Two writers at once (SUSPECTED, not reproduced: the outcome is up to the kernel) end as one complete file or a mix.
- REFUTED: size budget. `build` re-renders after each trim stage and fails when still over; stages never remove `id`, `footprint`, `levels`, `archetype`, `state`, `investor`, `area`, `residential`, `levels_assumed` ([pack.py:715-723](paperdolls/pack.py:715)).
- REFUTED: `runtime.files` containing `..`, absolute or Windows paths is rejected; a file listed twice is rejected; a listed file missing on disk is an error in `check`.
- NaN or infinite coordinates in a scene: `json.dumps` writes `NaN`/`Infinity`, which are legal JS literals in the page, so the page parses and the building is drawn at NaN (not drawn). Not an invalid page state; the cause is M3 (T10).

## M5. Pack dev server (`packdev.py`)

Identity: `DevState` [packdev.py:66](paperdolls/packdev.py:66) (page state), `DevServer` [packdev.py:208](paperdolls/packdev.py:208) (watcher thread plus one HTTP thread per request), the `CLIENT` script [packdev.py:22](paperdolls/packdev.py:22); explicit class, implicit state names.

States and the variables that encode them:

| State | Variables |
|-------|-----------|
| ok | `ok=True`, `html` = injected page, `errors=[]` |
| error | `ok=False`, `html` = error page, `errors` non-empty |
| building | `_lock` held by `refresh` (a GET blocks behind it) |
| stopping | `server.stopping` set; SSE loops exit within 15 s or at notify |

Each state has a `version` (monotone counter, bumped on every rebuild, including a `touch`) and `_sig` (path, mtime_ns, size for every watched file). The browser holds the version embedded in its page.

Invariants and the lines that maintain them:

1. The version embedded in a page is the version of that page: `_client` uses `self.version + 1` while building inside the same `cond` block that increments it ([packdev.py:123-132](paperdolls/packdev.py:123)). Holds (T20: `events per tab=[5, 5]`, versions strictly increasing).
2. A change during a build is not lost: `_sig` is taken before the files are read ([packdev.py:102](paperdolls/packdev.py:102)); a later change makes the next poll differ. Holds (T20 half-written scene).
3. A bad edit never stops the server: `except Exception` ([packdev.py:121](paperdolls/packdev.py:121)). Holds for build errors (T20).
4. Only loopback hosts are served: [packdev.py:156-159](paperdolls/packdev.py:156).
5. The scene is parsed once per scene change: `_scene_sig` ([packdev.py:109-113](paperdolls/packdev.py:109)).

| From | Event | Guard | To | Side effects | Line |
|------|-------|-------|----|--------------|------|
| (start) | `DevState()` | | ok or error | `refresh(force)` builds | 80 |
| ok / error | watcher tick (0.25 s), `GET /`, `GET /__status` | signature changed | building, then ok or error | `version += 1`, `notify_all` | 96-128, 222-229 |
| ok / error | same | unchanged | unchanged | none | 103 |
| any | `GET /__events` | | stream | first event at once; keep-alive every 15 s | 185-205 |
| stream | write fails | `BrokenPipe`, `ConnectionReset`, `OSError` | closed | none | 204 |
| any | `stop()` | | stopping | `notify_all`, `shutdown`, `server_close` | 237-242 |
| any | `serve()` ^C | | stopping | same | 255-261 |
| (start) | port in use | `OSError` in `DevServer()` | exit | `SystemExit("cannot start the server on port ...")` | cli.py:301-303 |

Client side: `CLIENT` reloads when the event or polled version differs from the embedded one, saving params and time to `sessionStorage` first and restoring after load ([packdev.py:25-34](paperdolls/packdev.py:25)).

Reachable invalid states and sound transitions:

- **T20 REFUTED** (invalid state not found; still holds after the fixes): start ok (v=1); break the manifest, `ok=False v=2`; fix by writing a temp file and `os.replace` (an editor's save), `ok=True v=3`; a half-written scene gives `ok=False`, completing it `ok=True v=5`; two tabs each got 5 events; one tab closed without a goodbye and the next change still built (`v=6`); `port in use -> SystemExit('cannot start the server on port ...')`; `stop took 0.02s`.
- **T21** (information): 20 saves over 2.9 s caused 6 rebuilds because the watcher coalesces inside its 0.25 s tick; every rebuild reloads every tab. Each rebuild of a 16 MB scene page is serialized under `_lock`, and a `GET /` during it waits. Not a defect.
- **T19 FIXED (6ebc83e)**: `pack dev` on an unparseable `pack.yaml` ends with `PackError` and a traceback. `DevState` survives (error page), but `serve()` calls `packmod.watched_files` for its banner line ([packdev.py:249](paperdolls/packdev.py:249)), which raises; `cmd_pack` catches `OSError` only. The server never starts, so the "fix the file and save, this page reloads" promise of the error page does not apply to the one case it is most useful for (a first typo).
- REFUTED: rename-over saves (temp file then replace) and a deleted-then-recreated runtime file: `stat` failures are recorded as `None` and the next poll rebuilds; the existing test `test_dev_server_survives_a_deleted_runtime_file_and_a_scene_change` covers deletion.
- REFUTED: handler reads `st.html` after `st.refresh()` without the condition lock; a rebuild between them serves the newer page, which embeds its own newer version, so the client is consistent.
- SUSPECTED, no repro: with a manifest that does not parse, `_signature` watches the manifest and scene only ([packdev.py:86-87](paperdolls/packdev.py:86)); a runtime file edited in that window is picked up at the next manifest save. Harmless because the fix is a manifest save.
- **T30 FIXED (b5a3f6d)**: `--include` files are watched, but `check` is called without `include` ([packdev.py:114](paperdolls/packdev.py:114), also [pack.py:772](paperdolls/pack.py:772) and [packcheck.py:302](paperdolls/packcheck.py:302)), so a runtime that `require`s an included file living in the pack folder is refused: `undeclared_scripts(include)=[]; build refused: the pack does not validate: runtime.js refers to ./prng.js, a file of the pack that is not inlined into the page`. `test_an_include_file_counts_as_declared` covers `undeclared_scripts` with include, not these call sites. An include outside the pack folder is not scanned, so it works.
- Two `pack dev` processes on one pack: independent, each with its own port; there is no shared output. Two on one port: the second fails with the message above (T20). Not a shared-state hazard.

## M6. Pack check (`packcheck.py`, `cli.cmd_pack` check branch)

Identity: `packcheck.run` [packcheck.py:300](paperdolls/packcheck.py:300); explicit `Result`; steps: manifest (`pack.check` plus `static_checks`), runtime under node, scene bind, parity.
Exit code: 0 ok, 1 errors, 2 could not run.

Invariant: the runtime run in node is the runtime the manifest names. The sources are read separately ([packcheck.py:325](paperdolls/packcheck.py:325)) from the validation, so the same repeated-read caveat as M4 applies (T16 pattern). Every error path before the run is a returned `Result`, not an exception, **except** `pack.validate` itself (T28).

- **T28 FIXED (6ebc83e)**: `pack.validate` raises `TypeError` instead of reporting, for two classes of invalid manifest: (a) `entities.*.fields.*.values` holds a non-string and a categorical `scale.values` key is not among them ([pack.py:419](paperdolls/pack.py:419) `', '.join(legal)`); (b) a param `group` that is truthy and not a string, and a layout `groups` entry naming a missing group ([pack.py:558](paperdolls/pack.py:558)). Observed: `a: TypeError: sequence item 1: expected str instance, float found; b: TypeError: sequence item 0: expected str instance, int found; cli pack check: exit=1 TypeError: sequence item 4: expected str instance, float found`. `pack dev` turns it into an error page that says `TypeError: ...`; the JS validator reports the real problem (`each value is a string...`).

## M7. Intake interview (`intake.py`, `cli.cmd_intake`)

Identity: `Intake` [intake.py:77](paperdolls/intake.py:77); explicit state machine. The state is the file `render.yaml` itself: answers at dotted paths, plus an `intake:` block (`version`, `defaults`, `override_keys`, `overrides_answered`, `shown`, `confirmed`). The question bank is `assets/intake_questions.yaml` (`when`, `always_ask`, `default`, `default_from`).

Per question, derived state ([intake.py:434-449](paperdolls/intake.py:434)): `missing`, `default`, `answered`, `invalid` (stored value no longer passes `parse`); a question that does not apply (its `when` is false) is absent. The interview state is `ask`, `fix`, `confirm`, `complete` ([intake.py:394-416](paperdolls/intake.py:394)).

Invariants and the lines that keep them:

1. Every stored answer passes `parse`: checked on write ([intake.py:268](paperdolls/intake.py:268)) and again on read (`check_existing`, `fix` status).
2. A confirmation refers to exactly the answers shown: `shown` is the hash of everything but `intake`; `confirmed` is true only while `shown == hash` ([intake.py:332-356](paperdolls/intake.py:332)); any `answer` calls `withdraw_confirmation` ([intake.py:271](paperdolls/intake.py:271)).
3. A goal change removes the other branch's answers ([intake.py:303-307](paperdolls/intake.py:303)).
4. `confirmed yes` is only accepted after `show` of the current table ([intake.py:342](paperdolls/intake.py:342)).
5. The file is always valid YAML holding the answers so far. **Not maintained** (T24).
6. One writer at a time. **Not maintained** (T23).

| From | Event | Guard | To | Side effects | Line |
|------|-------|-------|----|--------------|------|
| (none) | `init` | file absent or `--force` | `{intake: {version: 1}}` | `--force` also discards answers and confirmation | 90-95 |
| any | `answer id value` | id known, question applicable, value parses | same or next question | writes the answer, applies `after` side effects, withdraws confirmation, rewrites the file | 259-273 |
| any | `answer id value` | out of order but parseable (for example `model.params.n` before `model.source`) | | `model.source` later keeps `n`, `run_time`, `seed` | 308-319 |
| any | `answer look.look` before region | | rejected | `IntakeError` from `options()` | 126 |
| any | `answer replay.weeks` before `run_time` | | rejected | | 197 |
| any | `answer` twice, same value | | same | idempotent, withdraws confirmation | 268-271 |
| ask | `next` | default exists, not `always_ask` | default applied | writes the file | 407-410 |
| confirm | `show` | no missing or invalid | confirm, `shown` set | writes the file | 452-474 |
| confirm | `answer confirmed yes` | `shown == hash` | complete | | 342-347 |
| complete | `answer` anything | | confirm | confirmation withdrawn (T26) | 271 |
| complete | hand edit of `render.yaml` | | confirm | hash differs, `confirmed` false (T26) | 356 |

Sound (T26 REFUTED, nothing stale): `confirmed yes` before `show` is refused; an answer after confirmation withdraws it; answering the same question twice is accepted and idempotent; a hand edit after `show` makes `confirmed` false. A hand-written `render.yaml` with no `intake:` block skips the gate by design ([spec.py:185-187](paperdolls/spec.py:185)).

Reachable invalid states:

- **T23 FIXED (4c48c0c)**: `Intake.__init__` reads the file, `save` rewrites all of it ([intake.py:84, 97-100](paperdolls/intake.py:84)). Two instances that load before either saves lose the first answer: `after both answers: goal=None name='my project' (a's answer is gone; both commands printed OK)`. Real overlap needs two processes within a few milliseconds; the interleaving was injected between load and save of two instances. Likelihood depends on the driving model issuing parallel tool calls.
- **T24 FIXED (0180458)**: (a) a file cut inside a flow sequence gives `yaml.YAMLError` out of every command (`cmd_intake` catches `IntakeError`); (b) a file cut to zero bytes: `exit=0 status=ask progress={'answered': 0, 'of': 6}` while `goal` and `name` had been answered: the interview silently restarts, and the user's earlier decisions are gone from the file with no message. `save()` is a plain `write_text`, so a kill mid-write is the cause of both; a non-dict YAML document (a list) fails with `AttributeError` at `self.data.items()` (SUSPECTED, same cause, not run).
- **T25 FIXED (4c48c0c)**: changing `goal` deletes the other branch's answers but not their bookkeeping. After `model_replay`, `model.source=vendored`, overrides answered, `goal=place_scene`, `goal=model_replay`, `model.source=vendored`: `overrides_answered=True; question state=answered; model.params has 37 keys, rebuilt from the preset`. `apply_overrides` also "undoes" stale `override_keys` against the new preset. The overrides question is not asked again, and `show` prints `you said` for values that were reset. Likelihood low.
- **T27 FIXED (6ebc83e)**: `spec.validate` does `int(params["n"])` ([spec.py:80](paperdolls/spec.py:80)); `n: abc` or `n:` (null) is `ValueError`/`TypeError`, caught nowhere (`cmd_validate` and `_replay_spec` catch `SpecError`). A hand-written spec only; the intake parses `n` as an int.
- Half-written `render.yaml` while the gate reads it: `require_confirmed` loads YAML itself ([spec.py:185](paperdolls/spec.py:185)) and fails the same way as T24(a).

## M8. Export, trajectory file and replay build (`export.py`, `replay_build.py`, `cli.cmd_export/frames/build/replay`)

Identity: implicit; the state is the `.npz` trajectory on disk and the spec. `run_and_export` [export.py:129](paperdolls/export.py:129) writes with `np.savez_compressed` ([export.py:158](paperdolls/export.py:158)).

Invariants: the trajectory named in the next command exists and has the weeks the spec asks for; the replay page's `n` is the number of model buildings and the scene has at least that many ([cli.py:118-120](paperdolls/cli.py:118)); model variables used by the mapping are in the file ([cli.py:113-116](paperdolls/cli.py:113)).

- **T22 FIXED (0180458)**: `export --out traj` prints `wrote .../traj` and `traj.npz` is what exists: `export exit=0 printed 'wrote /tmp/.../traj'; file 'traj' exists=False; files=['render.yaml', 'traj.npz']; next command exit=1: FileNotFoundError`. Cause: numpy appends the suffix. Not atomic either; a kill during the save leaves a truncated zip that `np.load` rejects with `BadZipFile` (SUSPECTED, not run).
- **SUSPECTED**: `replay.weeks` are validated against `run_time` ([spec.py:84](paperdolls/spec.py:84)), but the trajectory records only the weeks the model calls the hook for (`weeks_recorded`); a model that stops early makes `codes_for_week` raise `IndexError` in `cmd_frames`. Blocked on a model that stops early: the toy model in `tests/` always runs every week and the vendored model is not installed here.
- REFUTED: `cmd_replay` with a scene smaller than the model is refused with a clear message ([cli.py:119](paperdolls/cli.py:119)); non-finite values in variables become `null` in the payload (`_clean`).

## M9. bindScene flow (`viz/packruntime.js`, `viz/packhost.js bindRenderer`, `viz/packstore.js bindScene`)

Identity: `PackRuntime.bindScene(manifest, impl, scene)` [packruntime.js:60](viz/packruntime.js:60); pure function; result `{ok, bound, error, warnings, counts, attrs, pos}`; consumed by `bindRenderer` [packhost.js:179-189](viz/packhost.js:179) and by `packcheck.js`.

States of one binding: `unbound` (runtime has no `bindScene`: `{ok:true, bound:false}`, invented placement), `failed` (`ok:false`), `bound` (`pos[name]` is an `Int32Array` of scene indices, `-1` for not drawn).

Invariants: `sceneIndex[name].length === count` ([packruntime.js:74](viz/packruntime.js:74)); each scene building is used by at most one entity ([packruntime.js:82](viz/packruntime.js:82)); an unknown id is a warning, not an error; `pos` has an entry per returned entity.

Transitions: exception in `impl.bindScene` becomes `failed`; wrong shape becomes `failed`; entity not in manifest becomes `failed`; null/undefined id gives `-1` silently; unknown id gives `-1` and a warning; second claim of a building gives `-1` and a warning.

Findings (`bindscene_repro.js`; `B` labels mean "observed", the verdict is here):

- **B01** duplicate scene ids: the scene key map keeps the first ([packruntime.js:67](viz/packruntime.js:67)); the toy runtime lists the id twice; observed `pos = [0,-1,2]` with the warning `1 building entities share a scene building with an earlier one (w1): not drawn`. Handled with a warning, but the message blames the model, not the scene (the real cause is M3, T11), and one residential building is silently left out of the model.
- **B02** a runtime that returns `'1'` for a scene id `1`: Map lookup is strict, `pos=-1,-1`, warning names both ids. Handled with a warning.
- **B03 CONFIRMED (silent), not in this fix set**: `bindScene` returning `{entities:{}, sceneIndex:{}}` while the manifest declares `building` from `scene`: `ok=true bound=true counts={} pos keys=<none> warnings=0`. `bindRenderer` sees `bound.pos[en]` undefined and falls back to the invented placement ([packhost.js:181](viz/packhost.js:181)), so the page draws entities on invented buildings as if unbound, without the "invented" caveat tied to a bound runtime and with no warning. Impact low (a runtime bug), but it is the one place where a pack author's mistake changes what is drawn without a message. Owner for the fix: sm-runtime/`packhost.js`.
- **B04** zero buildings, or none residential: the toy runtime throws, `PackRuntime` returns `ok:false` with `bindScene: the scene has no residential buildings to bind to`. Handled; whether the page shows it is sm-runtime's.
- **B05** `neighbours` naming `ghost`, itself, or repeated: observed `attrs.neighbours=[[1,0,1],[0]]` (the unknown is dropped, the self link and the repeat survive). The ingest never produces these; a hand-made scene can.
- **B06** missing, `0` and `"0"` ids: addressed as `#0`, `#1`, `0`, `"0"`, all distinct. REFUTED.
- **B07** entity count above the buildings the scene has: extras get `-1`; only unknown ids warn, `null`/`undefined` stay silent by documented design.
- **B08** NaN footprint with no `area`: the toy runtime computes `area` as NaN (JSON null) and derives units and hubs from it. Reaches the model; the ingest always sets `area`.
- `pos` of `-1` is handled downstream: `modelOf` and `index` ignore negative entries ([packhost.js:186](viz/packhost.js:186), [packstore.js bound](viz/packstore.js:178)); not attacked further here.

## M10. Validators: `pack.py`, `viz/packvalidate.js`, `schemas/pack.schema.json`

Identity: three implementations of one rule set, stated to agree on `tests/pack_cases.json`. The existing test compares the first two on the cases only.

Method: `validator_diff.py` generates 3000 manifests from the base case with 1 to 3 random mutations (wrong types, empty, NaN, inf, 2**70, deleted keys, extra keys) and runs `pack.validate`, the JS validator (through `validator_diff.js`, NaN/Infinity as JS literals, which is what the page contains) and the schema. Observed (`validator_diff.out.txt`):

```
{"total": 3000, "py_crash": 37, "js_crash": 0, "verdict_differs": 0, "message_set_differs": 268, "schema_accepts_but_both_reject": 101, "schema_rejects_but_both_accept": 44, "both_accept": 249}
```

- **Verdicts (errors empty or not): Python and JS never disagree** on the 2963 manifests where Python returned. REFUTED as a state disagreement.
- **37 Python crashes, 0 JS crashes**: T28 (above).
- **268 message-set differences**, all cosmetic: Python prints `None`/`nan`/`inf`/`[None]` and JS prints `undefined`/`NaN`/`Infinity`/`[object Object]` for the same bad value; `str(True)` versus `true` for non-string YAML keys. Messages are used verbatim in the dev error page and in `pack check`, so an author sees two wordings for one problem. Low.
- **Schema versus validators**: 101 manifests the schema accepts and both validators reject (expected: the schema is structural only; cross-references such as an unknown entity, a preset value out of range, a default outside min/max are semantic). 44 the schema rejects and **both validators accept**: unknown keys inside `scale.values.<v>` entries and inside enum `{value, label}` entries (the schema has `additionalProperties: false`, the validators ignore extra keys there), and a non-string `scale.label` (validators only warn "missing"). A pack with such keys passes `pack check`, builds, and is rejected by an editor using the schema.
- Not covered by the fuzz and agreed by reading: `time.speed`/`speeds`, `runtime.files` rules (Python only checks existence on disk; JS has no disk), `norm_file` (Python only; JS cannot see paths, the browser never needs it).

## After the fixes: new guards, invariants and transitions

Shared helpers (`d8401e2`): [paperdolls/fsutil.py](paperdolls/fsutil.py) has `write_atomic` (temp file in the target's folder, fsync, `os.replace`, temp removed on failure),
`write_atomic_group` (stage every file and check every target before the first replace; the caller lists the reports first and the scene last), `file_lock`
(advisory `flock` on `.<name>.lock`; `msvcrt` on Windows, not exercised here) and `read_yaml_mapping` (an unreadable, unparsable, empty or non-mapping file is an
error that names the file). `cli._run` is the error boundary: `SystemExit` passes through; known types (`OSError`, `ValueError` and so `SpecError`, `IngestError`,
`FetchError`, `PlaceError`, `PackError`, `IntakeError`; `HTTPException`, `BadZipFile`, `YAMLError`) become `error: <one line>` and exit 1; anything else prints `internal error: ...
re-run with --debug` (or `PAPERDOLLS_DEBUG=1`) and exits 1, with the traceback under `--debug`. `tests/conftest.py` now refuses any non-loopback connection, so no test can reach Overpass.

**M1 Overpass fetch.** Invariants now holding: `out_path` is written atomically and only ever holds an object with a non-empty `elements` list (`fetch.py`); every failure is
`FetchError`. Rows changed:

| From | Event | Guard | To | Side effects |
|------|-------|-------|----|--------------|
| requested | body cut short (`IncompleteRead`, any `HTTPException`) | | rejected | `FetchError("the download ... was cut off ... Nothing was saved")`, hint to retry or use overpass-turbo |
| body read | JSON but not an object, `elements` not a list | | rejected | `FetchError("... not an Overpass result")` |
| body read | otherwise | | saved | `write_atomic` |

**M2 Place and the extract cache.** New state file `extract.meta.json` = `{relation, bbox, query_version, query_sha256}` written after a fetch. Invariant: `extract.json` is used only
when it parses as an object with `elements` AND its record equals the key of the current spec; the key includes a hash of the query text, so editing the query also invalidates.

| From | Event | Guard | To | Side effects |
|------|-------|-------|----|--------------|
| any | `place` | record equals key, file parses | (unchanged) | no fetch |
| any | `place` | record differs (new bbox, new relation, new `QUERY_VERSION`) | extracted | refetch; warning `fetched a new extract: extract.json was fetched for bbox A, not for bbox B` in the report |
| any | `place` | no record, but `query.ql` is exactly this query (a hand export saved as the message told the user) | extracted | record written, file used |
| any | `place` | no record and no matching `query.ql`, or file damaged | extracted | refetch |
| any | `place --no-fetch` | extract unusable | query saved | `PlaceError` naming the reason and `place --refetch` |
| extracted | ingest error on a cached extract | | extracted | `PlaceError("the ingest failed: ... run 'paperdolls place --refetch' ...")` |
| extracted | ingest ok | | scened | `write_atomic_group`: `scene_report.md`, `scene_report.json`, then `scene.json` |
| any | `place` | hand-written place block missing a field | | `SpecError` from `spec.validate` (`_validate_place`), or `PlaceError` from `run` |

`place --endpoint URL` was added so tests and repros use a local fake. `overpass_query(relation, bbox)` now filters by both. A legacy `out/` folder from before the fix has an
extract with no record: it is refetched unless `query.ql` matches (the normal `place` flow wrote it), which is the one-time cost of the change.

**M3 Ingest.** Invariants 1 to 4 now hold (`build.py`, `validate.py`): ids are unique (the first is kept, later ones counted under `skipped`), footprints are simple (`geo.ring_self_crossings`,
proper crossings only), every number is finite (features with a non-finite or out-of-range latitude/longitude are dropped and counted; `allow_nan=False` on write), an empty scene is
warned about with the reasons. `validate_scene` (a port of the `validateScene` rules the ingest must meet) runs before the report is built; a violation is an `IngestError` and nothing is written.

| From | Event | Guard | To | Side effects |
|------|-------|-------|----|--------------|
| (start) | read file | element lacks `type`/`lat`, or the JSON is not an object | `ValueError` naming the file | `ingest failed:` exit 1 |
| (start) | `--max-buildings N` | N below 1 | `IngestError` | exit 1 (0 no longer means no limit; leave the option out) |
| (start) | `--bbox` | not four finite numbers, south not below north or west not below east | `IngestError` / exit 1 | |
| features | any coordinate not finite or out of range | | feature dropped | `skipped` + warning |
| clipped | project buildings | ring crosses itself | dropped | `skipped["building footprint crosses itself"]` + warning |
| clipped | project buildings | id already used | dropped (first kept) | `skipped["building with an id already used (kept the first)"]` + warning |
| built | no buildings in the scene | | scene still written | warning with the counts of why |
| built | `validate_scene` finds errors | | `IngestError` | nothing written |
| scene | CLI | | one group write | reports first, scene last; a bad target replaces none |

Real data: the Jette extract (relation 58258, 9,214 buildings, 1,320 roads, 1,089 landuse, 8,705 trees) gives a scene, `scene_report.json` and `scene_report.md` identical to aa2d936's apart from `area.generated`
(Jette has no duplicate id and no self-crossing footprint); the committed fixture scene is reproduced by a test.

**M4 Pack check and build.** Invariants now holding: what is built is what was validated (one read of `pack.yaml`, one read of each runtime file, `pack._Sources`); the page parses
(`viewer_build._fill` substitutes in one pass, so put-in text is never rescanned); `runtime.entry` is a relative path inside the folder, also after symbolic links; the output is complete or absent.

| From | Event | Guard | To | Side effects |
|------|-------|-------|----|--------------|
| (start) | `pack build` | scene loads | scene held | |
| scene held | read `pack.yaml` | once | manifest held | |
| manifest held | `check(path, include, manifest, sources)` | errors (including entry/files outside the folder, symlink escapes, an unincluded required sibling) | `PackError` | exit 1 |
| validated | read runtime files | once each, same bytes as the check | sources held | `</script`/`<!--` still refused |
| sources held | fill template | one pass: manifest, scene, title, runtime source | page | markers inside them stay text |
| built | size over budget | trim stages, as before | `PackError` if still over | |
| built | write `--out` | | done | `write_atomic` |

**M5 Pack dev.** T19: `serve()` no longer needs a parsed manifest for its banner, so `pack dev` on a first typo serves the error page and reloads on the fix. T30: `include` is passed to `check`.

**M6 Pack check.** `packcheck.run` reads the manifest and the runtime files once and passes them to `check`; `--include` is honoured. T28: `pack.validate` is total.

**M7 Intake.** Invariant 5 (the file is always valid YAML holding the answers so far) now holds by atomic replace; invariant 6 (one writer at a time) by an advisory lock.
Rows changed:

| From | Event | Guard | To | Side effects |
|------|-------|-------|----|--------------|
| any | `answer`, `confirmed`, `next`, `show` | lock `.render.yaml.lock` free | transaction | read the file as it is now, change, atomic write, release; re-entrant (`answer` calls `confirm`) |
| any | any command | file unparsable, empty or not a mapping | `IntakeError` (exit 3) naming the file | the file is left as it is |
| any | `answer goal X` | branch removed | the other branch's answers go with their bookkeeping | `defaults` entries under the removed keys, `override_keys`, `overrides_answered` removed (`model` branch) |
| any | `answer goal X` | same goal again | unchanged | |

`spec.load` and `require_confirmed` report an unreadable project file as `SpecError`. T27: `n` and `run_time` must be whole numbers (`SpecError`).

**M8 Export.** `run_and_export` normalises the name to `.npz`, writes atomically and returns the real path, which `export` prints; `export.load` finds `traj.npz` for `traj`, and a truncated archive is a message (`ValueError`).

**M10 Validators.** After the fixes `validator_diff.py 3000 1` reports `{"py_crash": 0, "js_crash": 0, "verdict_differs": 0, "locations_differ": 0, "schema_rejects_but_both_accept": 0, "disagreements": 0}`; the same for
seeds 1 to 12 (36,000 manifests). `wording_differs` (281 for seed 1) counts messages that flag the same places but print a bad value differently (`None`/`null`, `nan`/`NaN`, `{'a': 1}`/`[object Object]`);
`schema_accepts_but_both_reject` (101) is the expected semantic gap. Rules made equal in `pack.py` and `viz/packvalidate.js`: unknown keys in `scale.values.<v>` and enum `{value, label}` entries,
a non-string `scale.label`, `group` only on `groundtint`, `runtime.entry` a relative path inside the folder, `spec: true` is not 1, a preset key naming a parameter whose definition is falsy, the banner truthiness, and the
"no entry for" warning (strings only, own keys only). A bounded version runs in the test suite (`test_the_three_validators_agree_on_mutated_manifests`, 2 x 600 manifests).

### Changes to the repros

`tooling_repro.py`: a guard refuses any non-loopback connection (running T05/T06 against the fixed code first reached the public Overpass: see "What went wrong while fixing"); T05 and T06 use `fake_fetch`;
T05 first runs `place` for the small bbox, then enlarges; T06 also checks the `--no-fetch` message; T12 treats the refusal as holding; T14 expects nothing replaced; T16 injects the edit after the first manifest read (the
`check()` hook no longer exists in `build`); T17 treats a refusing `build` as holding; T18 uses `write_atomic`; T22 gives its spec `replay.registers` and checks the printed path exists. `validator_diff.py` has `compare(n, seed)` with the hard-disagreement counters.
Outputs: `tooling_repro.out.txt` (T01 to T30 all `REFUTED`: the code holds), `validator_diff.out.txt`; `bindscene_repro.out.txt` is unchanged (the B cases are runtime-layer, owned by `fix-runtime`).

### What went wrong while fixing, and what is not fixed

- **Two real Overpass requests were made by accident.** The committed T05/T06 repros called the real `fetch_overpass` once the cache was keyed (before, nothing was fetched). Running them once against the fixed code sent one bbox request each
  (50,4,50.01,4.01 and a larger one) to overpass-api.de from a temp folder; nothing was kept. The guard and `fake_fetch` above make that impossible; `tests/conftest.py` has the same guard.
- **New finding, fixed in `db9bb18`:** an out-of-range latitude (95) made aa2d936's ingest not finish within 15 s; it is now dropped like the other non-finite coordinates.
- Not fixed: the SUSPECTED items that need a real server or kill (slow-trickle download that never times out; an Overpass answer with a `remark` that does not contain "error"; kill during `write_bytes` is now atomic but a slow trickle is not bounded).
  Two `ingest` processes on one `--out` can still interleave at the granularity of whole files (each file is atomic, the group is not); the order reports-then-scene keeps a reader that sees the new scene reading its reports.
  `place` with `kind: scene_file` still copies the file as given (it checks the four lists only; the viewer validates). The `.lock` file stays beside `render.yaml`. `file_lock` on Windows (`msvcrt`) is written but not exercised. Message wording
  differences between the validators for bad values remain by design of the fuzz (counted, not failing). B01 to B08 (the runtime layer) were not touched.

## Implicit machines checked and found sound

- `readers.assemble_rings`: open relations are counted and reported (`open_relation_fragments`, `open_relations`), not silently dropped ([build.py:370-371](paperdolls/ingest/build.py:370)).
- Size trimming (`pack.TRIM_STAGES`): monotone, reports what was lost, never removes the fields the renderer and `bindScene` need.
- `DevState` scene cache: a failed scene load keeps the previous scene object but not its signature, so a fixed file reloads.

## Suggested issue grouping (done: A-G are GitHub issues #8 to #13, all fixed, see the top)

A. Caches and outputs without identity or atomicity: T05, T06, T14, T18, T22, T24 (extract keyed by the query; atomic write helper used by ingest, place, pack build, export, intake).
B. Exceptions that escape CLI boundaries: T01-T03, T07, T08, T19, T27, T28 (one catch-and-hint layer; `FetchError` for every network failure; `PackError`/`SpecError` for malformed input).
C. Ingest output not validated: T09-T13, T29 (unique ids, finite coordinates, warn on zero buildings, simple polygons, argument checks).
D. Repeated reads in `pack.build`, the unconfined `runtime.entry`, and `include` not passed to `check`: T16, T17, T30.
E. Template substitution over inlined content: T15 (substitute once, in one pass, or put the runtime in last).
F. Intake state: T23 (lock file or read-modify-write with a compare), T25 (reset bookkeeping with the branch).
G. Validators: T28, message normalisation, schema/validator agreement on unknown keys.
