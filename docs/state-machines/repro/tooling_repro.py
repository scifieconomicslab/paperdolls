#!/usr/bin/env python
"""Deterministic repros for docs/state-machines/parts/20-tooling-data.md (tooling and data pipeline layer).

Run all:      /data/ScifiEconomicsLab/TheGreatRetrofit/.venv/bin/python docs/state-machines/repro/tooling_repro.py
Run some:     ... tooling_repro.py T01 T04
Each repro prints `Txx REPRODUCED` (the invalid state or transition happened), `Txx REFUTED` (the code held) and the evidence.
No external network: the only server is a local one bound to 127.0.0.1 on a free port. Nothing outside a temp folder is written.
Run from the repository root. This file changes no engine code; it only imports it.
"""
import contextlib
import io
import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
import traceback
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))
PY = sys.executable
REPROS = {}


def repro(tid):
    def deco(fn):
        REPROS[tid] = fn
        return fn
    return deco


def tmp():
    return Path(tempfile.mkdtemp(prefix="pdrepro-"))


def _block_outside_network():
    """Safety net: a repro must never reach a real server (Overpass). Any connect to a non-loopback address fails."""
    real = socket.socket.connect

    def guarded(self, address):
        host = address[0] if isinstance(address, tuple) else address
        if isinstance(host, str) and not (host.startswith("127.") or host in ("::1", "localhost")) and self.family != getattr(socket, "AF_UNIX", -1):
            raise OSError(f"repro network guard: refusing to connect to {host}")
        return real(self, address)
    socket.socket.connect = guarded


_block_outside_network()


def fake_fetch(calls, elements):
    """A stand-in for place.fetch_overpass: counts the call and writes a canned extract. Never touches the network."""
    def fetch(query, out_path, *a, **k):
        calls.append(query)
        extract(out_path, elements)
        return len(elements)
    return fetch


# ---------------------------------------------------------------- fixtures

def way(i, pts, tags):
    return {"type": "way", "id": i, "tags": tags, "geometry": [{"lat": a, "lon": b} for a, b in pts]}


def square(lat, lon, d=0.0002):
    return [(lat, lon), (lat, lon + d), (lat + d, lon + d), (lat + d, lon), (lat, lon)]


def bld(i, pts, **t):
    return way(i, pts, {"building": "yes", **t})


ROAD = way(99, [(50.0, 4.0), (50.001, 4.001)], {"highway": "residential"})


def extract(path, elements):
    Path(path).write_text(json.dumps({"elements": elements}), encoding="utf-8")


class Fake(BaseHTTPRequestHandler):
    """A local stand-in for Overpass. mode is set on the server: html, 429, list, truncated, ok."""
    def log_message(self, *a):
        pass

    def do_POST(self):
        self.rfile.read(int(self.headers.get("Content-Length", 0)))
        mode = self.server.mode
        if mode == "429":
            self.send_response(429, "Too Many Requests"); self.send_header("Content-Length", "0"); self.end_headers(); return
        if mode == "html":
            body = b"<html><body>The server is probably too busy</body></html>"
            ctype = "text/html"
        elif mode == "list":
            body, ctype = b"[]", "application/json"
        elif mode == "truncated":                      # promise 100000 bytes, send 50, drop the connection (a reset or timeout mid-download)
            self.send_response(200); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", "100000"); self.end_headers()
            self.wfile.write(b'{"elements": [{"type": "way"'); self.wfile.flush(); self.close_connection = True; return
        else:
            body, ctype = json.dumps({"elements": [bld(1, square(50.0, 4.0))]}).encode(), "application/json"
        self.send_response(200); self.send_header("Content-Type", ctype); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)


class QuietServer(ThreadingHTTPServer):
    def handle_error(self, request, client_address):
        pass


@contextlib.contextmanager
def fake_overpass(mode):
    srv = QuietServer(("127.0.0.1", 0), Fake)
    srv.mode = mode
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        yield f"http://127.0.0.1:{srv.server_address[1]}/api/interpreter"
    finally:
        srv.shutdown(); srv.server_close()


def run_cli(*args, cwd=None):
    p = subprocess.run([PY, "-m", "paperdolls", *args], capture_output=True, text=True, cwd=cwd or ROOT, timeout=120)
    return p.returncode, p.stdout, p.stderr


def tail(s, n=3):
    return " | ".join(s.strip().splitlines()[-n:])


# ---------------------------------------------------------------- fetch (ingest/fetch.py)

@repro("T01")
def t01_fetch_connection_dropped_mid_body():
    """A response cut off mid-body raises http.client.IncompleteRead, which fetch_overpass does not catch (only HTTPError, URLError, TimeoutError, OSError)."""
    from paperdolls.ingest.fetch import FetchError, fetch_overpass
    d = tmp()
    with fake_overpass("truncated") as url:
        try:
            fetch_overpass("q", d / "extract.json", endpoint=url, timeout=5)
            return False, "no error"
        except FetchError as e:
            return False, f"FetchError (handled): {e}"
        except Exception as e:
            return True, f"{type(e).__name__} escaped (not FetchError): {e!r}; out file exists={ (d / 'extract.json').exists() }"


@repro("T02")
def t02_cli_fetch_drop_is_a_traceback():
    """Same drop through the real command: `paperdolls osm-fetch --endpoint` exits with a traceback instead of 'fetch failed: ...'."""
    d = tmp()
    with fake_overpass("truncated") as url:
        rc, out, err = run_cli("osm-fetch", "--bbox", "50,4,50.1,4.1", "--out", str(d / "e.json"), "--endpoint", url)
    return ("Traceback" in err and "fetch failed" not in err), f"exit={rc}; stderr tail: {tail(err)}"


@repro("T03")
def t03_fetch_valid_json_but_not_an_object():
    """200 with valid JSON that is not an object (a list): data.get raises AttributeError, not FetchError."""
    from paperdolls.ingest.fetch import FetchError, fetch_overpass
    d = tmp()
    with fake_overpass("list") as url:
        try:
            fetch_overpass("q", d / "e.json", endpoint=url, timeout=5)
        except FetchError as e:
            return False, f"FetchError: {e}"
        except Exception as e:
            return True, f"{type(e).__name__}: {e}"
    return False, "accepted"


@repro("T04")
def t04_fetch_error_page_and_429_do_not_poison_the_cache():
    """An HTML error page (200) or a 429 must not leave extract.json behind, and must not overwrite a good one."""
    from paperdolls.ingest.fetch import FetchError, fetch_overpass
    d = tmp()
    good = d / "extract.json"
    extract(good, [bld(1, square(50.0, 4.0))])
    before = good.read_bytes()
    notes = []
    for mode in ("html", "429"):
        with fake_overpass(mode) as url:
            try:
                fetch_overpass("q", good, endpoint=url, timeout=5)
                notes.append(f"{mode}: ACCEPTED")
            except FetchError as e:
                notes.append(f"{mode}: FetchError '{str(e)[:60]}'")
    untouched = good.read_bytes() == before
    fresh = d / "fresh.json"
    with fake_overpass("html") as url:
        with contextlib.suppress(FetchError):
            fetch_overpass("q", fresh, endpoint=url, timeout=5)
    return (not untouched or fresh.exists()), f"good extract untouched={untouched}; fresh.json written={fresh.exists()}; leftovers={sorted(p.name for p in d.iterdir())}; {notes}"


# ---------------------------------------------------------------- place (place.py): the extract cache

def place_spec(d, bbox):
    import yaml
    spec = {"goal": "place_scene", "name": "t", "place": {"kind": "bbox", "bbox": bbox}, "look": {"region": "ce"}, "output": {"dir": "out"}}
    (d / "render.yaml").write_text(yaml.safe_dump(spec), encoding="utf-8")
    return d / "render.yaml"


@repro("T05")
def t05_place_reuses_a_cached_extract_for_a_different_area():
    """out/extract.json is a cache keyed by nothing. Change place.bbox to a larger area, run `place` again: no refetch, and a scene of the OLD area comes out, with no warning."""
    from paperdolls import place as placemod
    from paperdolls.ingest import fetch as fetchmod
    d = tmp()
    spec = place_spec(d, [50.00, 4.00, 50.01, 4.01])
    calls = []
    real = placemod.fetch_overpass
    placemod.fetch_overpass = fake_fetch(calls, [bld(1, square(50.001, 4.001)), bld(2, square(50.002, 4.002)), ROAD])        # the first run: fetched for the small bbox
    try:
        placemod.run(spec)
        calls.clear()
        placemod.fetch_overpass = fake_fetch(calls, [bld(i, square(50.0 + i * 0.01, 4.0)) for i in range(1, 6)] + [ROAD])  # what the server answers for the larger bbox
        spec = place_spec(d, [49.90, 3.90, 50.10, 4.10])                                                         # the user enlarges the area (intake answer place.bbox)
        r = placemod.run(spec)
    finally:
        placemod.fetch_overpass = real
    return (not calls and r["buildings"] == 2), f"fetch calls={len(calls)}; buildings={r['buildings']} for the NEW (larger) bbox; warnings={r['warnings']}"


@repro("T06")
def t06_place_truncated_cache_fails_forever_without_a_hint():
    """A half-written extract.json (killed fetch, disk full, hand-saved bad export) is reused on every run; the message says 'ingest failed' and never mentions --refetch or deleting the file."""
    from paperdolls import place as placemod
    d = tmp()
    spec = place_spec(d, [50.0, 4.0, 50.01, 4.01])
    out = d / "out"; out.mkdir()
    (out / "extract.json").write_text('{"elements": [{"type": "way", "id": 1, "geometry": [{"lat": 50.0', encoding="utf-8")
    msgs, calls = [], []
    real = placemod.fetch_overpass
    placemod.fetch_overpass = fake_fetch(calls, [bld(1, square(50.0, 4.0)), ROAD])
    try:
        for _ in range(2):
            try:
                placemod.run(spec)
            except placemod.PlaceError as e:
                msgs.append(str(e))
    finally:
        placemod.fetch_overpass = real
    (out / "extract.json").write_text('{"elements": [{"type": "way", "id": 1, "geometry": [{"lat": 50.0', encoding="utf-8")
    try:
        placemod.run(spec, fetch=False)                                   # with --no-fetch the damaged file cannot be replaced: the message must say what to do
        nofetch = "no error"
    except placemod.PlaceError as e:
        nofetch = str(e)
    return (len(msgs) == 2 and "refetch" not in msgs[0].lower()), f"errors with fetching allowed={len(msgs)}; refetched {len(calls)} time(s); with --no-fetch: {nofetch[:150]!r}"


@repro("T07")
def t07_place_hand_written_spec_crashes_with_a_traceback():
    """validate() checks place.kind and look.region only. A bbox place with no/short bbox or an osm_relation with no relation passes validation and then fails inside place.run with KeyError/ValueError/IndexError that cmd_place does not catch."""
    d = tmp()
    import yaml
    res = []
    for place in ({"kind": "osm_relation"}, {"kind": "bbox", "bbox": [50, 4, 50.1]}, {"kind": "extract_file"}):
        (d / "render.yaml").write_text(yaml.safe_dump({"goal": "place_scene", "name": "t", "place": place, "look": {"region": "ce"}}), encoding="utf-8")
        rc, out, err = run_cli("place", str(d / "render.yaml"))
        res.append(f"{place['kind']}: exit={rc} {tail(err, 1)[:90]}")
    return all("Error" in r and "cannot continue" not in r for r in res), "; ".join(res)


# ---------------------------------------------------------------- ingest bad inputs

def ingest(elements, **kw):
    from paperdolls.ingest import build
    f = tmp() / "e.json"
    extract(f, elements)
    return build.ingest(f, **kw)


@repro("T08")
def t08_ingest_malformed_element_escapes_the_cli():
    """An element without "type", or a node without lat, raises KeyError. cmd_ingest and place catch IngestError and ValueError only."""
    d = tmp()
    notes = []
    for name, els in (("no type", [{"id": 1}]), ("node without lat", [{"type": "node", "id": 5, "tags": {"natural": "tree"}}])):
        extract(d / "e.json", els)
        rc, out, err = run_cli("ingest", str(d / "e.json"), "--out", str(d / "scene.json"))
        notes.append(f"{name}: exit={rc} {tail(err, 1)}")
    return all("KeyError" in n for n in notes), "; ".join(notes)


@repro("T09")
def t09_ingest_writes_an_empty_scene_without_a_warning():
    """Every building degenerate (a line, a bowtie of zero area) but one road: ingest succeeds with 0 buildings and the report has no warning about it. A pack with `from: scene` then has nothing to bind."""
    sc, rep = ingest([bld(1, [(50, 4), (50, 4.0002), (50, 4)]), bld(2, [(50.0, 4.0), (50.0002, 4.0002), (50.0, 4.0002), (50.0002, 4.0), (50.0, 4.0)]), ROAD])
    return (len(sc["buildings"]) == 0 and not any("building" in w.lower() for w in rep["warnings"])), f"buildings={len(sc['buildings'])}; warnings={rep['warnings']}; skipped={rep['skipped']}"


@repro("T10")
def t10_ingest_infinite_coordinate_gives_an_infinity_origin_and_an_empty_scene():
    """One building with lon=Infinity (Python's json accepts it) is enough to make the origin Infinity: every point projects to NaN, everything is dropped, the scene still gets written, and scene.json holds `Infinity`, which is not JSON."""
    d = tmp()
    f = d / "e.json"
    f.write_text(json.dumps({"elements": [bld(1, square(50.0, 4.0)), bld(2, [(50, 4), (50, float("inf")), (50.1, 4.1), (50, 4)]), ROAD]}), encoding="utf-8")
    rc, out, err = run_cli("ingest", str(f), "--out", str(d / "scene.json"))
    text = (d / "scene.json").read_text() if (d / "scene.json").exists() else ""
    sc = json.loads(text) if text else {}
    return ("Infinity" in text and not sc.get("buildings")), f"exit={rc}; scene has Infinity={'Infinity' in text}; buildings={len(sc.get('buildings', []))}; origin={sc.get('area', {}).get('origin')}; stdout={tail(out, 3)[:160]}"


@repro("T11")
def t11_ingest_duplicate_ids_pass_through():
    """Two elements with the same way id (two extracts concatenated by hand) give two scene buildings with the same id and no warning."""
    sc, rep = ingest([bld(1, square(50.0, 4.0)), bld(1, square(50.001, 4.001)), ROAD])
    ids = [b["id"] for b in sc["buildings"]]
    return (len(ids) != len(set(ids)) and not rep["warnings"]), f"ids={ids}; warnings={rep['warnings']}"


@repro("T12")
def t12_ingest_negative_max_buildings():
    """--max-buildings -1: `if max_buildings and len(bld) > max_buildings` is true for any negative value; bld[:-1] drops the last one and the report counts len+1 as skipped."""
    els = [bld(i, square(50.0 + i * 0.001, 4.0)) for i in range(1, 4)] + [ROAD]
    sc, rep = ingest(els, max_buildings=-1)
    skipped = {k: v for k, v in rep["skipped"].items() if "max-buildings" in k}
    return (len(sc["buildings"]) == 2 and list(skipped.values()) == [4]), f"3 buildings in, {len(sc['buildings'])} out, skipped reported={skipped}"


@repro("T13")
def t13_ingest_self_intersecting_footprint_is_kept():
    """A figure-8 footprint with unequal lobes has a non-zero signed area, so it passes the 8 m2 test and goes into the scene as a building (the renderer extrudes it)."""
    pts = [(50.0, 4.0), (50.0004, 4.0006), (50.0, 4.0006), (50.0002, 4.0), (50.0, 4.0)]
    sc, _ = ingest([bld(1, pts), ROAD])
    from paperdolls.ingest.adjacency import _segs_cross
    fp = sc["buildings"][0]["footprint"] if sc["buildings"] else []
    n = len(fp)
    crossings = sum(1 for i in range(n) for j in range(i + 2, n) if not (i == 0 and j == n - 1) and _segs_cross(fp[i], fp[(i + 1) % n], fp[j], fp[(j + 1) % n]))
    return (len(sc["buildings"]) == 1 and crossings > 0), f"buildings={len(sc['buildings'])}; footprint={fp}; self-crossings={crossings}"


@repro("T14")
def t14_ingest_outputs_are_written_one_by_one():
    """cmd_ingest writes scene.json, then the .md report, then the .json report, each with write_text (no temp file, no rename). A failure on the 2nd or 3rd leaves a new scene beside an old or missing report."""
    d = tmp()
    f = d / "e.json"
    extract(f, [bld(1, square(50.0, 4.0)), ROAD])
    (d / "scene_report.md").mkdir()                                  # any reason the second write fails: a directory, a read-only file, a full disk
    rc, out, err = run_cli("ingest", str(f), "--out", str(d / "scene.json"))
    return ((d / "scene.json").exists() and not (d / "scene_report.json").exists() and rc != 0), f"exit={rc}; scene.json written={(d / 'scene.json').exists()}; scene_report.json written={(d / 'scene_report.json').exists()}; {tail(err, 1)}"


# ---------------------------------------------------------------- pack build

def toy_copy():
    import shutil
    d = tmp() / "toy"
    shutil.copytree(ROOT / "packs" / "toy-epidemic", d)
    return d


@repro("T15")
def t15_build_placeholder_in_the_manifest_is_replaced_by_the_scene():
    """viewer_build._fill replaces /*__TITLE__*/, /*__PACK__*/, /*__SCENE__*/ in that order over the WHOLE page, manifest JSON included. A banner (or any manifest string) containing /*__SCENE__*/ gets the scene spliced into it, and the page's MANIFEST literal no longer parses. A runtime source containing a library placeholder such as /*__VIZLIB__*/ is replaced the same way."""
    import yaml
    from paperdolls import pack
    d = toy_copy()
    m = yaml.safe_load((d / "pack.yaml").read_text())
    m["banner"] = "Data: see /*__SCENE__*/ in the report"
    (d / "pack.yaml").write_text(yaml.safe_dump(m, sort_keys=False))
    scene = {"buildings": [{"id": "w1", "footprint": [[0, 0], [5, 0], [5, 5]], "levels": 2, "archetype": "villa", "state": "none", "investor": False, "area": 12.5, "residential": "residential"}], "roads": [], "landuse": [], "trees": []}
    html, _ = pack.build(d, scene)
    line = next(l for l in html.splitlines() if l.strip().startswith("const MANIFEST ="))
    literal = line.split("=", 1)[1].strip().rstrip(";")
    try:
        json.loads(literal)
        return False, "MANIFEST literal still parses"
    except ValueError as e:
        return True, f"MANIFEST literal no longer parses ({e}); the scene id w1 appears inside it: {'w1' in literal}"


@repro("T16")
def t16_build_validates_one_read_of_the_manifest_and_builds_from_another():
    """pack.build() validates with check() (read 1), then reads the manifest again for the page (read 2) and a third time inside runtime_files (read 3). If the file changes after the validation, the page is built from a manifest that was never validated and build does not complain. The interleaving is injected right after check() returns, which is what an editor save during a build does."""
    import yaml
    from paperdolls import pack
    d = toy_copy()
    real = pack.check

    def check_then_edit(path):
        r = real(path)
        m = yaml.safe_load((d / "pack.yaml").read_text())
        m["id"] = "BAD ID"                                                   # invalid: check() would refuse this
        (d / "pack.yaml").write_text(yaml.safe_dump(m, sort_keys=False))
        return r
    pack.check = check_then_edit
    try:
        html, info = pack.build(d)
    finally:
        pack.check = real
    errors_now, _ = real(d)
    return (bool(errors_now) and '"id":"BAD ID"' in html), f"build returned a page ({info['bytes']} bytes) embedding id 'BAD ID'; check() on the same folder now says {errors_now[:1]}"


@repro("T17")
def t17_runtime_entry_outside_the_pack_is_accepted():
    """runtime.files entries must be inside the pack (norm_file); runtime.entry used alone is joined with `/` and not checked, so an absolute path or ../ is accepted by check and inlined by build."""
    import yaml
    from paperdolls import pack
    d = toy_copy()
    outside = d.parent / "outside.js"
    outside.write_text("/* outside the pack folder */ window.OUTSIDE = 1;", encoding="utf-8")
    m = yaml.safe_load((d / "pack.yaml").read_text())
    m["runtime"] = {"type": "js", "entry": str(outside), "seed": 7, "on_params": "rerun"}
    (d / "pack.yaml").write_text(yaml.safe_dump(m, sort_keys=False))
    errors, _ = pack.check(d)
    html, _ = pack.build(d)
    return (not errors and "window.OUTSIDE" in html), f"check errors={errors}; outside file inlined={'window.OUTSIDE' in html}"


@repro("T18")
def t18_pack_build_not_atomic_and_unprotected_against_a_second_process():
    """cmd_pack writes the page with Path.write_text straight onto --out. Two processes building to the same --out interleave at the OS level and a reader (or a browser reload) can read a prefix. Demonstrated by watching a 20 MB write from a reader thread: the file is visible at a size between 0 and the final size."""
    big = "x" * (20 * 1024 * 1024)
    d = tmp()
    out = d / "pack.html"
    sizes = set()
    stop = threading.Event()

    def reader():
        while not stop.is_set():
            with contextlib.suppress(OSError):
                sizes.add(out.stat().st_size)
    t = threading.Thread(target=reader); t.start()
    out.write_text(big, encoding="utf-8")                                      # exactly the call cmd_pack makes
    stop.set(); t.join()
    partial = sorted(s for s in sizes if 0 < s < len(big))
    return bool(partial) or 0 in sizes, f"final={len(big)} bytes; sizes seen by a concurrent reader={sorted(sizes)[:6]}"


# ---------------------------------------------------------------- pack dev

def get(url, timeout=5):
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return r.status, r.read().decode("utf-8")


@repro("T19")
def t19_dev_start_with_unparseable_manifest_is_a_traceback():
    """`pack dev` on a pack.yaml that is not valid YAML: DevState copes (error page), but serve() then calls packmod.watched_files() for the banner line, which raises PackError; cmd_pack catches OSError only."""
    d = toy_copy()
    (d / "pack.yaml").write_text("id: [unclosed\n  title: : :", encoding="utf-8")
    p = subprocess.Popen([PY, "-m", "paperdolls", "pack", "dev", str(d), "--port", "0"], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        out, err = p.communicate(timeout=20)
    except subprocess.TimeoutExpired:
        p.kill(); out, err = p.communicate()
        return False, "server kept running: " + tail(out)
    return ("Traceback" in err and "PackError" in err), f"exit={p.returncode}; stderr tail: {tail(err, 1)[:140]}"


@repro("T20")
def t20_dev_lifecycle_error_fix_reload_two_clients_disconnect_shutdown():
    """The state machine under normal and rough use: error -> fix -> ok; atomic rename save; truncated scene mid-write; two SSE clients both told; a client that vanishes; port in use; stop. Expect REFUTED (no invalid state found)."""
    import yaml
    from paperdolls import cli, packdev
    d = toy_copy()
    scene = d.parent / "scene.json"
    scene.write_text(json.dumps({"buildings": [{"id": "w1", "footprint": [[0, 0], [5, 0], [5, 5]], "levels": 2, "archetype": "villa", "state": "none", "investor": False, "area": 12, "residential": "residential"}], "roads": [], "landuse": [], "trees": []}))
    st = packdev.DevState(d, scene)
    srv = packdev.DevServer(st, 0).start()
    log = []
    try:
        base = srv.url
        v0 = json.loads(get(base + "__status")[1])
        log.append(f"start ok={v0['ok']} v={v0['version']}")
        socks = []
        for _ in range(2):                                                    # two tabs
            s = socket.create_connection(("127.0.0.1", srv.server_address[1]), timeout=5)
            s.sendall(b"GET /__events HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n"); socks.append(s)
        time.sleep(0.4)
        good = (d / "pack.yaml").read_text()
        (d / "pack.yaml").write_text(good.replace("spec: 1", "spec: 2"))        # break
        time.sleep(1.0)
        v1 = json.loads(get(base + "__status")[1]); log.append(f"after break ok={v1['ok']} v={v1['version']} err={v1['errors'][:1]}")
        tmpf = d / ".pack.yaml.swp"; tmpf.write_text(good); os.replace(tmpf, d / "pack.yaml")           # editor: write temp, rename over
        time.sleep(1.0)
        v2 = json.loads(get(base + "__status")[1]); log.append(f"after atomic fix ok={v2['ok']} v={v2['version']}")
        sc = scene.read_text(); scene.write_text(sc[:40]); time.sleep(0.8)                                 # half-written scene
        v3 = json.loads(get(base + "__status")[1]); scene.write_text(sc); time.sleep(0.8)
        v4 = json.loads(get(base + "__status")[1]); log.append(f"half scene ok={v3['ok']}; completed ok={v4['ok']} v={v4['version']}")
        got = [s.recv(65536).decode().count("event: version") for s in socks]
        log.append(f"events per tab={got}")
        socks[0].close()                                                      # one tab vanishes without a goodbye
        (d / "runtime.js").write_text((d / "runtime.js").read_text() + "\n// edit\n"); time.sleep(1.0)
        v5 = json.loads(get(base + "__status")[1]); log.append(f"after tab closed ok={v5['ok']} v={v5['version']}")
        busy = socket.socket(); busy.bind(("127.0.0.1", 0)); busy.listen(1)
        try:
            cli.main(["pack", "dev", str(d), "--port", str(busy.getsockname()[1])]); log.append("port in use: NO ERROR")
        except SystemExit as e:
            log.append(f"port in use -> SystemExit('{str(e)[:50]}')")
        busy.close()
        invalid = not (v0["ok"] and v2["ok"] and v4["ok"] and v5["ok"] and not v1["ok"] and not v3["ok"] and all(g >= 1 for g in got) and v5["version"] > v4["version"] > v2["version"] > v1["version"] > v0["version"])
    finally:
        t0 = time.time(); srv.stop(); log.append(f"stop took {time.time() - t0:.2f}s")
    return invalid, "; ".join(log)


@repro("T21")
def t21_dev_reload_storm_cost():
    """Each saved change (even a `touch`) rebuilds the full page under one lock and bumps the version, so every connected tab reloads. 20 saves in 2 s with the toy pack: count builds and versions. Information, not a defect by itself."""
    from paperdolls import packdev
    d = toy_copy()
    st = packdev.DevState(d)
    srv = packdev.DevServer(st, 0).start()
    try:
        v0 = st.version
        t0 = time.time()
        for i in range(20):
            (d / "runtime.js").write_text((d / "runtime.js").read_text() + f"\n// {i}\n"); time.sleep(0.1)
        time.sleep(0.8)
        return False, f"20 saves in {time.time() - t0:.1f}s -> {st.version - v0} rebuilds (watcher polls every {packdev.POLL_S}s, coalescing saves inside one tick); final ok={st.ok}"
    finally:
        srv.stop()


# ---------------------------------------------------------------- export / npz

@repro("T22")
def t22_export_out_without_npz_suffix_writes_a_different_file():
    """np.savez_compressed appends .npz when the path lacks it. cmd_export prints `wrote <out>` with the name the user gave; that file does not exist, and `frames`/`build`/`replay` given that name fail."""
    d = tmp()
    spec = d / "render.yaml"
    import yaml
    spec.write_text(yaml.safe_dump({"name": "t", "model": {"path": str(ROOT / "tests" / "toy_model.py"), "params": {"n": 12, "run_time": 6}}, "replay": {"weeks": [0, 5], "palettes": ["ce"]}}))
    rc, out, err = run_cli("export", str(spec), "--out", str(d / "traj"))
    exists = (d / "traj").exists()
    rc2, out2, err2 = run_cli("frames", str(spec), str(d / "traj"), "--out", str(d / "f"))
    return (rc == 0 and not exists and rc2 != 0), f"export exit={rc} printed '{out.strip()}'; file 'traj' exists={exists}; files={sorted(p.name for p in d.iterdir())}; next command exit={rc2}: {tail(err2, 1)[:100]}"


# ---------------------------------------------------------------- intake / spec

def intake_init(d):
    from paperdolls.intake import Intake
    p = d / "render.yaml"
    Intake.init(p)
    return p


@repro("T23")
def t23_intake_two_writers_lose_an_update():
    """Intake loads the file in __init__ and rewrites the whole file in save(); there is no lock and no merge. Two `intake answer` commands that overlap (a model issuing parallel tool calls) lose one answer. Interleaving: both load, both answer, both save."""
    from paperdolls.intake import Intake
    d = tmp(); p = intake_init(d)
    a, b = Intake(p), Intake(p)
    a.answer("goal", "model_replay")
    b.answer("name", "my project")                  # b loaded before a saved
    final = Intake(p)
    return (final.value("goal") is None and final.value("name") == "my project"), f"after both answers: goal={final.value('goal')!r} name={final.value('name')!r} (a's answer is gone; both commands printed OK)"


@repro("T24")
def t24_intake_half_written_file():
    """render.yaml written with write_text: a kill mid-write leaves a prefix. (a) truncated inside a flow sequence -> yaml.YAMLError, uncaught by cmd_intake (catches IntakeError). (b) truncated to empty -> the interview silently starts again with no answers."""
    from paperdolls.intake import Intake
    d = tmp(); p = intake_init(d)
    for q, v in (("goal", "model_replay"), ("name", "alpha")):
        Intake(p).answer(q, v)
    full = p.read_text()
    p.write_text(full + "replay: {weeks: [0, 26,")                      # (a) the write stopped here
    rc, out, err = run_cli("intake", "next", str(p))
    a_trace = "YAMLError" in err or "ParserError" in err or "ScannerError" in err
    p.write_text("")                                                    # (b)
    rc2, out2, err2 = run_cli("intake", "next", str(p), "--json")
    st = json.loads(out2) if out2.strip().startswith("{") else {}
    return (a_trace and st.get("progress", {}).get("answered") == 0), f"(a) exit={rc} {tail(err, 1)[:100]}; (b) exit={rc2} status={st.get('status')} progress={st.get('progress')} (earlier answers: goal, name)"


@repro("T25")
def t25_intake_goal_flip_leaves_stale_meta():
    """Changing goal deletes the other branch's answers but not the bookkeeping in `intake:` (defaults, override_keys, overrides_answered). After flipping to place_scene and back, the kv question (model.params.overrides) counts as answered although model.params was rebuilt."""
    from paperdolls.intake import Intake
    d = tmp(); p = intake_init(d)
    it = Intake(p)
    it.answer("goal", "model_replay"); it.answer("name", "xyz")
    it.answer("model.source", "vendored")
    it.answer("model.params.overrides", "none")
    meta1 = dict(Intake(p).meta)
    Intake(p).answer("goal", "place_scene")
    Intake(p).answer("goal", "model_replay")
    it2 = Intake(p)
    it2.answer("model.source", "vendored")
    meta2 = it2.meta
    st = {r["id"]: r["state"] for r in it2.status()}
    stale = meta2.get("overrides_answered") is True and st.get("model.params.overrides") == "answered"
    return stale, f"overrides_answered after goal flip and a new model.source answer={meta2.get('overrides_answered')}; question state={st.get('model.params.overrides')}; model.params has {len(it2.value('model.params') or {})} keys, rebuilt from the preset"


@repro("T26")
def t26_intake_confirmation_cannot_go_stale():
    """Expect REFUTED. (1) an answer after confirmation withdraws it; (2) a hand edit of render.yaml after `show` invalidates it; (3) `confirmed yes` before `show` is refused; (4) answering twice is accepted and idempotent."""
    from paperdolls.intake import Intake, IntakeError
    d = tmp(); p = d / "render.yaml"
    import yaml, shutil
    shutil.copy(ROOT / "assets" / "demo_render.yaml", p)
    it = Intake(p)
    notes = []
    try:
        it.answer("confirmed", "yes"); notes.append("(3) NOT refused")
    except IntakeError:
        notes.append("(3) refused")
    # drive to completion with defaults: next() until it stops asking
    for _ in range(40):
        r = Intake(p).next()
        if r["status"] != "ask":
            break
        q = r["question"]
        Intake(p).answer(q["id"], q.get("suggested") if q.get("suggested") is not None else (q["options"][0]["value"] if q.get("options") else "1"))
    notes.append(f"status before show={Intake(p).next()['status']}")
    try:
        Intake(p).show(); Intake(p).answer("confirmed", "yes")
        notes.append(f"confirmed={Intake(p).confirmed}")
        Intake(p).answer("name", "renamed"); notes.append(f"(1) after a new answer confirmed={Intake(p).confirmed}")
        Intake(p).answer("name", "renamed"); notes.append("(4) same answer twice ok")
        Intake(p).show(); Intake(p).answer("confirmed", "yes")
        data = yaml.safe_load(p.read_text()); data["name"] = "edited by hand"; p.write_text(yaml.safe_dump(data, sort_keys=False))
        notes.append(f"(2) after hand edit confirmed={Intake(p).confirmed}")
    except IntakeError as e:
        notes.append(f"stopped: {e}")
    stale = any(n.startswith("(1)") and "True" in n for n in notes) or any(n.startswith("(2)") and "True" in n for n in notes)
    return stale or "(3) NOT refused" in notes, "; ".join(notes)


@repro("T27")
def t27_spec_bad_numbers_are_a_traceback_not_a_specerror():
    """validate() does int(params['n']); a string or null gives ValueError/TypeError, but cmd_validate/_replay_spec catch SpecError only."""
    d = tmp()
    import yaml
    res = []
    for n in ("abc", None, [1]):
        (d / "render.yaml").write_text(yaml.safe_dump({"name": "t", "model": {"params": {"n": n, "run_time": 6}}, "replay": {"weeks": [0], "palettes": ["ce"]}}))
        rc, out, err = run_cli("validate", str(d / "render.yaml"))
        res.append(f"n={n!r}: exit={rc} {tail(err, 1)[:70]}")
    return all(("ValueError" in r or "TypeError" in r) for r in res), "; ".join(res)


# ---------------------------------------------------------------- validators

@repro("T28")
def t28_python_validator_crashes_where_the_js_validator_reports():
    """pack.validate() raises TypeError (str.join on a non-string) for two kinds of already-invalid manifest that viz/packvalidate.js reports as ordinary errors: (a) a category field whose values hold a non-string while a scale.values key is not among them; (b) a param whose group is not a string while a layout group names a missing group. `pack check`/`pack build` then print a traceback; only `pack dev` wraps it."""
    import copy
    from paperdolls import pack
    base = json.loads((ROOT / "tests" / "pack_cases.json").read_text())["base"]
    a = copy.deepcopy(base)
    a["entities"]["thing"]["fields"]["kind"]["values"] = ["a", 1.5]
    a["mappings"][0]["scale"]["values"]["zzz"] = {"label": "Z", "colour": "#aa0000"}
    b = copy.deepcopy(base)
    b["params"]["rate"]["group"] = 5
    b["layout"]["left"][0]["groups"] = ["A", "nope"] if "layout" in b and b["layout"].get("left") else None
    res = []
    for name, m in (("a", a), ("b", b)):
        try:
            pack.validate(m); res.append(f"{name}: no crash")
        except Exception as e:
            res.append(f"{name}: {type(e).__name__}: {e}")
    d = toy_copy()
    import yaml
    t = yaml.safe_load((d / "pack.yaml").read_text())
    t["entities"]["building"]["fields"]["state"]["values"].append(1.5)
    t["mappings"][0]["scale"]["values"]["zzz"] = {"label": "Z", "colour": "#aa0000"}
    (d / "pack.yaml").write_text(yaml.safe_dump(t, sort_keys=False))
    rc, out, err = run_cli("pack", "check", str(d), "--manifest-only")
    res.append(f"cli pack check: exit={rc} {tail(err, 1)[:80]}")
    return any("TypeError" in r for r in res), "; ".join(res)


@repro("T29")
def t29_osm_query_with_relation_and_bbox_drops_the_bbox():
    """overpass_query(relation, bbox) documents "either, or both" and `osm-fetch --relation R --bbox ...` accepts both, but the query is built from the relation alone: the bbox appears nowhere in it. The user fetches the whole municipality when they asked for a sub-area."""
    from paperdolls.ingest.query import overpass_query
    q = overpass_query(relation=58258, bbox=(50.87, 4.3, 50.89, 4.35))
    return ("50.870000" not in q and "(area.a)" in q), f"bbox values in query={'50.870000' in q}; filter used={'(area.a)' in q}"


@repro("T30")
def t30_include_file_inside_the_pack_is_declared_for_undeclared_scripts_but_not_for_build():
    """`--include prng.js` is documented as the way to load a shared helper. undeclared_scripts(path, include) honours it, but check() (called by build(), packcheck.run and packdev) calls undeclared_scripts(path) without include, so a runtime that require()s an included file that sits in the pack folder fails check, build and dev with 'not inlined into the page' although --include inlines it."""
    import yaml
    from paperdolls import pack
    d = toy_copy()
    m = yaml.safe_load((d / "pack.yaml").read_text()); m["runtime"].pop("files"); (d / "pack.yaml").write_text(yaml.safe_dump(m, sort_keys=False))
    (d / "prng.js").write_text("window.PRNG = 1;")
    (d / "runtime.js").write_text((d / "runtime.js").read_text() + "\nif (typeof require === 'function') require('./prng.js');\n")
    inc = [d / "prng.js"]
    direct = pack.undeclared_scripts(d, inc)[0]
    try:
        pack.build(d, None, inc); built = "built"
    except pack.PackError as e:
        built = "build refused: " + str(e)[:110]
    return (direct == [] and built != "built"), f"undeclared_scripts(include)={direct}; {built}"


def main(argv):
    want = [a.upper() for a in argv] or sorted(REPROS)
    verdict = {}
    for tid in want:
        fn = REPROS.get(tid)
        if not fn:
            print(f"{tid}: unknown"); continue
        try:
            hit, ev = fn()
        except Exception:
            hit, ev = None, "repro itself failed:\n" + traceback.format_exc()
        verdict[tid] = hit
        print(f"{tid} {'REPRODUCED' if hit else 'REFUTED' if hit is False else 'ERROR'}: {fn.__doc__.strip().splitlines()[0][:110]}\n      evidence: {ev}")
    return 0 if None not in verdict.values() else 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
