"""Pull candidate places from Wikidata inside the study-area bbox, then add 12-month EN pageviews.
Writes data/work/candidates.json. Coordinates come from Wikidata P625 only."""
import json
import math
import re
import time
import urllib.parse
from collections import Counter

from lib import BBOX, DATA, http_json, sparql

S, W, N, E = BBOX
MIN_SITELINKS = 4  # fame floor for candidates; everything above is reviewed, not auto-included
WORK = DATA / "work"
WORK.mkdir(exist_ok=True)

Q = f"""
SELECT ?item ?sl ?loc ?img ?commons ?enwiki ?en ?tr (GROUP_CONCAT(DISTINCT ?cl; separator="|") AS ?classes) WHERE {{
  SERVICE wikibase:box {{
    ?item wdt:P625 ?loc .
    bd:serviceParam wikibase:cornerSouthWest "Point({W} {S})"^^geo:wktLiteral ;
                    wikibase:cornerNorthEast "Point({E} {N})"^^geo:wktLiteral .
  }}
  ?item wikibase:sitelinks ?sl . FILTER(?sl >= {MIN_SITELINKS})
  ?item wdt:P31 ?c . ?c rdfs:label ?cl . FILTER(lang(?cl) = "en")
  OPTIONAL {{ ?item rdfs:label ?en FILTER(lang(?en) = "en") }}
  OPTIONAL {{ ?item rdfs:label ?tr FILTER(lang(?tr) = "tr") }}
  OPTIONAL {{ ?item wdt:P18 ?img }}
  OPTIONAL {{ ?item wdt:P373 ?commons }}
  OPTIONAL {{ ?enwiki schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> }}
}} GROUP BY ?item ?sl ?loc ?img ?commons ?enwiki ?en ?tr
"""

# Class-label keywords → app category. First match wins; order matters.
RULES = [
    ("Mosques & churches", r"mosque|church|cathedral|synagogue|monastery|basilica|chapel|türbe|mausoleum|tekke|dervish|cemevi|shrine"),
    ("Palaces & museums", r"palace|museum|pavilion|kiosk|köşk|art gallery|library|mansion|yalı|konak|ham+am|bathhouse|cistern|madrasa|medrese|caravanserai|han\b|archaeological|"
                          r"ancient city|monument|column|obelisk|historic building|theatre|opera|concert hall|performing arts"),
    ("Viewpoints", r"tower|observation|viewpoint|lighthouse|hill"),
    ("Bazaars & markets", r"bazaar|market|arcade|shopping street|çarşı|shopping center"),
    ("Parks & waterfront", r"park|garden|grove|forest|square|promenade|beach|pier|quay|waterfront|cemetery|fountain"),
    ("Fortifications", r"fortress|fortification|castle|city wall|wall|gate|aqueduct|bridge"),
    ("Neighbourhoods", r"neighbo|quarter|mahalle|district|human settlement|village|street|avenue"),
    ("Food & drink", r"restaurant|café|cafe|coffeehouse|patisserie|bakery|meyhane"),
]
# Classes that are never visitor attractions here.
EXCLUDE = r"school|university|hospital|stadium|metro station|railway station|tram stop|bus|airport|hotel|company|" \
          r"office|consulate|embassy|government|ministry|military|prison|television|radio|sports club|" \
          r"electoral|administrative|municipality|ship|shipwreck|high-rise|skyscraper|residential building|tunnel|road|highway"


def classify(classes):
    joined = " | ".join(classes).lower()
    for cat, pat in RULES:
        if re.search(pat, joined):
            return cat
    return None


def main():
    rows = sparql(Q)["results"]["bindings"]
    items = {}
    for r in rows:
        qid = r["item"]["value"].rsplit("/", 1)[1]
        if qid in items:
            continue
        lon, lat = map(float, re.findall(r"[-\d.]+", r["loc"]["value"])[:2])
        classes = r["classes"]["value"].split("|")
        enwiki = r.get("enwiki", {}).get("value")
        items[qid] = {
            "qid": qid,
            "name": r.get("en", {}).get("value"),
            "name_tr": r.get("tr", {}).get("value"),
            "lon": lon, "lat": lat,
            "sitelinks": int(r["sl"]["value"]),
            "classes": classes,
            "image": r.get("img", {}).get("value"),
            "commons": r.get("commons", {}).get("value"),
            "wikipedia": urllib.parse.unquote(enwiki.rsplit("/", 1)[1]) if enwiki else None,
        }
    print("wikidata items in bbox (sitelinks ≥ %d):" % MIN_SITELINKS, len(items))

    kept, excluded, unmatched = [], Counter(), Counter()
    for it in items.values():
        joined = " | ".join(it["classes"]).lower()
        cat = classify(it["classes"])
        if re.search(EXCLUDE, joined) and cat not in ("Mosques & churches", "Palaces & museums", "Viewpoints"):
            excluded.update(it["classes"])
            continue
        if not cat:
            unmatched.update(it["classes"])
            continue
        it["category"] = cat
        kept.append(it)
    print("candidates after class rules:", len(kept))

    # EN Wikipedia pageviews, last 60 days, 50 titles per request via the Action API
    # (the per-article REST endpoint rate-limits generic clients with HTTP 429).
    # Stored as pageviews_60d; only used for relative ranking within the candidate set.
    titles = sorted({it["wikipedia"] for it in kept if it["wikipedia"]})  # stable batches → cache reuse
    views = {}
    for i in range(0, len(titles), 50):
        batch = titles[i:i + 50]
        url = "https://en.wikipedia.org/w/api.php?" + urllib.parse.urlencode({
            "action": "query", "prop": "pageviews", "pvipdays": 60, "redirects": 1,
            "titles": "|".join(batch), "format": "json", "formatversion": 2})
        d = http_json(url, cache="pv60", retries=5, timeout=60)
        q = d.get("query", {})
        alias = {n["to"]: n["from"] for n in q.get("normalized", []) + q.get("redirects", [])}
        for p in q.get("pages", []):
            total = sum(v or 0 for v in (p.get("pageviews") or {}).values())
            t = p.get("title")
            while t in alias:  # map back through redirects/normalisation to the requested title
                views[t] = total
                t = alias[t]
            views[t] = total
        print(f"  pageviews {min(i + 50, len(titles))}/{len(titles)}")
        time.sleep(3)
    for it in kept:
        it["pageviews_60d"] = views.get(it["wikipedia"], 0) if it["wikipedia"] else 0

    # Fame score 1–5: half sitelinks, half log pageviews, both scaled against the candidate set.
    max_sl = max(math.log1p(it["sitelinks"]) for it in kept)
    max_pv = max(math.log1p(it["pageviews_60d"] or 0) for it in kept)
    for it in kept:
        s_sl = math.log1p(it["sitelinks"]) / max_sl
        s_pv = math.log1p(it["pageviews_60d"] or 0) / max_pv if max_pv else 0
        it["fame"] = round(1 + 4 * (0.5 * s_sl + 0.5 * s_pv), 2)
    kept.sort(key=lambda x: -x["fame"])

    (WORK / "candidates.json").write_text(json.dumps(kept, ensure_ascii=False, indent=1), encoding="utf-8")
    (WORK / "unmatched_classes.json").write_text(
        json.dumps(unmatched.most_common(80), ensure_ascii=False, indent=1), encoding="utf-8")
    print("by category:", dict(Counter(it["category"] for it in kept)))
    print("top unmatched classes:", unmatched.most_common(25))


if __name__ == "__main__":
    main()
