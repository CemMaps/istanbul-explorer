"""Coverage checks for Phase 1:
1. Which reasonably famous Wikidata items (≥ 10 sitelinks) did the class rules drop? (are we skipping attractions?)
2. Is the concentration in the old city real? Compare our candidates' share per district with
   (a) ALL Wikidata items with a coordinate (any fame) and (b) OSM tourism-tagged features."""
import json
import re
from collections import Counter

from shapely.geometry import LineString, Point, shape
from shapely.ops import linemerge, polygonize, unary_union

from lib import BBOX, DATA, admin_query, overpass, sparql

S, W, N, E = BBOX
study = shape(json.loads((DATA / "study_area.geojson").read_text(encoding="utf-8"))["features"][0]["geometry"])
cands = json.loads((DATA / "work" / "candidates.json").read_text(encoding="utf-8"))
kept = {c["qid"] for c in cands}


def poly(rel):
    outer = [LineString([(p["lon"], p["lat"]) for p in m["geometry"]])
             for m in rel["members"] if m["type"] == "way" and "geometry" in m and m.get("role") != "inner"]
    return unary_union(list(polygonize(linemerge(outer)))).buffer(0)


districts = {r["tags"]["name"]: poly(r) for r in overpass(admin_query(6))["elements"]}


def district_of(lon, lat):
    p = Point(lon, lat)
    return next((n for n, g in districts.items() if g.contains(p)), "?")


# 1. dropped famous items
rows = sparql(f"""SELECT ?item ?loc ?sl ?label (GROUP_CONCAT(DISTINCT ?cl; separator=", ") AS ?classes) WHERE {{
  SERVICE wikibase:box {{ ?item wdt:P625 ?loc .
    bd:serviceParam wikibase:cornerSouthWest "Point({W} {S})"^^geo:wktLiteral ;
                    wikibase:cornerNorthEast "Point({E} {N})"^^geo:wktLiteral . }}
  ?item wikibase:sitelinks ?sl . FILTER(?sl >= 10)
  OPTIONAL {{ ?item wdt:P31 ?c . ?c rdfs:label ?cl FILTER(lang(?cl) = "en") }}
  OPTIONAL {{ ?item rdfs:label ?label FILTER(lang(?label) = "en") }}
}} GROUP BY ?item ?loc ?sl ?label""")["results"]["bindings"]
dropped = []
for r in rows:
    qid = r["item"]["value"].rsplit("/", 1)[1]
    lon, lat = map(float, re.findall(r"[-\d.]+", r["loc"]["value"])[:2])
    if qid in kept or not study.contains(Point(lon, lat)):
        continue
    dropped.append((int(r["sl"]["value"]), r.get("label", {}).get("value", qid), r.get("classes", {}).get("value", "")))
dropped.sort(reverse=True)
print(f"famous items (≥10 sitelinks) in study area dropped by class rules: {len(dropped)}")
for sl, name, cls in dropped[:60]:
    print(f"  {sl:3d}  {name}  [{cls[:70]}]")

# 2. spatial bias
inside = [c for c in cands if study.contains(Point(c["lon"], c["lat"]))]
ours = Counter(district_of(c["lon"], c["lat"]) for c in inside)

allwd = sparql(f"""SELECT ?item ?loc WHERE {{
  SERVICE wikibase:box {{ ?item wdt:P625 ?loc .
    bd:serviceParam wikibase:cornerSouthWest "Point({W} {S})"^^geo:wktLiteral ;
                    wikibase:cornerNorthEast "Point({E} {N})"^^geo:wktLiteral . }} }}""")["results"]["bindings"]
allc = Counter()
for r in allwd:
    lon, lat = map(float, re.findall(r"[-\d.]+", r["loc"]["value"])[:2])
    if study.contains(Point(lon, lat)):
        allc[district_of(lon, lat)] += 1

tour = overpass(f'[out:json][timeout:180];nwr({S},{W},{N},{E})["tourism"~"attraction|museum|viewpoint|gallery"];out center;')["elements"]
tc = Counter()
for e in tour:
    lon, lat = (e["lon"], e["lat"]) if "lon" in e else (e["center"]["lon"], e["center"]["lat"])
    if study.contains(Point(lon, lat)):
        tc[district_of(lon, lat)] += 1


def share(c):
    t = sum(c.values()) or 1
    return {k: round(100 * v / t) for k, v in c.items()}


so, sa, st = share(ours), share(allc), share(tc)
print(f"\nshare of points by district (%): ours n={sum(ours.values())} | all Wikidata n={sum(allc.values())} | OSM tourism n={sum(tc.values())}")
for d in sorted(set(so) | set(sa) | set(st), key=lambda k: -so.get(k, 0)):
    print(f"  {d:12s} {so.get(d, 0):4d} {sa.get(d, 0):6d} {st.get(d, 0):6d}")
