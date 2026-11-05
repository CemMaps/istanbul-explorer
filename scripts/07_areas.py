"""Area character ("vibe") + lifestyle per mahalle, merged into character areas.
Question per area (CLAUDE.md): what does street life feel like here, for a visitor, most of the day?

Evidence per mahalle (OSM admin_level=8 polygons, data/mahalles.geojson):
  Overture Places 2026-10-21.0 (data/raw/overture_places.parquet, from 06_overture.py) grouped into
  street-life signals (bars, cafés & galleries, mosques & tea houses, wholesale, offices & malls, sights,
  everyday shops & workshops, seafood), venue density per km², and whether it fronts the Bosphorus.
Rules (written, reviewable) turn evidence into one primary class (+ optional secondary) and a lifestyle.
A short list of judgement overrides (each with a reason) handles places the data can't see.
Thin evidence → Everyday residential. Very low density + large → Green & open.

Writes data/areas.geojson (merged areas), data/mahalle_character.csv (per-mahalle evidence, for review)
and adds character / lifestyle / mahalle to data/places.geojson. Run after 05_photos.py."""
import csv
import json
import re
from collections import Counter, defaultdict

import duckdb
from shapely.affinity import affine_transform
from shapely.geometry import LineString, Point, mapping, shape
from shapely.ops import unary_union
from shapely.strtree import STRtree

from lib import DATA, overpass, round_coords, write_geojson

K_LON, K_LAT = 84_000.0, 111_100.0
to_m = [K_LON, 0, 0, K_LAT, 0, 0]

# ---------- street-life signal groups (Overture taxonomy.primary) ----------
G = {
    "alcohol": {"bar", "pub", "cocktail_bar", "wine_bar", "beer_bar", "gastropub", "dance_club", "night_club", "lounge",
                "liquor_store", "brewery", "winery", "jazz_and_blues", "karaoke", "beer_garden", "sports_bar", "whiskey_bar"},
    "night": {"dance_club", "night_club", "music_venue", "karaoke", "jazz_and_blues", "comedy_club"},
    "creative": {"art_gallery", "bookstore", "antique_store", "second_hand_store", "vintage_clothing_store", "tattoo_and_piercing",
                 "coworking_space", "music_and_dvd_store", "comic_books_store", "theatre_venue", "coffee_roastery",
                 "architectural_designer", "graphic_designer", "interior_design", "product_design", "art_school", "arts_and_crafts_space",
                 "publisher", "photography_studio", "record_store", "musical_instrument_store"},
    "cafe": {"cafe", "coffee_shop", "bakery", "dessert_shop", "patisserie_cake_shop"},
    "mosque": {"muslim_place_of_worship"},
    "tea": {"tea_room", "hookah_bar"},
    "trade": {"wholesale_store", "wholesaler", "fabric_store", "textile_manufacturer", "jewelry_store", "carpet_store", "shopping",
              "jewelry_and_watches_manufacturer", "leather_goods_store", "luggage_store", "spice_shop", "market", "public_market",
              "flea_market", "farmers_market", "clothing_wholesaler", "office_supply_store", "hardware_store"},
    "upmarket": {"shopping_mall", "fashion_boutique", "corporate_or_business_office", "bank", "bank_or_credit_union",
                 "financial_service", "investing", "law_firm", "cosmetics_store", "designer_clothing", "luxury_goods",
                 "plastic_surgeon", "cosmetic_dentist", "advertising_agency", "marketing_agency", "public_relations"},
    "sights": {"historic_site", "museum", "history_museum", "art_museum", "landmark_and_historical_building", "monument",
               "souvenir_store", "tour_operator", "travel_service", "hotel", "hostel", "tourist_information_center"},
    "everyday": {"grocery_store", "barber", "automotive_repair", "auto_parts_store", "butcher_shop", "convenience_store",
                 "tire_shop", "auto_detailing", "automotive_service", "metal_fabricator", "laundromat", "tailor", "shoe_repair",
                 "beauty_salon", "pharmacy", "supermarket"},
    "seafood": {"seafood_restaurant", "fish_and_chips_restaurant", "fish_market"},
    "green": {"park", "botanical_garden", "national_park", "garden", "cemetery", "forest", "nature_reserve", "beach", "picnic_area"},
}
NAME_HINT = [(re.compile(r"meyhane", re.I), "alcohol"), (re.compile(r"kıraathane|kahvehane|çay ?bahçe", re.I), "tea")]

CLASSES = ["monumental", "market", "conservative", "bohemian", "nightlife", "village", "upmarket", "working", "residential", "green"]

# ---------- judgement overrides (only where the data can't see it; each with a reason) ----------
# Keys are mahalle names exactly as in data/mahalles.geojson (checked below; unknown names fail the run).
OVERRIDES = {
    # Tarlabaşı: dense, poor, busy inner-city streets just behind İstiklal; Overture under-records small workshops.
    "Bülbül Mahallesi": ("working", None, "mixed", "Tarlabaşı: dense inner city behind İstiklal (published research, Wikivoyage)"),
    "Kalyoncu Kulluğu Mahallesi": ("working", None, "mixed", "Tarlabaşı"),
    "Çukur Mahallesi": ("working", None, "mixed", "Tarlabaşı"),
    "Şehit Muhtar Mahallesi": ("working", "nightlife", "mixed", "Tarlabaşı edge; bars on the İstiklal side"),
    # Overture doesn't tag designer-brand shops distinctly, so Nişantaşı reads as ordinary shopping.
    "Teşvikiye Mahallesi": ("upmarket", None, "cosmopolitan", "Nişantaşı: designer-brand streets, smart cafés (Wikivoyage, press)"),
    "Harbiye Mahallesi": ("upmarket", "nightlife", "cosmopolitan", "Nişantaşı/Harbiye: brands, hotels, concert halls and bars"),
    # Kadıköy centre: the çarşı food-market streets; bar streets spill over from Caferağa.
    "Osmanağa Mahallesi": ("market", "nightlife", "cosmopolitan", "Kadıköy çarşı food market + bar streets (Wikivoyage)"),
    # The Süleymaniye complex dominates; few Overture records because much of it is one big monument.
    "Süleymaniye Mahallesi": ("monumental", "conservative", "mixed", "Süleymaniye Mosque complex and its old wooden streets"),
    "Cankurtaran Mahallesi": (None, None, "mixed", "Sultanahmet: the bars are hotel bars; street life is sights, not drinking"),
    "Alemdar Mahallesi": ("monumental", "market", "mixed", "Sultanahmet/Gülhane side; Cağaloğlu shops pull the data to market"),
    "Cihangir Mahallesi": ("bohemian", "nightlife", "cosmopolitan", "Cihangir: cafés, artists, old apartments (CLAUDE.md example)"),
    # Üsküdar centre: lots of cafés in the data, but it's the ferry/market hub with old mosques, not bohemian.
    "Mimar Sinan Mahallesi": ("market", "conservative", "mixed", "Üsküdar çarşı and ferry square"),
    "Aziz Mahmut Hüdayi Mahallesi": ("conservative", None, "mixed", "Old Üsküdar: mosques, tombs, tea gardens"),
    # Bağdat Caddesi side of Kadıköy: smart shopping street + sea-front parks.
    "Erenköy Mahallesi": ("upmarket", None, "cosmopolitan", "Bağdat Caddesi: brands, smart cafés (Wikivoyage)"),
    "Fenerbahçe Mahallesi": ("upmarket", "green", "cosmopolitan", "Fenerbahçe: well-off residential, seafront park"),
}


def load_coast():
    S, W, N, E = (40.94, 28.76, 41.32, 29.38)  # same query text as 00_study_area.py → cached response
    lines = []
    for w in overpass(f'[out:json][timeout:180];way({S},{W},{N},{E})["natural"="coastline"];out geom;')["elements"]:
        pts = [(p["lon"], p["lat"]) for p in w.get("geometry", [])]
        if len(pts) >= 2:
            lines.append(LineString(pts))
    return unary_union(lines)


def main():
    study = shape(json.loads((DATA / "study_area.geojson").read_text(encoding="utf-8"))["features"][0]["geometry"])
    mfc = json.loads((DATA / "mahalles.geojson").read_text(encoding="utf-8"))
    mah = [f for f in mfc["features"] if shape(f["geometry"]).intersects(study)]
    names = {f["properties"]["name"] for f in mah}
    unknown = [k for k in OVERRIDES if k not in names]
    if unknown:
        raise SystemExit(f"OVERRIDES names not in mahalles.geojson: {unknown}")
    geoms = [shape(f["geometry"]).buffer(0) for f in mah]
    tree = STRtree(geoms)

    # 1. count signals per mahalle
    con = duckdb.connect()
    rows = con.execute("SELECT cat, name, lon, lat FROM 'data/raw/overture_places.parquet' WHERE status IS NULL OR status = 'open'").fetchall()
    cnt = [Counter() for _ in mah]
    total = [0] * len(mah)
    for cat, name, lon, lat in rows:
        pt = Point(lon, lat)
        hits = [i for i in tree.query(pt) if geoms[i].contains(pt)]
        if not hits:
            continue
        i = hits[0]
        total[i] += 1
        for g, cats in G.items():
            if cat in cats:
                cnt[i][g] += 1
        for rx, g in NAME_HINT:
            if name and rx.search(name) and cat not in G[g]:
                cnt[i][g] += 1

    coast = load_coast()
    coast_m = affine_transform(coast, to_m)
    # 2. features
    feats = []
    for i, f in enumerate(mah):
        g = geoms[i]
        area_km2 = affine_transform(g.intersection(study), to_m).area / 1e6 or 1e-6
        n = total[i]
        share = {k: cnt[i][k] / n if n else 0 for k in G}
        c = g.centroid
        on_strait = (affine_transform(g, to_m).distance(coast_m) < 150 and c.y >= 41.035 and 29.0 <= c.x <= 29.16)
        feats.append(dict(i=i, name=f["properties"]["name"], district=f["properties"]["district"], n=n, area=area_km2,
                          dens=n / area_km2, share=share, cnt=cnt[i], on_strait=on_strait))

    med = {k: sorted(x["share"][k] for x in feats if x["n"] >= 30)[len([x for x in feats if x["n"] >= 30]) // 2] or 0.002 for k in G}
    dens_sorted = sorted(x["dens"] for x in feats)
    p75 = dens_sorted[int(len(dens_sorted) * 0.75)]

    def lift(x, k):
        return x["share"][k] / max(med[k], 0.002)

    # 3. rules → score per class (≥ 1.0 means "clearly this"); evidence string kept for review
    out = []
    for x in feats:
        c, sc = x["cnt"], {}
        thin = x["n"] < 30
        # Sights win where they clearly dominate (Sultanahmet has 140+ historic sites, hotels, museums).
        sc["monumental"] = (lift(x, "sights") / 2.0 + (0.6 if c["sights"] >= 90 else 0)) if c["sights"] >= 25 else 0
        sc["market"] = lift(x, "trade") / 2.2 if c["trade"] >= 30 else 0
        # Nightlife needs bars to really dominate; otherwise a café-and-gallery quarter with bars is bohemian.
        sc["nightlife"] = (lift(x, "alcohol") + lift(x, "night")) / 8.0 if c["alcohol"] >= 12 else 0
        sc["bohemian"] = (lift(x, "creative") + 0.5 * lift(x, "cafe")) / 2.8 if c["creative"] >= 10 else 0
        sc["upmarket"] = lift(x, "upmarket") / 2.4 if c["upmarket"] >= 25 else 0
        sc["conservative"] = ((lift(x, "mosque") + lift(x, "tea")) / 4.0 if c["alcohol"] <= 1 and c["mosque"] >= 4 else 0)
        sc["village"] = (1.0 + 0.3 * lift(x, "seafood")) if x["on_strait"] and x["dens"] < p75 * 1.5 else 0
        sc["working"] = (lift(x, "everyday") / 2.0 if x["dens"] >= p75 and x["district"] in ("Beyoğlu", "Fatih", "Şişli", "Kâğıthane", "Eyüpsultan")
                         and c["creative"] < 10 and c["sights"] < 25 else 0)
        # Forest/park land: very few venues over a big area. A fishing village on the strait is not "green".
        green = x["dens"] < 35 and x["area"] > 0.8 and not (x["on_strait"] and c["seafood"] >= 5)
        if thin or green:
            primary, secondary = ("green" if green else "residential"), None
        else:
            ranked = sorted(((v, k) for k, v in sc.items() if v >= 1.0), reverse=True)
            primary = ranked[0][1] if ranked else "residential"
            secondary = ranked[1][1] if len(ranked) > 1 and ranked[1][0] >= 0.7 * ranked[0][0] else None
        al, mq = c["alcohol"], c["mosque"] + c["tea"]
        if thin and not green:
            life = "mixed"
        elif al >= 10 and (al + 1) / (mq + 1) >= 1.8:  # hotel bars in Sultanahmet shouldn't make it "cosmopolitan"
            life = "cosmopolitan"
        elif al <= 1 and mq >= 3 and c["creative"] < 15:  # few bars alone isn't "traditional" in a café/gallery village
            life = "traditional"
        else:
            life = "mixed"
        note = ""
        if x["name"] in OVERRIDES:
            p2, s2, l2, why = OVERRIDES[x["name"]]
            primary, secondary, life = p2 or primary, s2 if p2 else secondary, l2 or life
            note = "override: " + why
        ev = (f"n={x['n']} dens={x['dens']:.0f}/km² bars={c['alcohol']} night={c['night']} creative={c['creative']} cafe={c['cafe']} "
              f"mosque={c['mosque']} tea={c['tea']} trade={c['trade']} upmarket={c['upmarket']} sights={c['sights']} "
              f"everyday={c['everyday']} seafood={c['seafood']} strait={x['on_strait']}")
        out.append(dict(x, primary=primary, secondary=secondary, lifestyle=life, evidence=ev, note=note,
                        scores={k: round(v, 2) for k, v in sc.items() if v}))

    # 4. per-mahalle CSV for review
    with open(DATA / "mahalle_character.csv", "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["mahalle", "district", "primary", "secondary", "lifestyle", "evidence", "scores", "note"])
        for o in sorted(out, key=lambda o: (o["district"], o["name"])):
            w.writerow([o["name"], o["district"], o["primary"], o["secondary"] or "", o["lifestyle"], o["evidence"], o["scores"], o["note"]])

    # 5. merge neighbouring mahalles with the same primary + lifestyle into character areas, clipped to the study area
    groups = defaultdict(list)
    for o in out:
        groups[(o["primary"], o["lifestyle"])].append(o)
    areas = []
    for (prim, life), members in groups.items():
        merged = unary_union([geoms[o["i"]].buffer(0.00005) for o in members]).buffer(-0.00005).intersection(study)
        parts = list(merged.geoms) if merged.geom_type == "MultiPolygon" else [merged]
        for part in parts:
            if part.area < 1e-7:
                continue
            inside = [o for o in members if geoms[o["i"]].representative_point().within(part.buffer(0.0002))]
            sec = Counter(o["secondary"] for o in inside if o["secondary"]).most_common(1)
            areas.append({"type": "Feature", "properties": {
                "id": f"{prim}-{life}-{len(areas)}", "primary": prim, "secondary": sec[0][0] if sec else None, "lifestyle": life,
                "mahalles": [o["name"] for o in inside], "evidence": "Overture Places 2026-10-21.0 mix per mahalle (see mahalle_character.csv)",
                "notes": "; ".join(o["note"] for o in inside if o["note"]),
                "source": "osm admin_level=8 mahalles, classified by scripts/07_areas.py"},
                "geometry": round_coords(mapping(part.simplify(0.0001)), 5)})
    write_geojson(DATA / "areas.geojson", areas)

    # 6. places inherit character + lifestyle from their mahalle (unless they already carry an explicit override)
    pf = DATA / "places.geojson"
    pfc = json.loads(pf.read_text(encoding="utf-8"))
    for f in pfc["features"]:
        pt = Point(f["geometry"]["coordinates"])
        hits = [i for i in tree.query(pt) if geoms[i].contains(pt)]
        if not hits:
            # Bridges, piers and gaps in the OSM mahalle layer: name them after the nearest mahalle
            # (within ~1.5 km) so cards never say "?", but don't give them its character.
            j = int(tree.nearest(pt))
            if geoms[j].distance(pt) < 0.015 and any(o["i"] == j for o in out):
                o = next(o for o in out if o["i"] == j)
                f["properties"]["mahalle"] = o["name"].replace(" Mahallesi", "")
                if f["properties"].get("area") in (None, "", "?"):
                    f["properties"]["area"] = o["district"]
            continue
        o = next(o for o in out if o["i"] == hits[0])
        p = f["properties"]
        p["mahalle"] = o["name"].replace(" Mahallesi", "")
        if not (p.get("character") or {}).get("override"):
            p["character"] = {"primary": o["primary"], "secondary": o["secondary"]}
        p["lifestyle"] = o["lifestyle"]
    pf.write_text(json.dumps(pfc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    print("mahalles:", len(out), "areas:", len(areas))
    print("primary:", Counter(o["primary"] for o in out).most_common())
    print("lifestyle:", Counter(o["lifestyle"] for o in out).most_common())


if __name__ == "__main__":
    main()
