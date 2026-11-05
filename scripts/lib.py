"""Shared helpers for the data pipeline. Run scripts with: python -I -X utf8 scripts/<name>.py"""
import hashlib
import json
import math
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
RAW = DATA / "raw"
RAW.mkdir(parents=True, exist_ok=True)

UA = {"User-Agent": "istanbul-explorer-dev/0.1 (private family trip app)"}
OVERPASS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]

# Bounding box around data/study_area.geojson (S, W, N, E); that polygon is the real limit (built by 00_study_area.py).
BBOX = (40.94, 28.90, 41.27, 29.22)


def _cache_path(prefix, key):
    return RAW / f"{prefix}_{hashlib.sha1(key.encode()).hexdigest()[:12]}.json"


def http_json(url, data=None, headers=None, timeout=90, cache=None, retries=3):
    """GET/POST JSON with retries; caches the raw response under data/raw/ when `cache` is a prefix."""
    key = url + ("?" + data if data else "")
    if cache:
        p = _cache_path(cache, key)
        if p.exists():
            return json.loads(p.read_text(encoding="utf-8"))
    h = dict(UA, **(headers or {}))
    last = None
    for i in range(retries):
        try:
            req = urllib.request.Request(url, data=data.encode() if data else None, headers=h)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                out = json.loads(r.read().decode("utf-8"))
            if cache:
                p.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
            return out
        except urllib.error.HTTPError as e:
            last = e
            if e.code == 429:  # rate limited: honour Retry-After, else back off hard
                wait = int(e.headers.get("Retry-After") or 0) or 20 * (i + 1)
                print(f"  rate limited, waiting {wait}s")
                time.sleep(wait)
            elif e.code == 404:
                break
            else:
                time.sleep(3 * (i + 1))
        except Exception as e:  # noqa: BLE001 - report and retry
            last = e
            time.sleep(3 * (i + 1))
    raise RuntimeError(f"failed: {url} ({last})")


def overpass(query, cache="osm"):
    """Cache is keyed on the query text only, so any mirror's earlier answer is reused without network."""
    body = urllib.parse.urlencode({"data": query})
    for ep in OVERPASS:  # legacy per-endpoint cache files
        p = _cache_path(cache, ep + "?" + body)
        if p.exists():
            return json.loads(p.read_text(encoding="utf-8"))
    p = _cache_path(cache + "q", query)
    if p.exists():
        return json.loads(p.read_text(encoding="utf-8"))
    last = None
    for ep in OVERPASS:
        try:
            out = http_json(ep, data=body, retries=2)
            p.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
            return out
        except RuntimeError as e:
            last = e
            print("  overpass endpoint failed, trying next:", ep)
    raise RuntimeError(last)


def admin_query(level, bbox=None):
    s, w, n, e = bbox or BBOX
    return f'[out:json][timeout:180];rel({s},{w},{n},{e})["boundary"="administrative"]["admin_level"="{level}"];out geom;'


def sparql(query, cache="wd"):
    url = "https://query.wikidata.org/sparql?" + urllib.parse.urlencode({"query": query, "format": "json"})
    return http_json(url, headers={"Accept": "application/sparql-results+json"}, cache=cache)


def haversine_m(lon1, lat1, lon2, lat2):
    r = 6371008.8
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def write_geojson(path, features):
    fc = {"type": "FeatureCollection", "features": features}
    Path(path).write_text(json.dumps(fc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return path


def round_coords(geom, nd=6):
    def r(c):
        return [round(c[0], nd), round(c[1], nd)] if isinstance(c[0], (int, float)) else [r(x) for x in c]
    return {"type": geom["type"], "coordinates": r(geom["coordinates"])}
