"""Static feathered mask outside the study area (2026-11-08).

Replaces the per-frame DOM blur veil (canvas -> PNG -> CSS mask on every map move), which flickered and,
on iPhone, built up enough memory churn to freeze the app. The map now draws the outside as plain GL fills:
a clear strip just outside the line, then rings that get steadily milkier out to FEATHER_M, then a solid
milky fill beyond. Computed once here, so panning and zooming cost nothing extra.

Writes data/study_mask.geojson: fill features with property `a` (0..1, share of the full tint) and one
`edge` line (the study area outline).
"""
import json
import math

from shapely.geometry import shape, mapping, box
from shapely.ops import transform
from pyproj import Transformer

from lib import DATA

CLEAR_M = 60       # sharp strip just outside the line, so labels of edge places stay crisp
FEATHER_M = 1600   # distance over which the tint fades in
RINGS = 16         # enough steps that no banding shows
SIMPLIFY_M = 25

area = shape(json.loads((DATA / "study_area.geojson").read_text(encoding="utf-8"))["features"][0]["geometry"])
to_m = Transformer.from_crs(4326, 32635, always_xy=True).transform
to_ll = Transformer.from_crs(32635, 4326, always_xy=True).transform
a_m = transform(to_m, area)

feats = []
prev = a_m.buffer(CLEAR_M, quad_segs=8).simplify(SIMPLIFY_M)
step = (FEATHER_M - CLEAR_M) / RINGS
for i in range(1, RINGS + 1):
    nxt = a_m.buffer(CLEAR_M + step * i, quad_segs=8).simplify(SIMPLIFY_M)  # simplify each buffer once: neighbours share edges
    t = (i - 0.5) / RINGS
    a = t * t * (3 - 2 * t)  # smoothstep: soft start, soft finish
    ring = nxt.difference(prev)
    feats.append({"type": "Feature", "properties": {"a": round(a, 3)}, "geometry": mapping(transform(to_ll, ring))})
    prev = nxt

world = box(-180, -85, 180, 85)
outer = world.difference(transform(to_ll, prev))
feats.append({"type": "Feature", "properties": {"a": 1}, "geometry": mapping(outer)})
# the study area outline itself, for the faint edge line
feats.append({"type": "Feature", "properties": {"edge": True}, "geometry": mapping(area.boundary)})


def rnd(o):
    if isinstance(o, float):
        return round(o, 5)
    if isinstance(o, (list, tuple)):
        return [rnd(x) for x in o]
    if isinstance(o, dict):
        return {k: rnd(v) for k, v in o.items()}
    return o


out = DATA / "study_mask.geojson"
out.write_text(json.dumps({"type": "FeatureCollection", "features": rnd(feats)}, separators=(",", ":")), encoding="utf-8")
print(f"{out.name}: {len(feats)} features, {out.stat().st_size // 1024} kB")
