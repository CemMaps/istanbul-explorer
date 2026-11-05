import json
"""Fetch OSM context layers: districts, mahalle polygons, ferry lines, stations/piers.
Needs data/study_area.geojson (run 00_study_area.py first). Writes data/mahalles.geojson, data/ferries.geojson, data/stops.geojson.
OSM data © OpenStreetMap contributors, ODbL."""
from shapely.geometry import LineString, MultiPolygon, Polygon, box, mapping, shape
from shapely.ops import linemerge, polygonize, unary_union

from lib import BBOX, DATA, admin_query, overpass, round_coords, write_geojson

S, W, N, E = BBOX
bb = f"({S},{W},{N},{E})"



def rel_polygon(rel):
    """Assemble an OSM boundary relation (out geom) into a shapely (Multi)Polygon."""
    outer, inner = [], []
    for m in rel.get("members", []):
        if m["type"] != "way" or "geometry" not in m:
            continue
        line = LineString([(p["lon"], p["lat"]) for p in m["geometry"]])
        (inner if m.get("role") == "inner" else outer).append(line)
    polys = list(polygonize(linemerge(outer)))
    if not polys:
        return None
    geom = unary_union(polys)
    if inner:
        holes = unary_union(list(polygonize(linemerge(inner))))
        geom = geom.difference(holes)
    return geom.buffer(0)


def admin(level):
    return overpass(admin_query(level))["elements"]


study = shape(json.loads((DATA / "study_area.geojson").read_text(encoding="utf-8"))["features"][0]["geometry"])
print("districts…")
districts = {}
for r in admin(6):
    g = rel_polygon(r)
    if g is not None:
        districts[r["tags"].get("name")] = g

print("mahalles…")
feats = []
for r in admin(8):
    g = rel_polygon(r)
    if g is None:
        continue
    pt = g.representative_point()
    if not study.contains(pt):
        continue
    district = next((n for n, dg in districts.items() if dg.contains(pt)), None)
    feats.append({
        "type": "Feature",
        "properties": {"id": f"osm-r{r['id']}", "name": r["tags"].get("name"), "district": district,
                       "source": f"osm:relation/{r['id']}"},
        "geometry": round_coords(mapping(g.intersection(study).simplify(0.00005)), 6),
    })
write_geojson(DATA / "mahalles.geojson", feats)
print("  mahalles in study area:", len(feats))

print("ferries…")
q = f'[out:json][timeout:180];rel{bb}["route"="ferry"];out geom;'
ferries = []
for r in overpass(q)["elements"]:
    lines = [LineString([(p["lon"], p["lat"]) for p in m["geometry"]])
             for m in r.get("members", []) if m["type"] == "way" and "geometry" in m]
    piers = [{"name": m.get("name"), "lon": m["lon"], "lat": m["lat"]}
             for m in r.get("members", []) if m["type"] == "node" and "lon" in m]
    if not lines:
        continue
    t = r["tags"]
    geom = linemerge(lines)
    inside = geom.intersection(study)
    if geom.length == 0 or inside.length / geom.length < 0.7:
        continue  # mostly outside (Yalova, Princes' Islands, Bakırköy, Bostancı…)
    geom = inside
    ferries.append({
        "type": "Feature",
        "properties": {"id": f"osm-r{r['id']}", "name": t.get("name"), "ref": t.get("ref"),
                       "operator": t.get("operator"), "from": t.get("from"), "to": t.get("to"),
                       "pier_count": len(piers), "source": f"osm:relation/{r['id']}"},
        "geometry": round_coords(mapping(geom.simplify(0.0001)), 5),
    })
write_geojson(DATA / "ferries.geojson", ferries)
print("  ferry routes:", len(ferries))

print("stops…")
q = (f'[out:json][timeout:180];('
     f'node{bb}["railway"="station"];node{bb}["railway"="tram_stop"];'
     f'node{bb}["public_transport"="station"]["station"~"subway|light_rail|funicular|monorail"];'
     f'nwr{bb}["amenity"="ferry_terminal"];);out center tags;')
stops, seen = [], set()
for e in overpass(q)["elements"]:
    t = e["tags"]
    lon, lat = (e["lon"], e["lat"]) if "lon" in e else (e["center"]["lon"], e["center"]["lat"])
    if t.get("amenity") == "ferry_terminal":
        mode = "ferry"
    elif t.get("railway") == "tram_stop" or t.get("tram") == "yes":
        mode = "tram"
    elif t.get("station") == "funicular" or t.get("funicular") == "yes":
        mode = "funicular"
    elif t.get("station") in ("subway", "light_rail") or t.get("subway") == "yes":
        mode = "metro"
    else:
        mode = "rail"
    key = (t.get("name"), mode, round(lon, 3), round(lat, 3))
    if key in seen or not t.get("name"):
        continue
    seen.add(key)
    if not study.buffer(0.005).contains(shape({"type": "Point", "coordinates": [lon, lat]})):
        continue
    stops.append({"type": "Feature",
                  "properties": {"id": f"osm-{e['type'][0]}{e['id']}", "name": t.get("name"), "mode": mode,
                                 "lines": t.get("line") or t.get("route_ref"), "source": f"osm:{e['type']}/{e['id']}"},
                  "geometry": {"type": "Point", "coordinates": [round(lon, 6), round(lat, 6)]}})
write_geojson(DATA / "stops.geojson", stops)
from collections import Counter
print("  stops:", len(stops), dict(Counter(s["properties"]["mode"] for s in stops)))
