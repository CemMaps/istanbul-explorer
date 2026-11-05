"""Turn data/work/candidates.json into data/work/candidates.geojson with provisional tiers,
flagging points outside the study area. Provisional only: tiers get a judgement pass before places.geojson."""
import json
from collections import Counter

from shapely.geometry import Point, shape

from lib import DATA, write_geojson

WORK = DATA / "work"
cands = json.loads((WORK / "candidates.json").read_text(encoding="utf-8"))
study = shape(json.loads((DATA / "study_area.geojson").read_text(encoding="utf-8"))["features"][0]["geometry"])


def tier(f):
    return "must-see" if f >= 3.9 else "worth-it" if f >= 3.0 else "bonus"


feats = []
for c in cands:
    inside = study.contains(Point(c["lon"], c["lat"]))
    feats.append({
        "type": "Feature",
        "properties": {
            "qid": c["qid"], "name": c["name"], "name_tr": c["name_tr"], "category": c["category"],
            "classes": ", ".join(c["classes"][:4]), "sitelinks": c["sitelinks"],
            "pageviews_60d": c["pageviews_60d"], "fame": c["fame"], "tier": tier(c["fame"]),
            "image": c["image"], "wikipedia": c["wikipedia"], "in_study_area": inside,
            "source": f"wikidata:{c['qid']}",
        },
        "geometry": {"type": "Point", "coordinates": [round(c["lon"], 6), round(c["lat"], 6)]},
    })
write_geojson(WORK / "candidates.geojson", feats)
inside = [f for f in feats if f["properties"]["in_study_area"]]
print("candidates:", len(feats), "inside study area:", len(inside))
print("tiers (inside):", dict(Counter(f["properties"]["tier"] for f in inside)))
print("categories (inside):", dict(Counter(f["properties"]["category"] for f in inside)))
