"""Final pass on data/places.geojson (run after 07_areas.py; safe to re-run).

1. Drops entries that are not places you can visit: events, councils, hoaxes, organisations,
   demolished buildings, consulates, a hotel, schools (judgement list below, reviewed 2026-11-06).
2. Adds `kind` to every "Mosques & churches" place (mosque / church / synagogue / monastery / tomb),
   so churches stop being labelled "Mosque". Name words win; Wikidata classes decide the rest.
3. Adds `summary`: the first one or two sentences of the English Wikipedia intro (≤ ~55 words),
   falling back to the Wikidata description. `summary_source` says which.
4. Re-files the two "Food & drink" entries (both are pavilions, not food places).
"""
import json
import re
import urllib.parse

from lib import DATA, http_json, write_geojson

DROP = {
    "2024-istanbul-church-shooting": "an event, not a place",
    "council-of-blachernae": "a church council (event)",
    "prank-of-bardakci-baba": "a hoax",
    "bulgarian-exarchate": "an organisation",
    "research-centre-for-islamic-history-art-and-cult": "an organisation",
    "women-s-museum-istanbul": "virtual museum, nothing to visit",
    "church-of-the-holy-apostles": "demolished in 1461 (Fatih Mosque stands there)",
    "great-palace-of-constantinople": "demolished; nothing to visit as such",
    "imperial-library-of-constantinople": "lost ancient library",
    "old-palace": "demolished",
    "nea-ekklesia": "demolished",
    "church-of-the-virgin-of-the-pharos": "demolished",
    "pangalti-armenian-cemetery": "former cemetery, gone",
    "balaban-aga-mosque": "demolished",
    "enderun-school": "part of Topkapı Palace",
    "hilton-istanbul-bosphorus": "a hotel",
    "diamond-of-istanbul": "an office tower",
    "camlica-trt-television-tower": "duplicate of Çamlıca Tower",
    "venetian-palace": "consulate, not open",
    "palais-de-france": "consulate residence, not open",
    "mekteb-i-asiret-i-humayun": "a school",
    "surp-hac-ermeni-lisesi": "a school",
}
REFILE = {}  # 2026-11-06: the two pavilions are re-filed in the data already; real food comes from 10_food.py

cands = {c["qid"]: c for c in json.loads((DATA / "work" / "candidates.json").read_text(encoding="utf-8"))}


def kind(p):
    n = p["name"].lower() + " " + (p.get("name_tr") or "").lower()
    cl = " | ".join(cands.get(p["wikidata"], {}).get("classes", [])).lower()
    if re.search(r"mosque|camii|cami\b|mescit", n):
        return "mosque"
    if re.search(r"church|cathedral|basilica|kilise|chapel", n):
        return "church"
    if re.search(r"synagogue|sinagog|havra", n) or "synagogue" in cl:
        return "synagogue"
    if re.search(r"monastery|manast", n):
        return "monastery"
    if re.search(r"türbe|turbe|tomb|mausoleum", n) or re.search(r"türbe|mausoleum", cl):
        return "tomb"
    if "mosque" in cl:
        return "mosque"
    if re.search(r"church|cathedral|basilica", cl):
        return "church"
    if "monastery" in cl:
        return "monastery"
    return "mosque"


def extracts(titles):
    out = {}
    for i in range(0, len(titles), 20):  # extracts allow 20 pages per call
        batch = titles[i:i + 20]
        url = "https://en.wikipedia.org/w/api.php?" + urllib.parse.urlencode({
            "action": "query", "prop": "extracts", "exintro": 1, "explaintext": 1,
            "exlimit": 20, "redirects": 1, "format": "json", "formatversion": 2, "titles": "|".join(batch)})
        q = http_json(url, cache="wpext", retries=5, timeout=60).get("query", {})
        back = {}
        for r in q.get("normalized", []) + q.get("redirects", []):
            back[r["to"]] = back.get(r["from"], r["from"])
        for pg in q.get("pages", []):
            t = pg.get("title")
            out[back.get(t, t)] = pg.get("extract") or ""
    return out


def trim(text, max_words=48):
    text = text.split("\n")[0] if len(text.split("\n")[0].split()) >= 12 else text  # first paragraph
    # Wikipedia sometimes leaves the opening bracket of a pronunciation or other-names aside unclosed:
    # then cut from that bracket up to the main verb ("Mecidiyeköy (Turkish pronunciation: [..] is a ...").
    if text.count("(") + text.count("[") > text.count(")") + text.count("]"):
        text = re.sub(r"\s*\(.*?,?(?=\s+(?:is|was|are|were)\s)", "", text, count=1)
    # Drop everything inside brackets (pronunciations, other names, dates), nested ones too.
    out, depth = [], 0
    for ch in text:
        if ch in "([":
            depth += 1
        elif ch in ")]" and depth:
            depth -= 1
        elif not depth:
            out.append(ch)
    text = re.sub(r"\s+", " ", "".join(out)).strip()
    text = re.sub(r"\s+([,.;:])", r"\1", text)
    sents = re.split(r"(?<=[a-z0-9”\"'])\.\s+(?=[A-Z])", text)
    sents = [s if s.endswith(".") else s + "." for s in sents if s]
    sents = sents[:1] + [s for s in sents[1:] if not re.search(r"\bpopulation\b|\bcensus\b", s, re.I)]
    out = ""
    for s in sents:
        if out and len((out + " " + s).split()) > max_words:
            break
        out = (out + " " + s).strip()
    if len(out.split()) > max_words:  # one very long first sentence: cut at a clause
        words = out.split()[:max_words]
        out = " ".join(words).rstrip(",;:") + "…"
    return out


def norm_first(name):
    return re.sub(r"[^\w]", "", name.split()[0].lower())


pf = DATA / "places.geojson"
fc = json.loads(pf.read_text(encoding="utf-8"))
before = len(fc["features"])
feats = [f for f in fc["features"] if f["properties"]["id"] not in DROP]
titles = sorted({f["properties"]["wikipedia"].replace("_", " ") for f in feats if f["properties"].get("wikipedia")})
ext = extracts(titles)

n_wp = 0
for f in feats:
    p = f["properties"]
    p["category"] = REFILE.get(p["category"], p["category"])
    if p["category"] == "Mosques & churches":
        p["kind"] = kind(p)
    elif p["category"] != "Food & drink":  # food keeps its own kind (10_food.py)
        p.pop("kind", None)
    t = (p.get("wikipedia") or "").replace("_", " ")
    s = trim(ext.get(t, "")) if t else ""
    # A food place's article must be about it (not its district), and not about a place that has closed.
    if p["category"] == "Food & drink" and s and (norm_first(p["name"]) not in s.lower() or re.search(r"^[^.]*\b(was|were) a\b", s)):
        if re.search(r"^[^.]*\b(was|were) a\b", s):
            p["closed"] = True
        s = ""
    if len(s.split()) >= 8:
        p["summary"], p["summary_source"] = s, f"wikipedia:{p['wikipedia']}"
        n_wp += 1
    elif p.get("blurb") and not re.search(r"wikimedia|^mahalle|^quarter in|^district of", p["blurb"], re.I):
        b = p["blurb"].strip()
        p["summary"], p["summary_source"] = b[0].upper() + b[1:] + ("" if b.endswith(".") else "."), f"wikidata:{p['wikidata']}"
    elif (p.get("summary_source") or "").startswith("generated:kind"):
        pass  # food from Overture: keep the short kind line from 10_food.py
    elif p["category"] == "Neighbourhoods":
        side = "Asian" if p.get("shore") == "asia" else "European"
        p["summary"], p["summary_source"] = f"A neighbourhood of {p['area']}, on the {side} side.", "generated:area"
    else:
        p["summary"], p["summary_source"] = None, None

feats = [f for f in feats if not f["properties"].pop("closed", False)]  # closed food places (Wikipedia says "was a …")
write_geojson(pf, feats)
from collections import Counter
print(f"places: {before} -> {len(feats)} (dropped {before - len(feats)})")
print("kinds:", dict(Counter(f["properties"].get("kind") for f in feats if f["properties"].get("kind"))))
print(f"summaries: {n_wp} from Wikipedia, {sum(1 for f in feats if (f['properties'].get('summary_source') or '').startswith('wikidata'))} from Wikidata")
