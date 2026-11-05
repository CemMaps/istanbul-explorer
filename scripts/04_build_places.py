"""Build app-ready data from the working candidates (provisional until Phase 2 QA):
  data/places.geojson  – schema per CLAUDE.md (blurb = Wikidata description placeholder until written)
  data/shores.geojson  – Europe / Asia land inside the study area (for the "You're on the … side" badge)
  data/fixed.geojson   – the flat and SAW airport"""
import json
import re
import unicodedata
from collections import Counter

from shapely.geometry import Point, mapping, shape
from shapely.ops import unary_union

import urllib.parse

from lib import DATA, http_json, round_coords, write_geojson

ASIA = {"Üsküdar", "Kadıköy", "Beykoz", "Ataşehir", "Ümraniye"}
# Categories outside the agreed list fold into the nearest agreed one (flagged in CLAUDE.md).
FOLD = {"Fortifications": "Palaces & museums"}

study = shape(json.loads((DATA / "study_area.geojson").read_text(encoding="utf-8"))["features"][0]["geometry"])
mah = json.loads((DATA / "mahalles.geojson").read_text(encoding="utf-8"))["features"]
mah_geoms = [(shape(f["geometry"]), f["properties"]) for f in mah]
cands = [c for c in json.loads((DATA / "work" / "candidates.json").read_text(encoding="utf-8"))
         if study.contains(Point(c["lon"], c["lat"]))]

# Short English descriptions (CC0) via the Wikidata Action API, 50 ids per call
# (the SPARQL service rate-limits hard after the candidate pulls).
def entities(ids, props):
    out = {}
    for i in range(0, len(ids), 50):
        url = "https://www.wikidata.org/w/api.php?" + urllib.parse.urlencode(
            {"action": "wbgetentities", "ids": "|".join(ids[i:i + 50]), "props": props,
             "languages": "en", "format": "json"})
        out.update(http_json(url, cache="wbent", retries=5, timeout=60).get("entities", {}))
    return out


desc = {q: (e.get("descriptions", {}).get("en") or {}).get("value")
        for q, e in entities(sorted(c["qid"] for c in cands), "descriptions").items()}


def slug(s):
    s = unicodedata.normalize("NFKD", s.replace("ı", "i").replace("İ", "I"))
    s = "".join(ch for ch in s if not unicodedata.combining(ch)).lower()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")[:48]


def tier(f):
    return "must-see" if f >= 3.9 else "worth-it" if f >= 3.0 else "bonus"


feats, used = [], Counter()
for c in cands:
    pt = Point(c["lon"], c["lat"])
    m = next((p for g, p in mah_geoms if g.contains(pt)), {})
    district = m.get("district") or "?"
    base = slug(c["name"] or c["qid"])
    used[base] += 1
    pid = base if used[base] == 1 else f"{base}-{used[base]}"
    img = c.get("image")
    feats.append({
        "type": "Feature",
        "properties": {
            "id": pid, "name": c["name"] or c["name_tr"], "name_tr": c["name_tr"],
            "category": FOLD.get(c["category"], c["category"]), "tier": tier(c["fame"]), "score": c["fame"],
            "score_basis": {"sitelinks": c["sitelinks"], "pageviews_60d": c.get("pageviews_60d"),
                            "pageviews_12m": c.get("pageviews_12m")},
            "area": district, "mahalle": m.get("name"), "shore": "asia" if district in ASIA else "europe",
            "blurb": desc.get(c["qid"]), "blurb_status": "placeholder-wikidata",
            "tip": None, "indoor": None, "best_time": None,
            "photos": [{"file": img.rsplit("/", 1)[1]}] if img else [],
            "wikidata": c["qid"], "wikipedia": c["wikipedia"], "source": f"wikidata:{c['qid']}",
        },
        "geometry": {"type": "Point", "coordinates": [round(c["lon"], 6), round(c["lat"], 6)]},
    })
# Curated overrides (judgement pass), keyed by QID. Unknown QIDs are an error, not silently ignored.
overrides = {k: v for k, v in json.loads((DATA / "overrides.json").read_text(encoding="utf-8")).items() if not k.startswith("_")}
by_qid = {f["properties"]["wikidata"]: f for f in feats}
unknown = [q for q in overrides if q not in by_qid]
if unknown:
    raise SystemExit(f"overrides.json has QIDs not in the data: {unknown}")
for q, o in overrides.items():
    by_qid[q]["properties"].update({k: v for k, v in o.items() if not k.startswith("_")})
    by_qid[q]["properties"]["override"] = o.get("_why")
feats.sort(key=lambda f: -f["properties"]["score"])
write_geojson(DATA / "places.geojson", feats)
print("places:", len(feats), dict(Counter(f["properties"]["tier"] for f in feats)))
print("with photo:", sum(1 for f in feats if f["properties"]["photos"]), "with blurb:", sum(1 for f in feats if f["properties"]["blurb"]))

# Shores
eu = unary_union([g for g, p in mah_geoms if p.get("district") not in ASIA])
asia = unary_union([g for g, p in mah_geoms if p.get("district") in ASIA])
write_geojson(DATA / "shores.geojson", [
    {"type": "Feature", "properties": {"shore": "europe"}, "geometry": round_coords(mapping(eu.simplify(0.0005)), 5)},
    {"type": "Feature", "properties": {"shore": "asia"}, "geometry": round_coords(mapping(asia.simplify(0.0005)), 5)},
])

# Fixed points. SAW from Wikidata (Q723622 = Sabiha Gökçen International Airport); flat from OSM way 183820655.
saw_e = entities(["Q723622"], "claims|labels")["Q723622"]
v = saw_e["claims"]["P625"][0]["mainsnak"]["datavalue"]["value"]
lon, lat = v["longitude"], v["latitude"]
saw = {"l": {"value": saw_e["labels"]["en"]["value"]}}
print("SAW from Wikidata:", saw["l"]["value"], lat, lon)
write_geojson(DATA / "fixed.geojson", [
    {"type": "Feature", "properties": {"id": "flat", "name": "Our flat", "kind": "home",
                                       "note": "Hüseyin Ağa Bahçe Sokağı, Beyoğlu (street centre)", "source": "osm:way/183820655"},
     "geometry": {"type": "Point", "coordinates": [28.98062, 41.03098]}},
    {"type": "Feature", "properties": {"id": "saw", "name": "Sabiha Gökçen Airport (SAW)", "kind": "airport",
                                       "note": "Arrive Fri 16:15 · depart Mon 21:00", "source": "wikidata:Q723622"},
     "geometry": {"type": "Point", "coordinates": [round(lon, 6), round(lat, 6)]}},
])
