"""Photo galleries + credits. Run after 04_build_places.py (it rewrites photos).
- must-see / worth-it: up to 6 photos from the place's English Wikipedia article (editor-curated, usually good),
  led by the Wikidata image (P18).
- every photo: author + licence from Commons (extmetadata); files Commons doesn't know are dropped (broken).
Writes back into data/places.geojson."""
import html
import json
import re
import time
import urllib.parse

from lib import DATA, http_json

MAX_PHOTOS = 6
SKIP = re.compile(r"\.(svg|gif|tif|tiff|webm|ogg|ogv|pdf|png)$|map|plan|logo|flag|coat[_ ]of|seal[_ ]of|icon|locator|diagram|"
                  r"symbol|signature|commons-logo|wiki|portrait[_ ]of|stamp|banknote|coin|inscription|district|reconstruct|"
                  r"model|drawing|engraving|painting|sketch|lithograph|postcard|1[5-8]\d\d|schema|section|elevation", re.I)
STOP = {"the", "of", "and", "mosque", "palace", "museum", "istanbul", "tower", "park", "church", "camii", "sarayi"}


def relevance(file, p):
    # Files whose name mentions the place come first (Wikipedia lists images alphabetically, not by quality).
    words = {w for w in re.findall(r"[a-zçğıöşü]{4,}", (p["name"] + " " + (p.get("name_tr") or "")).lower()) if w not in STOP}
    f = file.lower()
    return -sum(w in f for w in words)
path = DATA / "places.geojson"
fc = json.loads(path.read_text(encoding="utf-8"))
feats = fc["features"]


def api(site, **params):
    url = f"https://{site}/w/api.php?" + urllib.parse.urlencode({"format": "json", "formatversion": 2, **params})
    return http_json(url, cache="photos", retries=5, timeout=60)


def clean(file):
    return urllib.parse.unquote(file).replace("_", " ")


# 1. galleries for the top tiers
top = [f for f in feats if f["properties"]["tier"] in ("must-see", "worth-it") and f["properties"].get("wikipedia")]
for i, f in enumerate(top):
    p = f["properties"]
    d = api("en.wikipedia.org", action="query", prop="images", titles=p["wikipedia"], imlimit=60, redirects=1)
    files = [im["title"].split(":", 1)[1] for pg in d.get("query", {}).get("pages", []) for im in pg.get("images", [])]
    files = [x for x in files if x.lower().endswith((".jpg", ".jpeg", ".png", ".webp")) and not SKIP.search(x)]
    lead = [clean(p["photos"][0]["file"])] if p["photos"] else []
    rest = sorted((x for x in files if x not in lead), key=lambda x: relevance(x, p))  # stable: ties keep order
    gallery = lead + rest
    p["photos"] = [{"file": x} for x in gallery[:MAX_PHOTOS + 4]]  # a few spare in case some are dropped below
    if i % 40 == 0:
        print(f"  galleries {i}/{len(top)}")
    time.sleep(0.2)

# 2. credits + existence check for every file
allfiles = sorted({clean(ph["file"]) for f in feats for ph in f["properties"]["photos"]})
meta = {}
for i in range(0, len(allfiles), 50):
    batch = allfiles[i:i + 50]
    d = api("commons.wikimedia.org", action="query", prop="imageinfo", iiprop="extmetadata|size",
            iiextmetadatafilter="Artist|LicenseShortName|ImageDescription", titles="|".join("File:" + x for x in batch))
    q = d.get("query", {})
    norm = {n["to"]: n["from"] for n in q.get("normalized", [])}
    for pg in q.get("pages", []):
        if pg.get("missing") or "imageinfo" not in pg:
            continue
        ii = pg["imageinfo"][0]
        em = ii.get("extmetadata", {})
        artist = re.sub(r"<[^>]+>", "", html.unescape(em.get("Artist", {}).get("value", ""))).strip()
        name = pg["title"].split(":", 1)[1]
        meta[norm.get(pg["title"], pg["title"]).split(":", 1)[1]] = meta[name] = {
            "author": re.sub(r"\s+", " ", artist)[:80] or "Unknown",
            "licence": em.get("LicenseShortName", {}).get("value", "see Commons"),
            "w": ii.get("width"), "h": ii.get("height"),
        }
    time.sleep(0.3)

dropped = kept = 0
for f in feats:
    out = []
    for ph in f["properties"]["photos"]:
        m = meta.get(clean(ph["file"]))
        # drop missing files and tiny/very tall images (bad in a wide gallery)
        if not m or (m["w"] and m["w"] < 600) or (m["w"] and m["h"] and m["h"] > m["w"] * 1.6):
            dropped += 1
            continue
        out.append({"file": clean(ph["file"]), "author": m["author"], "licence": m["licence"]})
    f["properties"]["photos"] = out[:MAX_PHOTOS]
    kept += len(f["properties"]["photos"])

path.write_text(json.dumps(fc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print(f"photos kept {kept}, dropped {dropped}; places with ≥2 photos:",
      sum(1 for f in feats if len(f["properties"]["photos"]) >= 2), "with none:", sum(1 for f in feats if not f["properties"]["photos"]))
