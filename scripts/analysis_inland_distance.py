"""Evidence for the study-area band width: how far from the water are the notable places
in the districts that touch the Bosphorus / Golden Horn? Prints distance percentiles.
Notable = Wikidata item with a coordinate and ≥ 15 sitelinks (a fame proxy independent of our class rules)."""
import re
import statistics

from shapely.geometry import LineString, Point
from shapely.affinity import affine_transform
from shapely.ops import linemerge, polygonize, unary_union

from lib import overpass, sparql

DISTRICTS = ["Fatih", "Beyoğlu", "Beşiktaş", "Şişli", "Kâğıthane", "Sarıyer", "Eyüpsultan", "Üsküdar", "Kadıköy", "Beykoz"]
S, W, N, E = 40.94, 28.76, 41.32, 29.38
K = [84_000.0, 0, 0, 111_100.0, 0, 0]


def poly(rel):
    outer = [LineString([(p["lon"], p["lat"]) for p in m["geometry"]])
             for m in rel["members"] if m["type"] == "way" and "geometry" in m and m.get("role") != "inner"]
    return unary_union(list(polygonize(linemerge(outer)))).buffer(0)


els = overpass('[out:json][timeout:180];rel(40.96,28.88,41.2,29.13)["boundary"="administrative"]["admin_level"="6"];out geom;')["elements"]
land = unary_union([poly(r) for r in els if r["tags"].get("name") in DISTRICTS])

coast = overpass(f'[out:json][timeout:180];way({S},{W},{N},{E})["natural"="coastline"];out geom;')["elements"]
golden_horn = overpass(f'[out:json][timeout:180];(way({S},{W},{N},{E})["name"~"Haliç|Golden Horn"]["natural"="water"];'
                       f'rel({S},{W},{N},{E})["name"~"Haliç|Golden Horn"]["natural"="water"];);out geom;')["elements"]
lines = [LineString([(p["lon"], p["lat"]) for p in w["geometry"]]) for w in coast + golden_horn if "geometry" in w]
water_edge_m = affine_transform(unary_union(lines), K)
print("coastline ways:", len(coast), "golden horn features:", len(golden_horn))

rows = sparql(f"""SELECT ?item ?loc ?sl ?label WHERE {{
  SERVICE wikibase:box {{ ?item wdt:P625 ?loc .
    bd:serviceParam wikibase:cornerSouthWest "Point({W} {S})"^^geo:wktLiteral ;
                    wikibase:cornerNorthEast "Point({E} {N})"^^geo:wktLiteral . }}
  ?item wikibase:sitelinks ?sl . FILTER(?sl >= 15)
  OPTIONAL {{ ?item rdfs:label ?label FILTER(lang(?label) = "en") }}
}}""")["results"]["bindings"]

dist = []
for r in rows:
    lon, lat = map(float, re.findall(r"[-\d.]+", r["loc"]["value"])[:2])
    pt = Point(lon, lat)
    if not land.contains(pt):
        continue
    d = affine_transform(pt, K).distance(water_edge_m)
    dist.append((d, r.get("label", {}).get("value", "?"), int(r["sl"]["value"])))
dist.sort()
ds = [d for d, *_ in dist]
print("notable places in the 10 districts:", len(ds))
for q in (50, 75, 90, 95, 98):
    print(f"  {q}% are within {ds[int(len(ds) * q / 100) - 1] / 1000:.1f} km of the water")
print("farthest 15:")
for d, name, sl in dist[-15:]:
    print(f"  {d / 1000:5.1f} km  {name} ({sl} sitelinks)")
