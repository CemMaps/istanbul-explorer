"""Smooth study area along the whole Bosphorus, built from sourced features (no hand-drawn coordinates):
  land within BAND_M of the sea coast (OSM natural=coastline: Bosphorus, Golden Horn, Marmara shore),
  inside the 10 districts on the Bosphorus / Golden Horn (OSM admin_level=6), whole strait from the Black Sea mouth to Moda,
then a morphological close + open (round off gaps and spikes) and simplify.
BAND_M = 4 km comes from scripts/analysis_inland_distance.py: 98% of notable places (≥15 sitelinks) in those
districts are within 3.3 km of the water; 4 km also takes in Kağıthane.
Writes data/study_area.geojson and data/study_mask.geojson (world minus study area, for the app's blur mask)."""
from shapely.affinity import affine_transform
from shapely.geometry import Point, box, mapping

from lib import DATA, overpass, round_coords, write_geojson

DISTRICTS = ["Fatih", "Beyoğlu", "Beşiktaş", "Şişli", "Kâğıthane", "Sarıyer", "Eyüpsultan", "Üsküdar", "Kadıköy", "Beykoz"]
COAST_BOX = (40.94, 28.76, 41.32, 29.38)  # same query box as analysis_inland_distance.py (cache reuse)
BAND_M = 4000
SMOOTH_M = 1500  # v1 value, kept for the record
# v2 (2026-11-05, Cem: "smooth it out, join up the gap"): a 4 km close bridges the ~3 km Bosphorus mouth
# between Sarayburnu and Kadıköy and rounds the outline. Open kept at 1 km: 1.5 km+ cut off Yedikule / Golden Gate.
# Check after changing: no place in places.geojson may fall outside.
import os
CLOSE_M = int(os.environ.get("CLOSE_M", 4000))
OPEN_M = int(os.environ.get("OPEN_M", 1000))

# Local metric projection (equirectangular at 41°N) — fine at city scale.
K_LON, K_LAT = 84_000.0, 111_100.0
to_m = [K_LON, 0, 0, K_LAT, 0, 0]
to_deg = [1 / K_LON, 0, 0, 1 / K_LAT, 0, 0]


def rel_polygon(rel):
    from shapely.geometry import LineString
    from shapely.ops import linemerge, polygonize, unary_union
    outer = [LineString([(p["lon"], p["lat"]) for p in m["geometry"]])
             for m in rel.get("members", []) if m["type"] == "way" and "geometry" in m and m.get("role") != "inner"]
    polys = list(polygonize(linemerge(outer)))
    return unary_union(polys).buffer(0) if polys else None


from shapely.geometry import LineString
from shapely.ops import unary_union

# Same query text as 01_osm.py so the cached response is reused.
districts = {}
for r in overpass('[out:json][timeout:180];rel(40.96,28.88,41.2,29.13)["boundary"="administrative"]["admin_level"="6"];out geom;')["elements"]:
    g = rel_polygon(r)
    if g is not None:
        districts[r["tags"].get("name")] = g
land = unary_union([districts[d] for d in DISTRICTS])

S, W, N, E = COAST_BOX
coast = []
for w in overpass(f'[out:json][timeout:180];way({S},{W},{N},{E})["natural"="coastline"];out geom;')["elements"]:
    pts = [(p["lon"], p["lat"]) for p in w.get("geometry", [])]
    # Keep the Bosphorus, Golden Horn and Marmara shore; drop the open Black Sea coast away from the strait mouth.
    pts = [(x, y) for x, y in pts if y <= 41.20 or 29.03 <= x <= 29.17]
    if len(pts) >= 2:
        coast.append(LineString(pts))
coast_m = affine_transform(unary_union(coast), to_m)
land_m = affine_transform(land, to_m)

area_m = coast_m.buffer(BAND_M).intersection(land_m.buffer(300))  # small buffer keeps the water between shores
area_m = area_m.buffer(CLOSE_M).buffer(-CLOSE_M)  # close: fill gaps, join both shores and the Marmara mouth
area_m = area_m.buffer(-OPEN_M).buffer(OPEN_M)    # open: round off spikes and narrow tips
if area_m.geom_type == "MultiPolygon":
    area_m = max(area_m.geoms, key=lambda g: g.area)
area_m = area_m.simplify(120)
area = affine_transform(area_m, to_deg)
print("study area ≈ %.0f km², bounds %s" % (area_m.area / 1e6, tuple(round(v, 3) for v in area.bounds)))

write_geojson(DATA / "study_area.geojson", [{
    "type": "Feature",
    "properties": {"name": "Study area", "districts": DISTRICTS, "band_m": BAND_M,
                   "close_m": CLOSE_M, "open_m": OPEN_M, "source": "osm natural=coastline buffered, within osm admin_level=6 districts, smoothed"},
    "geometry": round_coords(mapping(area), 5)}])
mask = box(-180, -85, 180, 85).difference(area)
write_geojson(DATA / "study_mask.geojson", [{"type": "Feature", "properties": {"name": "Outside study area"},
                                             "geometry": round_coords(mapping(mask), 5)}])
