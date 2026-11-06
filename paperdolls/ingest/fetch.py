"""Fetch an extract from an Overpass endpoint. Standard library only.

Run against the live Overpass service twice and it worked: a bounding-box query (2026-11-05) and a whole-municipality relation query (Jette, 2026-11-06: 20,249 elements,
14 MB, 56 s). It was otherwise tested against a local stand-in server (request format, headers, error handling). If the live service answers in a way this does not expect,
the raw response is kept so the failure can be read."""
import json
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

DEFAULT_ENDPOINT = "https://overpass-api.de/api/interpreter"
USER_AGENT = "paperdolls/0.5 (OSM ingest; https://github.com/scifieconomicslab)"


class FetchError(RuntimeError):
    pass


def fetch_overpass(query, out_path, endpoint=DEFAULT_ENDPOINT, timeout=360):
    """POST the query, check the answer is a usable extract, write it to out_path. Returns the number of elements."""
    body = urllib.parse.urlencode({"data": query}).encode("utf-8")
    req = urllib.request.Request(endpoint, data=body, headers={"User-Agent": USER_AGENT, "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read()
    except urllib.error.HTTPError as e:
        hint = {429: "the server is rate limiting: wait a minute and try again, or use another endpoint", 504: "the query timed out on the server: use a smaller area or --bbox",
                400: "the server rejected the query: check it with 'paperdolls osm-query' and report the message"}.get(e.code, "")
        raise FetchError(f"Overpass answered HTTP {e.code} {e.reason}. {hint}".strip())
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise FetchError(f"could not reach {endpoint}: {getattr(e, 'reason', e)}. Run the query yourself at overpass-turbo.eu and pass the exported file to 'ingest'.")
    p = Path(out_path)
    try:
        data = json.loads(raw)
    except ValueError:
        p.with_suffix(p.suffix + ".raw").write_bytes(raw)
        raise FetchError(f"the answer was not JSON (kept as {p.name}.raw). It is usually an error page: " + raw[:200].decode("utf-8", "replace").strip())
    remark = data.get("remark", "")
    if "error" in remark.lower():
        raise FetchError(f"Overpass reported: {remark}. Use a smaller area or --bbox.")
    els = data.get("elements")
    if not els:
        raise FetchError("the query returned no elements. Check the relation id or the bounding box.")
    p.write_bytes(raw)
    return len(els)
