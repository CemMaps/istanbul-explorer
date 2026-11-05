"""Replace the 60-day pageview signal with a robust 12-month one and recompute fame.
pageviews_12m = median monthly views (Nov 2025 – Oct 2026) × 12, so a single spike month
(news, an incident) can't inflate a place. Falls back to pageviews_60d × 6 when the API has no data.
Polite: ~1 request/second; responses cached under data/raw/pv12_*."""
import json
import math
import statistics
import time
import urllib.parse

from lib import DATA, http_json

WORK = DATA / "work"
path = WORK / "candidates.json"
cands = json.loads(path.read_text(encoding="utf-8"))

titles = sorted({c["wikipedia"] for c in cands if c["wikipedia"]})
annual = {}
for i, t in enumerate(titles):
    url = ("https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/"
           + urllib.parse.quote(t.replace(" ", "_"), safe="") + "/monthly/20251101/20261031")
    try:
        months = [x["views"] for x in http_json(url, cache="pv12", retries=4, timeout=60).get("items", [])]
        months += [0] * (12 - len(months))  # missing months = no views
        annual[t] = int(statistics.median(months) * 12)
    except RuntimeError:
        annual[t] = None
    if i % 50 == 0:
        print(f"  12-month pageviews {i}/{len(titles)}")
    time.sleep(0.8)

for c in cands:
    v = annual.get(c["wikipedia"]) if c["wikipedia"] else 0
    c["pageviews_12m"] = v if v is not None else (c.get("pageviews_60d") or 0) * 6
    c["pageviews_basis"] = "median-month x12" if v is not None else ("60d x6 fallback" if c["wikipedia"] else "no article")

max_sl = max(math.log1p(c["sitelinks"]) for c in cands)
max_pv = max(math.log1p(c["pageviews_12m"]) for c in cands)
for c in cands:
    c["fame"] = round(1 + 4 * (0.5 * math.log1p(c["sitelinks"]) / max_sl + 0.5 * math.log1p(c["pageviews_12m"]) / max_pv), 2)
cands.sort(key=lambda x: -x["fame"])
path.write_text(json.dumps(cands, ensure_ascii=False, indent=1), encoding="utf-8")
print("done:", sum(1 for v in annual.values() if v is not None), "of", len(titles), "articles had 12-month data")
print("top 15:", [(c["name"], c["fame"]) for c in cands[:15]])
