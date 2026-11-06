"""Food & drink places → appended to data/places.geojson (category "Food & drink"). Re-runnable: old food entries are replaced.

Two sources (no Google data):
  1. Wikidata: notable food places (restaurants, coffeehouses, meyhanes, pâtisseries, bakeries, sweet shops, tea houses)
     near the study area, found with the Wikidata search API (haswbstatement + nearcoord; the SPARQL service rate-limits).
     These get photos (P18) and tiers by sitelinks, like the sights.
  2. Overture Places 2026-10-21.0 (data/raw/overture_food.parquet, from 10a_overture_food.py): local places, tier "local"
     (shown only at street zoom). Kept: Istanbul-style kinds (no fast food, chains or foreign cuisines), confidence ≥ 0.9
     with both a website and social links, plus meyhanes / fish / lokanta / kahvaltı places with confidence ≥ 0.75.
     Chains = a brand, or a name used 4+ times. Duplicates of Wikidata entries (≤ 80 m, similar name) are dropped.
Everything is clipped to data/study_area.geojson. Run 09 first; run 08 afterwards (summaries for the Wikidata ones).
`kind` (Meyhane, Fish, Kebab…) comes from the Overture category plus Turkish name words; `veggie_friendly` is a
rough flag from the kind (meze, fish, breakfast, cafés, sweets: yes; kebab/grill: no)."""
import json
import re
import unicodedata
import urllib.parse
from collections import Counter

import duckdb
from shapely.geometry import Point, shape

from lib import DATA, haversine_m, http_json, write_geojson

area = shape(json.loads((DATA / "study_area.geojson").read_text(encoding="utf-8"))["features"][0]["geometry"])
mah = [(shape(f["geometry"]), f["properties"]) for f in json.loads((DATA / "mahalles.geojson").read_text(encoding="utf-8"))["features"]]
areas = [(shape(f["geometry"]), f["properties"]) for f in json.loads((DATA / "areas.geojson").read_text(encoding="utf-8"))["features"]]
ASIA = {"Üsküdar", "Kadıköy", "Beykoz", "Ataşehir", "Ümraniye"}


def slug(s):
    s = unicodedata.normalize("NFKD", s.replace("ı", "i").replace("İ", "I"))
    s = "".join(ch for ch in s if not unicodedata.combining(ch)).lower()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")[:48]


def norm(s):
    return slug(s or "").replace("-", "")


# ---------- kinds ----------
KIND_BY_CAT = {
    "seafood_restaurant": "fish", "fish_and_chips_restaurant": "fish", "doner_kebab_restaurant": "kebab",
    "barbecue_restaurant": "kebab", "soup_restaurant": "lokanta", "comfort_food_restaurant": "lokanta",
    "buffet_restaurant": "lokanta", "breakfast_and_brunch_restaurant": "breakfast", "cafe": "cafe", "coffee_shop": "coffee",
    "tea_room": "tea", "bakery": "bakery", "dessert_shop": "sweets", "ice_cream_shop": "icecream", "chocolatier": "sweets",
    "candy_store": "sweets", "bar": "bar", "pub": "bar", "cocktail_bar": "bar", "wine_bar": "bar", "beer_garden": "bar",
    "gastropub": "bar", "restaurant": "restaurant", "turkish_restaurant": "restaurant", "mediterranean_restaurant": "restaurant",
    "middle_eastern_restaurant": "restaurant", "greek_restaurant": "restaurant",
}
NAME_KIND = [  # Turkish name words win over the category
    (r"meyhane", "meyhane"), (r"bal[ıi]k|fish|seafood", "fish"), (r"kahvalt|breakfast", "breakfast"),
    (r"lokanta|esnaf", "lokanta"), (r"kebap|kebab|ocakba[şs]|d[öo]ner|köfte|kofte|iskender|lahmacun|pide", "kebab"),
    (r"baklava|k[üu]nefe|muhallebi|pastane|tatl[ıi]|lokum|g[üu]llu|helva|profiterol|dondurma", "sweets"),
    (r"b[öo]rek|simit|f[ıi]r[ıi]n|bakery", "bakery"), (r"[çc]ay bah|[çc]ay ocak|tea garden", "tea"),
    (r"kahve|coffee|kahvecisi", "coffee"), (r"meze", "meyhane"),
]
VEGGIE = {"meyhane": True, "fish": True, "breakfast": True, "cafe": True, "coffee": True, "tea": True, "bakery": True,
          "sweets": True, "icecream": True, "bar": True, "restaurant": True, "lokanta": True, "kebab": False}
SUMMARY = {
    "meyhane": "Meyhane: cold and hot meze, fish and rakı, best shared slowly in the evening.",
    "fish": "Fish restaurant: grilled catch of the day, meze and salads.",
    "kebab": "Kebab and grill house.",
    "lokanta": "Lokanta: home-style Turkish dishes from the counter, vegetables in olive oil included.",
    "breakfast": "Turkish breakfast: cheeses, olives, eggs, honey and kaymak, simit and tea.",
    "cafe": "Café.", "coffee": "Coffee shop.", "tea": "Tea house or tea garden.",
    "bakery": "Bakery: börek, simit, poğaça and pastries.", "sweets": "Sweets: baklava, puddings or Turkish delight.",
    "icecream": "Ice cream.", "bar": "Bar.", "restaurant": "Restaurant.",
}


def kind_of(name, cat=None, classes=()):
    n = (name or "").lower()
    for rx, k in NAME_KIND:
        if re.search(rx, n):
            return k
    j = " ".join(classes).lower()
    if "meyhane" in j:
        return "meyhane"
    if re.search(r"pâtisserie|patisserie|confectioner|pastry", j):
        return "sweets"
    if "bakery" in j:
        return "bakery"
    if re.search(r"coffee|café|cafe", j):
        return "coffee" if "coffee" in j else "cafe"
    if "tea" in j:
        return "tea"
    return KIND_BY_CAT.get(cat, "restaurant")


def where(lon, lat):
    pt = Point(lon, lat)
    m = next((p for g, p in mah if g.contains(pt)), {})
    a = next((p for g, p in areas if g.contains(pt)), {})
    district = m.get("district") or "?"
    return {"area": district, "mahalle": m.get("name"), "shore": "asia" if district in ASIA else "europe",
            "character": {"primary": a.get("primary"), "secondary": a.get("secondary")} if a else None,
            "lifestyle": a.get("lifestyle")}


# ---------- 1. Wikidata ----------
FOOD_CLASSES = ["Q11707", "Q4236467", "Q4822177", "Q861651", "Q274393", "Q3574069", "Q1072166", "Q88985865", "Q27038993"]
qids = set()
for cls in FOOD_CLASSES:
    for c in ["41.03,28.98", "41.09,29.05", "41.19,29.08", "40.99,29.03"]:  # four search centres cover the strait
        url = "https://www.wikidata.org/w/api.php?" + urllib.parse.urlencode({
            "action": "query", "list": "search", "srsearch": f"haswbstatement:P31={cls} nearcoord:12km,{c}",
            "srlimit": 500, "format": "json"})
        for h in http_json(url, cache="wdsearch", retries=5).get("query", {}).get("search", []):
            qids.add(h["title"])
qids = sorted(qids)
ents = {}
for i in range(0, len(qids), 50):
    url = "https://www.wikidata.org/w/api.php?" + urllib.parse.urlencode({
        "action": "wbgetentities", "ids": "|".join(qids[i:i + 50]), "props": "labels|claims|sitelinks|descriptions",
        "languages": "en|tr", "format": "json"})
    ents.update(http_json(url, cache="wbent", retries=5, timeout=60).get("entities", {}))
# class labels for kinds
cls_ids = sorted({c["mainsnak"]["datavalue"]["value"]["id"] for e in ents.values() for c in e.get("claims", {}).get("P31", [])
                  if c["mainsnak"].get("datavalue")})
cls_label = {}
for i in range(0, len(cls_ids), 50):
    url = "https://www.wikidata.org/w/api.php?" + urllib.parse.urlencode({
        "action": "wbgetentities", "ids": "|".join(cls_ids[i:i + 50]), "props": "labels", "languages": "en", "format": "json"})
    for k, e in http_json(url, cache="wbent", retries=5).get("entities", {}).items():
        cls_label[k] = (e.get("labels", {}).get("en") or {}).get("value", "")


def claim(e, p):
    v = e.get("claims", {}).get(p, [])
    return v[0]["mainsnak"].get("datavalue", {}).get("value") if v else None


sight_qids = {x["properties"].get("wikidata") for x in json.loads((DATA / "places.geojson").read_text(encoding="utf-8"))["features"]
              if x["properties"]["category"] != "Food & drink"}
wd_feats = []
for q, e in ents.items():
    if q in sight_qids:
        continue  # a sight with a café or restaurant inside (Maiden's Tower, Malta Kiosk…): already on the map
    coord = claim(e, "P625")
    if not coord or e.get("claims", {}).get("P576") or e.get("claims", {}).get("P582"):
        continue  # no location, or closed / dissolved
    lon, lat = coord["longitude"], coord["latitude"]
    if not area.contains(Point(lon, lat)):
        continue
    name_en = (e.get("labels", {}).get("en") or {}).get("value")
    name_tr = (e.get("labels", {}).get("tr") or {}).get("value")
    name = name_en or name_tr
    if not name:
        continue
    classes = [cls_label.get(c["mainsnak"]["datavalue"]["value"]["id"], "") for c in e.get("claims", {}).get("P31", []) if c["mainsnak"].get("datavalue")]
    full_sl = len(e.get("sitelinks", {}))  # Wikipedia articles in any language: a light fame signal
    img = claim(e, "P18")
    k = kind_of(name, None, classes)
    wd_feats.append({"type": "Feature", "properties": {
        "id": slug(name), "name": name, "name_tr": name_tr or name, "category": "Food & drink", "kind": k,
        "tier": "worth-it" if full_sl >= 2 and img else "bonus", "score": 3.0 + 0.4 * full_sl,
        **where(lon, lat), "blurb": (e.get("descriptions", {}).get("en") or {}).get("value"),
        "summary": SUMMARY[k], "summary_source": "generated:kind",  # 08 swaps in the Wikipedia / Wikidata text when there is one
        "veggie_friendly": VEGGIE[k], "indoor": True, "best_time": "evening" if k in ("meyhane", "fish", "bar") else "any",
        "photos": [{"file": img}] if img else [], "wikidata": q,
        "wikipedia": (e.get("sitelinks", {}).get("enwiki") or {}).get("title", "").replace(" ", "_") or None,
        "source": f"wikidata:{q}"}, "geometry": {"type": "Point", "coordinates": [round(lon, 6), round(lat, 6)]}})
print(f"wikidata food: {len(qids)} found, {len(wd_feats)} inside the study area")

# ---------- 2. Overture ----------
f = (DATA / "raw" / "overture_food.parquet").as_posix()
keep = tuple(KIND_BY_CAT)
rows = duckdb.connect().execute(f"""
  WITH chains AS (SELECT lower(name) n FROM '{f}' GROUP BY 1 HAVING count(*) >= 4)
  SELECT id, name, cat, confidence, lon, lat FROM '{f}'
  WHERE cat IN {keep} AND brand IS NULL AND name IS NOT NULL AND length(name) >= 3
    AND lower(name) NOT IN (SELECT n FROM chains)
    AND ((confidence >= 0.9 AND n_web > 0 AND n_soc > 0)
      OR (confidence >= 0.75 AND n_soc > 0 AND regexp_matches(lower(name), 'meyhane|balık|balik|lokanta|kahvalt|esnaf')))
""").fetchall()
wd_pts = [(f_["geometry"]["coordinates"], norm(f_["properties"]["name"])) for f_ in wd_feats]
ov_feats, seen = [], set()
for oid, name, cat, conf, lon, lat in rows:
    if not area.contains(Point(lon, lat)):
        continue
    nn = norm(name)
    if any(haversine_m(lon, lat, *c) < 80 and (nn[:6] in wn or wn[:6] in nn) for c, wn in wd_pts):
        continue  # same place as a Wikidata entry
    key = (nn, round(lon, 3), round(lat, 3))
    if key in seen:
        continue
    seen.add(key)
    k = kind_of(name, cat)
    ov_feats.append({"type": "Feature", "properties": {
        # Lean on purpose (3,800 of these): no photos, Turkish name = name, text from the kind.
        "id": None, "name": name, "category": "Food & drink", "kind": k, "tier": "local",
        "score": round(1 + conf, 2), **where(lon, lat),
        "summary": SUMMARY[k], "summary_source": "generated:kind", "veggie_friendly": VEGGIE[k],
        "source": f"overture:{oid}"}, "geometry": {"type": "Point", "coordinates": [round(lon, 5), round(lat, 5)]}})
print(f"overture food: {len(rows)} pass the filters, {len(ov_feats)} inside the study area after de-duplication")

# ---------- write ----------
pf = DATA / "places.geojson"
fc = json.loads(pf.read_text(encoding="utf-8"))
feats = [x for x in fc["features"] if x["properties"]["category"] != "Food & drink"]
used = Counter(x["properties"]["id"] for x in feats)
for x in wd_feats + ov_feats:
    base = x["properties"]["id"] or slug(x["properties"]["name"]) or "food"
    used[base] += 1
    x["properties"]["id"] = base if used[base] == 1 else f"{base}-{used[base]}"
write_geojson(pf, feats + wd_feats + ov_feats)
print("food kinds:", dict(Counter(x["properties"]["kind"] for x in wd_feats + ov_feats)))
print("food tiers:", dict(Counter(x["properties"]["tier"] for x in wd_feats + ov_feats)))
