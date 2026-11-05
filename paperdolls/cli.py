"""Command-line entry points. Every stage is runnable without Claude."""
import argparse, importlib, json, sys, tempfile
from pathlib import Path


class _Lazy:
    """A module imported on first use. `paperdolls doctor` must run, and say what to install, on a machine that has none of
    numpy, pillow or pyyaml, so nothing that needs them may load when this file does."""
    def __init__(self, name):
        self._name, self._mod = name, None

    def __getattr__(self, attr):
        if self._mod is None:
            self._mod = importlib.import_module(self._name, __package__)
        return getattr(self._mod, attr)


specmod, export, checks, model_loader = _Lazy(".spec"), _Lazy(".export"), _Lazy(".checks"), _Lazy(".model_loader")
palettes, block, facades = _Lazy(".render.palettes"), _Lazy(".render.block"), _Lazy(".render.facades")

def _params(sp):
    return dict(sp["model"]["params"])

def _model_path(sp, spec_path):
    """Resolve model.path relative to the spec file, not the working directory."""
    p = sp["model"].get("path")
    if not p:
        return None
    q = Path(p)
    return q if q.is_absolute() else (Path(spec_path).resolve().parent / q)

def _replay_spec(a):
    """Load a model-replay project and stop unless the user confirmed the decisions it records."""
    try:
        sp = specmod.load(a.spec, goal="model_replay")
        specmod.require_confirmed(a.spec)
    except specmod.SpecError as e:
        raise SystemExit(f"cannot continue: {e}")
    return sp

def cmd_validate(a):
    try:
        sp = specmod.load(a.spec)
    except specmod.SpecError as e:
        raise SystemExit(f"invalid: {e}")
    print(f"OK: {sp['name']} ({specmod.goal_of(sp)})")

def cmd_export(a):
    sp = _replay_spec(a)
    out = Path(a.out or Path(a.spec).with_name("trajectory.npz"))
    export.run_and_export(_params(sp), out, _model_path(sp, a.spec))
    print(f"wrote {out}")

def cmd_check(a):
    sp = _replay_spec(a)
    p = _params(sp); n = int(p["n"])
    tmp = Path(tempfile.mkdtemp())
    results = []
    mp = _model_path(sp, a.spec)
    results.append(checks.determinism(p, tmp/"a.npz", tmp/"b.npz", mp))
    results.append(checks.hook_is_read_only(p, mp))
    export.run_and_export(p, tmp/"a.npz", mp)
    traj = export.load(tmp/"a.npz")
    results.append(checks.one_state_per_building(traj, n))
    results.append(checks.model_totals_reconcile(traj, n))
    results.append(checks.palette_schema(palettes.load_families()))
    mod = model_loader.load(mp)
    try:
        res = mod.run_simulation(mod.Params(**p))
    except TypeError as e:
        raise SystemExit(f"model.params does not match the model: {e}")
    results.append(checks.completions_bounded(traj, int(res.finished)))
    failed = False
    for ok, msg in results:
        print(("PASS " if ok else "WARN ") + msg)
        failed = failed or (not ok and msg.startswith(("DETERMINISM", "HOOK", "every")))
    sys.exit(1 if failed else 0)

def cmd_frames(a):
    sp = _replay_spec(a)
    traj = export.load(a.trajectory)
    fams = palettes.load_families()
    n = int(_params(sp)["n"])
    L = block.Layout(n); R = block.Renderer(L, seed=int(_params(sp).get("seed", 0)))
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    for pid in sp["replay"]["palettes"]:
        facades.clear_cache()
        for reg in sp["replay"]["registers"]:
            for w in sp["replay"]["weeks"]:
                codes = export.codes_for_week(traj, w)
                inv = export.codes_for_week(traj, w, "investor")
                img = R.frame(fams[pid], reg, codes, f"Week {w}", investor=inv, legend=specmod.legend_for(sp), extras=specmod.retrofit_extras(sp))
                img.save(out / f"{pid}_{reg}_w{w}.png")
    print(f"wrote frames to {out}")

def cmd_build(a):
    sp = _replay_spec(a)
    traj = export.load(a.trajectory)
    fams = palettes.load_families()
    n = int(_params(sp)["n"])
    from .render.html import build_page
    L = block.Layout(n); R = block.Renderer(L, seed=int(_params(sp).get("seed", 0)))
    html = build_page(sp, traj, fams, L, R, export.codes_for_week)
    Path(a.out).write_text(html, encoding="utf-8")
    print(f"wrote {a.out} ({Path(a.out).stat().st_size // 1024} KB)")


def _slug(text):
    import re
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-") or "project"

def cmd_doctor(a):
    """Check that the plugin can run here, and say how to fix what cannot."""
    import importlib, shutil, subprocess
    root = Path(__file__).resolve().parents[1]
    rows = []
    def add(level, what, detail, fix=""):
        rows.append({"level": level, "check": what, "detail": detail, "fix": fix})
    py = sys.version_info
    add("pass" if py >= (3, 10) else "fail", "Python 3.10 or newer", f"found {py.major}.{py.minor}.{py.micro}", "Install Python 3.10 or newer.")
    missing = []
    for mod, pkg in (("numpy", "numpy"), ("PIL", "pillow"), ("yaml", "pyyaml")):
        try:
            importlib.import_module(mod)
        except ImportError:
            missing.append(pkg)
    add("fail" if missing else "pass", "Python packages", ("missing: " + ", ".join(missing)) if missing else "numpy, pillow and pyyaml are installed",
        f'python3 -m pip install -r "{root / "requirements.txt"}"  (ask the user before installing)')
    try:
        if missing:
            add("warn", "Palettes", "not checked until the Python packages are installed", "Install the packages above, then run doctor again.")
        else:
            ok, msg = checks.palette_schema(palettes.load_families())
            add("pass" if ok else "fail", "Palettes", msg, "Restore assets/palettes.json from the repository.")
    except Exception as e:
        add("fail", "Palettes", f"could not read assets/palettes.json: {e}", "Restore assets/palettes.json from the repository.")
    have_model = model_loader.VENDOR.exists()
    add("pass" if have_model else "warn", "Great Retrofit model", "present" if have_model else "not installed. Model replays of that model need it; place scenes do not.",
        "Add vendor/greatretrofit_v2/model.py once the model's licence is confirmed (see vendor/greatretrofit_v2/NOTICE.md), or point model.path at another model file.")
    add("pass" if (root / "viz" / "viewer.html").exists() else "fail", "Viewer templates", "found" if (root / "viz" / "viewer.html").exists() else "viz/viewer.html is missing", "Restore the viz folder from the repository.")
    node = shutil.which("node")
    add("pass" if node else "warn", "Node.js (optional)", "found" if node else "not found. Only the JavaScript tests need it; the viewer runs in any browser.", "Install Node.js 18 or newer to run the viewer tests.")
    bad = [r for r in rows if r["level"] == "fail"]
    if a.json:
        print(json.dumps({"ok": not bad, "checks": rows}, indent=1))
    else:
        mark = {"pass": "PASS", "warn": "WARN", "fail": "FAIL"}
        for r in rows:
            print(f"{mark[r['level']]}  {r['check']}: {r['detail']}")
            if r["level"] != "pass" and r["fix"]:
                print(f"      fix: {r['fix']}")
        print("\nReady." if not bad else f"\n{len(bad)} problem(s) to fix before continuing.")
    sys.exit(1 if bad else 0)

def cmd_looks(a):
    fams = palettes.load_families()
    if a.region and a.region not in fams:
        raise SystemExit(f"unknown region '{a.region}'. Known: {', '.join(fams)}")
    sel = {a.region: fams[a.region]} if a.region else fams
    if a.json:
        print(json.dumps([{"region": k, "name": f["name"], "places": f["places"], "looks": [{"id": l["id"], "name": l["name"], "note": l["note"], "roads": l.get("surface", "asphalt"), "flowering_trees": bool(l.get("bloom"))} for l in f["looks"]]} for k, f in sel.items()], indent=1))
        return
    for k, f in sel.items():
        print(f"{k}: {f['name']} ({f['places']})")
        for l in f["looks"]:
            print(f"    {l['id']}: {l['name']}. {l['note']} Roads: {l.get('surface', 'asphalt')}.")

def cmd_intake(a):
    from .intake import Intake, IntakeError, render_docs
    try:
        if a.icmd == "docs":
            text = render_docs()
            if a.out:
                Path(a.out).write_text(text, encoding="utf-8"); print(f"wrote {a.out}")
            else:
                print(text)
            return
        if a.icmd == "init":
            Intake.init(a.file, force=a.force)
            print(f"created {a.file}. Next: paperdolls intake next {a.file}")
            return
        it = Intake(a.file)
        if not Path(a.file).exists():
            raise IntakeError(f"{a.file} does not exist. Run 'paperdolls intake init {a.file}' first.")
        if a.icmd == "next":
            r = it.next()
            if a.json:
                print(json.dumps(r, indent=1)); return
            _print_next(r, a.file)
        elif a.icmd == "answer":
            r = it.answer(a.id, a.value)
            print(f"OK: recorded {r['id']} = {r['value']}")
            print(f"NEXT: run 'paperdolls intake next {a.file}'")
        elif a.icmd == "status":
            rows = it.status()
            if a.json:
                print(json.dumps(rows, indent=1)); return
            for r in rows:
                print(f"{r['state']:9s} {r['id']:28s} {r['value'] if r['value'] is not None else ''}")
        elif a.icmd == "show":
            print(it.show())
            print(f"\nAsk the user: is this right? Then record the reply: paperdolls intake answer {a.file} confirmed yes   (or no)")
    except IntakeError as e:
        print(f"REJECTED: {e}", file=sys.stderr)
        sys.exit(3)

def _print_next(r, path):
    st = r["status"]
    prog = r.get("progress", {})
    print(f"STATUS: {st}   ({prog.get('answered', 0)} of {prog.get('of', 0)} answered)")
    if st in ("ask", "fix"):
        q = r["question"]
        if st == "fix":
            print(f"PROBLEM WITH THE STORED ANSWER: {r['problem']}")
        print(f"ID: {q['id']}\nASK: {q['ask']}\nWHY: {q['why']}\nPRESENT AS: {q['present']}")
        if q.get("options"):
            print("OPTIONS:")
            for i, o in enumerate(q["options"], 1):
                print(f"  {i}. {o['value']}: {o['label']}" + (f". {o['detail']}" if o.get("detail") else ""))
        if "suggested" in q:
            print(f"SUGGESTED: {q['suggested']}")
        if q.get("example"):
            print(f"EXAMPLE: {q['example']}")
        if q.get("note_for_model"):
            print(f"NOTE FOR YOU (do not read aloud): {q['note_for_model']}")
        print(f"RECORD WITH: paperdolls intake answer {path} {q['id']} \"<the user's answer>\"")
    elif st == "confirm":
        print(f"NEXT STEP: {r['instruction']}")
    else:
        print("All questions are answered and confirmed. Build with the skill for this goal.")

def cmd_place(a):
    from . import place as placemod
    try:
        sp = specmod.load(a.spec, goal="place_scene")
        specmod.require_confirmed(a.spec)
        r = placemod.run(a.spec, refetch=a.refetch, fetch=not a.no_fetch)
    except (specmod.SpecError, placemod.PlaceError) as e:
        raise SystemExit(f"cannot continue: {e}")
    for k, v in r.items():
        print(f"{k}: {v}")
    print("\nRead the report to the user before building the viewer." if r.get("report") else "")

def cmd_viewer(a):
    from .viewer_build import build_viewer
    from .place import output_dir
    try:
        sp = specmod.load(a.spec, goal="place_scene")
        specmod.require_confirmed(a.spec)
    except specmod.SpecError as e:
        raise SystemExit(f"cannot continue: {e}")
    out = output_dir(a.spec, sp)
    scene, sp_path = None, out / "scene.json"
    if sp["place"]["kind"] != "placeholder":
        if not sp_path.exists():
            raise SystemExit(f"cannot continue: no scene at {sp_path}. Run 'paperdolls place {a.spec}' first.")
        scene = json.loads(sp_path.read_text(encoding="utf-8"))
    look = sp["look"]
    initial = {k: v for k, v in {"region": look.get("region"), "look": look.get("look"), "reg": look.get("register"), "drive": look.get("drive")}.items() if v}
    html = build_viewer(scene, initial, title=sp["name"])
    path = out / f"{_slug(sp['name'])}-viewer.html"
    path.write_text(html, encoding="utf-8")
    print(f"wrote {path} ({path.stat().st_size // 1024} KB)")
    print("Open it in a browser. Drag or A and D pan; the wheel or W and S zoom. The Fit button shows the whole scene.")


def cmd_ingest(a):
    from .ingest import build, report as rpt
    bbox = tuple(float(x) for x in a.bbox.split(",")) if a.bbox else None
    if bbox and len(bbox) != 4:
        raise SystemExit("--bbox needs south,west,north,east")
    rot = a.rotation if a.rotation in ("auto", "none") else float(a.rotation)
    try:
        scene, rep = build.ingest(a.input, rotation=rot, bbox=bbox, boundary_relation=a.boundary_relation, name=a.name,
                                  max_buildings=a.max_buildings, scatter=not a.no_scatter, seed=a.seed)
    except (build.IngestError, ValueError) as e:
        raise SystemExit(f"ingest failed: {e}")
    out = Path(a.out)
    out.write_text(json.dumps(scene, separators=(",", ":")), encoding="utf-8")
    md = out.with_name(out.stem + "_report.md")
    md.write_text(rpt.report_markdown(scene, rep), encoding="utf-8")
    out.with_name(out.stem + "_report.json").write_text(json.dumps(rep, indent=1), encoding="utf-8")
    c = rep["counts"]
    print(f"wrote {out} ({out.stat().st_size // 1024} KB): {c['buildings']} buildings, {c['roads']} roads, {c['landuse']} landuse, {c['trees']} trees")
    print(f"frame rotated {rep['frame']['rotation_deg']} degrees; estimated asset share {round(rep['estimated_asset_share']['rotated'] * 100)}% (unrotated {round(rep['estimated_asset_share']['unrotated'] * 100)}%)")
    print(f"report: {md}")
    for w in rep["warnings"]:
        print("WARNING:", w)

def cmd_osm_query(a):
    from .ingest.query import overpass_query
    bbox = tuple(float(x) for x in a.bbox.split(",")) if a.bbox else None
    q = overpass_query(relation=a.relation, bbox=bbox)
    if a.out:
        Path(a.out).write_text(q, encoding="utf-8")
        print(f"wrote {a.out}. Run it at https://overpass-turbo.eu (Export, raw OSM data, JSON) or: curl -d @{a.out} https://overpass-api.de/api/interpreter -o extract.json")
    else:
        print(q)

def cmd_osm_fetch(a):
    from .ingest.fetch import DEFAULT_ENDPOINT, FetchError, fetch_overpass
    from .ingest.query import overpass_query
    bbox = tuple(float(x) for x in a.bbox.split(",")) if a.bbox else None
    try:
        n = fetch_overpass(overpass_query(relation=a.relation, bbox=bbox), a.out, endpoint=a.endpoint or DEFAULT_ENDPOINT)
    except (FetchError, ValueError) as e:
        raise SystemExit(f"fetch failed: {e}")
    print(f"wrote {a.out} ({n} elements). Next: paperdolls ingest {a.out}" + (f" --boundary-relation {a.relation}" if a.relation else ""))

def main(argv=None):
    ap = argparse.ArgumentParser(prog="paperdolls")
    sub = ap.add_subparsers(required=True)
    s = sub.add_parser("validate"); s.add_argument("spec"); s.set_defaults(f=cmd_validate)
    s = sub.add_parser("export"); s.add_argument("spec"); s.add_argument("--out"); s.set_defaults(f=cmd_export)
    s = sub.add_parser("check"); s.add_argument("spec"); s.set_defaults(f=cmd_check)
    s = sub.add_parser("frames"); s.add_argument("spec"); s.add_argument("trajectory"); s.add_argument("--out", default="frames"); s.set_defaults(f=cmd_frames)
    s = sub.add_parser("build"); s.add_argument("spec"); s.add_argument("trajectory"); s.add_argument("--out", default="replay.html"); s.set_defaults(f=cmd_build)
    s = sub.add_parser("ingest", help="OSM extract (Overpass JSON, OSM XML, GeoJSON) to a scene file and a report")
    s.add_argument("input"); s.add_argument("--out", default="scene.json"); s.add_argument("--rotation", default="auto", help="auto, none, or degrees")
    s.add_argument("--bbox", help="south,west,north,east"); s.add_argument("--boundary-relation", type=int, help="clip to this boundary relation (needs rel(ID) in the extract)")
    s.add_argument("--name"); s.add_argument("--max-buildings", type=int); s.add_argument("--no-scatter", action="store_true", help="do not scatter trees into parks and woods")
    s.add_argument("--seed", type=int, default=7); s.set_defaults(f=cmd_ingest)
    s = sub.add_parser("osm-query", help="print the Overpass query for an area (the bounding-box form has run live once; the relation form has not)")
    s.add_argument("--relation", type=int); s.add_argument("--bbox", help="south,west,north,east"); s.add_argument("--out"); s.set_defaults(f=cmd_osm_query)
    s = sub.add_parser("osm-fetch", help="run the Overpass query and save the extract (needs network access; the bounding-box form worked live once)")
    s.add_argument("--relation", type=int); s.add_argument("--bbox", help="south,west,north,east"); s.add_argument("--out", default="extract.json"); s.add_argument("--endpoint")
    s.set_defaults(f=cmd_osm_fetch)
    s = sub.add_parser("doctor", help="check that the plugin can run here"); s.add_argument("--json", action="store_true"); s.set_defaults(f=cmd_doctor)
    s = sub.add_parser("looks", help="list the regions and their looks"); s.add_argument("--region"); s.add_argument("--json", action="store_true"); s.set_defaults(f=cmd_looks)
    s = sub.add_parser("intake", help="the structured interview that fills in render.yaml"); isub = s.add_subparsers(dest="icmd", required=True)
    i = isub.add_parser("init"); i.add_argument("file"); i.add_argument("--force", action="store_true")
    i = isub.add_parser("next"); i.add_argument("file"); i.add_argument("--json", action="store_true")
    i = isub.add_parser("answer"); i.add_argument("file"); i.add_argument("id"); i.add_argument("value")
    i = isub.add_parser("status"); i.add_argument("file"); i.add_argument("--json", action="store_true")
    i = isub.add_parser("show"); i.add_argument("file")
    i = isub.add_parser("docs"); i.add_argument("--out")
    s.set_defaults(f=cmd_intake)
    s = sub.add_parser("place", help="get the OSM extract, ingest it, and write the scene and its report (place_scene projects)")
    s.add_argument("spec"); s.add_argument("--refetch", action="store_true"); s.add_argument("--no-fetch", action="store_true"); s.set_defaults(f=cmd_place)
    s = sub.add_parser("viewer", help="write a one-file viewer page for the project's place"); s.add_argument("spec"); s.set_defaults(f=cmd_viewer)
    a = ap.parse_args(argv)
    a.f(a)

if __name__ == "__main__":
    main()
