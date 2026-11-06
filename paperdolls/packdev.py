"""`paperdolls pack dev`: a local development server for a model pack. Standard library only, bound to 127.0.0.1.

GET /            the pack page, built from the files on disk (cached until one of them changes), with a small reload client added
GET /__events    server-sent events: "version" whenever pack.yaml, a runtime file (runtime.files, or runtime.js and bind.js), the scene or an --include file changed
GET /__status    JSON: {version, ok, errors, warnings, bytes}; the client polls this when EventSource is not available

A pack that does not validate, or a runtime that cannot be inlined, is shown as a page listing the problems, not as a blank screen, and it
reloads itself when the file is fixed. The reload client keeps the parameters and the time across a reload (sessionStorage) so a slider
setting survives an edit of runtime.js.
"""
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from . import pack as packmod

HOST = "127.0.0.1"
POLL_S = 0.25

CLIENT = r"""<script>
(function () {
  var KEY = 'pd-dev-state:' + location.pathname, version = %VERSION%;
  function save() { try { var p = window.labPack; if (p) sessionStorage.setItem(KEY, JSON.stringify({ params: p.store.params(), t: p.store.time().t })); } catch (e) {} }
  function restore() {
    try {
      var s = JSON.parse(sessionStorage.getItem(KEY) || 'null'), p = window.labPack; if (!s || !p) return;
      p.store.setParams(s.params);                      // all or nothing: a parameter that no longer exists leaves the defaults
      setTimeout(function () { try { p.store.setTime(s.t); } catch (e) {} }, 400);
    } catch (e) {}
  }
  window.addEventListener('load', function () { setTimeout(restore, 50); });
  function changed(v) { if (v !== version) { save(); location.reload(); } }
  function poll() {
    fetch('/__status', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (s) { changed(s.version); }).catch(function () {}).then(function () { setTimeout(poll, 700); });
  }
  if (window.EventSource) {
    var es = new EventSource('/__events');
    es.addEventListener('version', function (e) { changed(JSON.parse(e.data).version); });
    es.onerror = function () { /* the server restarted or stopped: EventSource retries by itself */ };
  } else poll();
  var warn = %WARNINGS%;
  if (warn.length) {
    var b = document.createElement('div');
    b.style.cssText = 'position:fixed;right:8px;bottom:8px;z-index:99;font:12px system-ui;background:#fff8e1;border:1px solid #e0b84c;border-radius:6px;padding:4px 8px;max-width:420px;cursor:pointer';
    b.textContent = 'dev: ' + warn.length + ' warning(s) (click)';
    b.onclick = function () { b.textContent = warn.join('\n'); b.style.whiteSpace = 'pre-wrap'; };
    document.addEventListener('DOMContentLoaded', function () { document.body.appendChild(b); });
  }
})();
</script>"""

ERROR_PAGE = """<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Pack problem</title>
<style>body{font:15px/1.5 system-ui,sans-serif;margin:0;background:#f4f1ea;color:#231e16}main{max-width:900px;margin:0 auto;padding:24px 18px}
h1{font-size:20px;margin:0 0 4px}.sub{color:#5d5950;margin:0 0 16px}ul{padding-left:20px}li{margin:4px 0;font-family:ui-monospace,monospace;font-size:13px;white-space:pre-wrap}
.err li{color:#a2191f}.warn li{color:#7a5b00}</style></head><body><main>
<h1>This pack cannot be shown yet</h1><p class="sub">%PATH% &middot; fix the file and save: this page reloads by itself.</p>
%BODY%</main>%CLIENT%</body></html>"""


def _esc(s):
    return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


class DevState:
    """The built page for the pack on disk, rebuilt (once) when a watched file changes."""

    def __init__(self, path, scene_path=None, include=(), max_bytes=packmod.DEFAULT_MAX_BYTES, trim=()):
        self.path, self.scene_path, self.include, self.max_bytes, self.trim = Path(path), Path(scene_path) if scene_path else None, tuple(include), max_bytes, tuple(trim)
        self._lock = threading.Lock()
        self.cond = threading.Condition()
        self.version = 0
        self.html = ""
        self.ok = False
        self.errors, self.warnings = [], []
        self._sig = None
        self._scene = None
        self._scene_sig = None
        self.refresh(force=True)

    def _signature(self):
        sig = []
        try:
            files = packmod.watched_files(self.path, self.include, self.scene_path)
        except Exception:                                   # a manifest that does not parse: watch the manifest alone
            files = [packmod.manifest_path(self.path)] + ([Path(self.scene_path)] if self.scene_path else [])
        for f in files:
            try:
                st = f.stat()
                sig.append((str(f), st.st_mtime_ns, st.st_size))
            except OSError:
                sig.append((str(f), None, None))
        return tuple(sig)

    def refresh(self, force=False):
        """Rebuild if a watched file changed. Returns True when the page changed."""
        with self._lock:
            return self._refresh(force)

    def _refresh(self, force):
        sig = self._signature()
        if not force and sig == self._sig:
            return False
        self._sig = sig
        errors, warnings, html = [], [], ""
        try:
            scene = None
            if self.scene_path:
                scene_sig = [s for s in sig if s[0] == str(self.scene_path)]
                if self._scene is None or scene_sig != self._scene_sig:
                    self._scene, self._scene_sig = packmod.load_scene(self.scene_path), scene_sig
                scene = self._scene
            errors, warnings = packmod.check(self.path)
            if not errors:
                html, info = packmod.build(self.path, scene, self.include, self.max_bytes, self.trim)
                if info["trimmed"]:
                    warnings.append("scene trimmed to fit: " + "; ".join(t["lost"] for t in info["trimmed"]))
        except packmod.PackError as e:
            errors = errors + [str(e)] if str(e) not in errors else errors
        except Exception as e:                              # never let a bad edit stop the server
            errors = errors + [f"{type(e).__name__}: {e}"]
        with self.cond:
            self.errors, self.warnings, self.ok = errors, warnings, bool(html) and not errors
            self.html = self._inject(html, warnings) if self.ok else self._error_page(errors, warnings)
            self.version += 1
            self.cond.notify_all()
        return True

    def _client(self, warnings):
        # the version this page will have, so a rebuild between the fetch and the event stream opening is not missed
        return CLIENT.replace("%VERSION%", str(self.version + 1)).replace("%WARNINGS%", json.dumps(warnings).replace("</", "<\\/"))

    def _inject(self, html, warnings):
        i = html.rfind("</body>")
        c = self._client(warnings)
        return html[:i] + c + html[i:] if i >= 0 else html + c

    def _error_page(self, errors, warnings):
        body = "<ul class=\"err\">" + "".join(f"<li>{_esc(e)}</li>" for e in errors) + "</ul>"
        if warnings:
            body += "<h2>Warnings</h2><ul class=\"warn\">" + "".join(f"<li>{_esc(w)}</li>" for w in warnings) + "</ul>"
        return ERROR_PAGE.replace("%PATH%", _esc(str(self.path))).replace("%BODY%", body).replace("%CLIENT%", self._client([]))

    def status(self):
        return {"version": self.version, "ok": self.ok, "errors": self.errors, "warnings": self.warnings, "bytes": len(self.html.encode("utf-8"))}


class _Handler(BaseHTTPRequestHandler):
    server_version = "paperdolls-dev"

    def log_message(self, fmt, *args):
        if self.server.verbose:
            print("  " + fmt % args)

    def _host_ok(self):
        # refuse a page requested under another name (DNS rebinding): only the loopback names are served
        host = (self.headers.get("Host") or "").rsplit(":", 1)[0].strip("[]").lower()
        return host in ("127.0.0.1", "localhost", "::1")

    def _send(self, code, body, ctype):
        data = body.encode("utf-8") if isinstance(body, str) else body
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if not self._host_ok():
            return self._send(403, "forbidden", "text/plain")
        st = self.server.state
        route = self.path.split("?", 1)[0]
        if route in ("/", "/index.html"):
            st.refresh()
            return self._send(200, st.html, "text/html; charset=utf-8")
        if route == "/__status":
            st.refresh()
            return self._send(200, json.dumps(st.status()), "application/json")
        if route == "/__events":
            return self._events(st)
        self._send(404, "not found", "text/plain")

    def _events(self, st):
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "keep-alive")
        self.end_headers()
        seen = None
        try:
            while not self.server.stopping.is_set():
                with st.cond:
                    if seen is not None and st.version == seen:
                        st.cond.wait(timeout=15)
                    v = st.version
                if v != seen:
                    self.wfile.write(f"event: version\ndata: {json.dumps({'version': v})}\n\n".encode())
                else:
                    self.wfile.write(b": keep-alive\n\n")
                self.wfile.flush()
                seen = v
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass


class DevServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, state, port=8765, verbose=False):
        super().__init__((HOST, port), _Handler)
        self.state, self.verbose = state, verbose
        self.stopping = threading.Event()
        self._watcher = threading.Thread(target=self._watch, daemon=True)

    @property
    def url(self):
        return f"http://{HOST}:{self.server_address[1]}/"

    def _watch(self):
        while not self.stopping.wait(POLL_S):
            try:
                if self.state.refresh() and self.verbose:
                    s = self.state
                    print(("rebuilt: ok" if s.ok else "rebuilt: " + str(len(s.errors)) + " error(s)") + (f" ({s.errors[0]})" if s.errors else ""))
            except Exception as e:
                print(f"watcher: {e}")

    def start(self):
        """Serve in background threads (for tests and embedding). Returns self."""
        self._watcher.start()
        threading.Thread(target=self.serve_forever, kwargs={"poll_interval": 0.1}, daemon=True).start()
        return self

    def stop(self):
        self.stopping.set()
        with self.state.cond:
            self.state.cond.notify_all()
        self.shutdown()
        self.server_close()


def serve(path, scene_path=None, port=8765, include=(), max_bytes=packmod.DEFAULT_MAX_BYTES, trim=(), verbose=True):
    """Run until interrupted. Returns nothing."""
    state = DevState(path, scene_path, include, max_bytes, trim)
    srv = DevServer(state, port, verbose)
    print(f"pack dev: {path}" + (f" with scene {scene_path}" if scene_path else "") + f"\n  open {srv.url}\n  watching: " + ", ".join(Path(f).name for f in packmod.watched_files(path, include, scene_path)) + "\n  Ctrl-C to stop")
    if not state.ok:
        print(f"  the pack does not build yet: {state.errors[0]}")
    srv._watcher.start()
    try:
        srv.serve_forever(poll_interval=0.1)
    except KeyboardInterrupt:
        pass
    finally:
        srv.stopping.set()
        with state.cond:
            state.cond.notify_all()
        srv.server_close()
