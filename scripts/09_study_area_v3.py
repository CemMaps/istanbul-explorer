"""Study area v3 (2026-11-06, Cem: "smooth it out, close the gaps, it's too wide along the central and northern
Bosphorus where there's nothing to see; a calm, neutral shape").

Default (HULL=0.12, chosen after comparing in qa/shape.html): a concave hull of the sights + shore points, padded by
WALK_M, opened by OPEN_M and rounded by ROUND_M: one calm outline, a single rounded cap at the Black Sea end.
HULL=0 gives the older union-of-buffers version described below (bumpier, "ears" at the north).
Built from what we actually show, not from a fixed band:
  1. every sight in places.geojson (bonus-tier neighbourhood labels left out: they are just admin quarters),
     each with a WALK_M buffer (the area you'd wander around it),
  2. plus a thin WATER_M band along the Bosphorus / Golden Horn shores, so the strait stays one continuous piece,
  3. then close (CLOSE_M) to fill the gaps between clusters, open (OPEN_M) to drop spikes, a soft round-off and simplify.
Every place must end up inside (checked; the script fails otherwise).
Writes data/study_area.geojson, data/study_mask.geojson, and clips data/areas.geojson (vibe map) to the new outline.
Run after 08_finish_places.py and before 10_food.py (food is filtered to this area)."""
import json
import os
import shutil

from shapely.affinity import affine_transform
from shapely.geometry import LineString, Point, box, mapping, shape
from shapely.ops import unary_union

from lib import DATA, overpass, round_coords, write_geojson

WALK_M = int(os.environ.get("WALK_M", 900))
WATER_M = int(os.environ.get("WATER_M", 500))
CLOSE_M = int(os.environ.get("CLOSE_M", 2600))
OPEN_M = int(os.environ.get("OPEN_M", 2000))
ROUND_M = int(os.environ.get("ROUND_M", 2500))

K_LON, K_LAT = 84_000.0, 111_100.0
to_m = [K_LON, 0, 0, K_LAT, 0, 0]
to_deg = [1 / K_LON, 0, 0, 1 / K_LAT, 0, 0]

places = json.loads((DATA / "places.geojson").read_text(encoding="utf-8"))["features"]
sights = [f for f in places if f["properties"]["category"] != "Food & drink"
          and not (f["properties"]["category"] == "Neighbourhoods" and f["properties"]["tier"] == "bonus")]
fixed = [f for f in json.loads((DATA / "fixed.geojson").read_text(encoding="utf-8"))["features"] if f["properties"].get("kind") == "home"]
pts_m = [affine_transform(Point(f["geometry"]["coordinates"]), to_m) for f in sights + fixed]

# Shores of the strait and the Golden Horn only (same cached Overpass query as 00_study_area.py).
coast = []
for w in overpass('[out:json][timeout:180];way(40.94,28.76,41.32,29.38)["natural"="coastline"];out geom;')["elements"]:
    pts = [(p["lon"], p["lat"]) for p in w.get("geometry", [])]
    # the strait runs ~41.00–41.22 N; keep its shores and the Golden Horn, not the open Marmara / Black Sea coasts
    pts = [(x, y) for x, y in pts if 40.995 <= y <= 41.215 and 28.93 <= x <= 29.10]
    if len(pts) >= 2:
        coast.append(LineString(pts))
water_m = affine_transform(unary_union(coast), to_m).buffer(WATER_M)

HULL = float(os.environ.get("HULL", 0.12))
if HULL:
    # Concave hull of the sights + shore points: one calm outline without bays and ears, then padded and rounded.
    from shapely import concave_hull
    from shapely.geometry import MultiPoint
    shore = [Point(c) for g in getattr(water_m.exterior, "coords", []) for c in [g]][::20] if water_m.geom_type == "Polygon" else \
            [Point(c) for poly in water_m.geoms for c in list(poly.exterior.coords)[::20]]
    area_m = concave_hull(MultiPoint(pts_m + shore), ratio=HULL).buffer(WALK_M)
else:
    area_m = unary_union([p.buffer(WALK_M) for p in pts_m] + [water_m])
    area_m = area_m.buffer(CLOSE_M).buffer(-CLOSE_M)
area_m = area_m.buffer(-OPEN_M).buffer(OPEN_M)
# The open can shave off a lone sight at the edge (Anadolu Feneri): add every sight back and blend it in.
area_m = unary_union([area_m] + [p.buffer(WALK_M * 0.8) for p in pts_m]).buffer(1500).buffer(-1500)
if area_m.geom_type == "MultiPolygon":
    area_m = max(area_m.geoms, key=lambda g: g.area)
area_m = area_m.buffer(ROUND_M).buffer(-ROUND_M).simplify(60)
area = affine_transform(area_m, to_deg)

outside = [f["properties"]["id"] for f in places if not area.contains(Point(f["geometry"]["coordinates"]))
           and f["properties"]["category"] != "Food & drink"]
# Lesser neighbourhood labels outside the new outline are dropped (they were only admin quarters at the edge).
drop = {i for i in outside if next(f for f in places if f["properties"]["id"] == i)["properties"]["category"] == "Neighbourhoods"}
missing = [i for i in outside if i not in drop]
if missing:
    raise SystemExit(f"places outside the study area: {missing}")
old = shape(json.loads((DATA / "study_area.geojson").read_text(encoding="utf-8"))["features"][0]["geometry"])
print("study area ≈ %.0f km² (was %.0f), dropping %d edge neighbourhood labels: %s" % (
    area_m.area / 1e6, affine_transform(old, to_m).area / 1e6, len(drop), sorted(drop)))

raw = DATA / "raw" / "study_area_v2.geojson"
if not raw.exists():
    shutil.copy(DATA / "study_area.geojson", raw)
write_geojson(DATA / "study_area.geojson", [{
    "type": "Feature",
    "properties": {"name": "Study area", "version": 3, "walk_m": WALK_M, "water_m": WATER_M, "close_m": CLOSE_M, "open_m": OPEN_M,
                   "source": "buffers around places.geojson sights + osm natural=coastline (strait, Golden Horn), smoothed"},
    "geometry": round_coords(mapping(area), 5)}])
mask = box(-180, -85, 180, 85).difference(area)
write_geojson(DATA / "study_mask.geojson", [{"type": "Feature", "properties": {"name": "Outside study area"},
                                             "geometry": round_coords(mapping(mask), 5)}])
pf = DATA / "places.geojson"
fc = json.loads(pf.read_text(encoding="utf-8"))
write_geojson(pf, [f for f in fc["features"] if f["properties"]["id"] not in drop])

# Vibe areas: clip to the new outline (keeps the unclipped original in data/raw once).
af = DATA / "areas.geojson"
raw_a = DATA / "raw" / "areas_before_09.geojson"
if not raw_a.exists():
    shutil.copy(af, raw_a)
areas = json.loads(raw_a.read_text(encoding="utf-8"))["features"]
out = []
for f in areas:
    g = shape(f["geometry"]).intersection(area)
    if g.is_empty or g.area < 1e-7:
        continue
    if g.geom_type == "GeometryCollection":
        g = unary_union([x for x in g.geoms if x.geom_type in ("Polygon", "MultiPolygon")])
    out.append({"type": "Feature", "properties": f["properties"], "geometry": round_coords(mapping(g), 5)})
write_geojson(af, out)
print(f"vibe areas: {len(areas)} -> {len(out)} after clipping")
