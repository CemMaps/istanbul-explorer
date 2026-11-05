# Our Istanbul Tour — project memory

Re-read this file at the start of every session and keep it current.

## Goal
A small, beautiful, phone-only web map for Cem, Lucy and Michelle's Istanbul trip, shared via WhatsApp.
Browse photos, heart places, loosely plan each day, and see what's around you during the trip.
Consumer feel (Airbnb-style), not a GIS analysis tool. Beauty, photos and simplicity beat features.
Cem tends to overbuild: hold to scope.

## The weather / sunset layer (nice-to-have, not the centrepiece)
Places carry `best_time` and `indoor`. The app uses the Open-Meteo forecast and sunset (SunCalc) to:
a "Right now" suggestion card, a "Suggested" day order, and a weather chip per planned stop.
Keep it light; it supports exploring, it is not the main point.

## Trip facts
- Dates: **Fri 27 Nov 2026 – Mon 30 Nov 2026** (4 day tabs: Fri, Sat, Sun, Mon).
- Arrival Fri 16:15 at [IST or SAW — TO CONFIRM]. Departure Mon 22:00 from [SAW? — TO CONFIRM].
- Last-day airport buffer: [TO CONFIRM].
- Stay: a flat on **Hüseyin Ağa Bahçe Sokağı, Beyoğlu** (Cihangir / Firuzağa side, just below İstiklal).
  Coordinates: street centre 41.03098, 28.98062, source `osm:way/183820655`. [House number would make it exact — optional.]
- Time zone: `Europe/Istanbul`, UTC+3 all year (Turkey has no DST since 2016).
- Sun (computed, NOAA algorithm, Beyoğlu): sunrise ≈ 08:05–08:09, **sunset ≈ 17:37–17:38** on all four days.
  Golden hour ≈ 16:50–17:37. Mornings are dark-ish until 08:00.
- People (share-link names): **Cem, Lucy, Michelle**. No kids; everyone walks well.
- Food: no dietary requirements, but one person avoids red meat and likes vegetarian dishes → food entries flag `veggie_friendly` / fish options.

## Guardrails
- Phone only, 360–430 px. Wider screens: same layout centred at ~430 px. No desktop/tablet layout.
- Static site, no backend, no accounts, no database. Plain HTML/CSS/JS, CDN libs pinned to exact versions. No bundler without asking.
- MapLibre GL JS + free keyless light basemap (CARTO Positron/Voyager) with attribution. Style needs a `glyphs` URL.
- No Google data in the dataset. Google = "Open in Google Maps" link only (`https://www.google.com/maps/search/?api=1&query=<lat>,<lng>`).
- Never invent coordinates. Every point has a `source`. No source → drop or flag.
- No API keys in client code, no runtime AI calls. "Suggested" order is a local heuristic.
- No opening hours, prices or booking info. One short tip line max.
- No transit/routing. Transport may come later as its own layer; Google Maps covers it for now.
- **No distance-from-hotel logic.** No proximity scoring, no day-trip thresholds. We'll go anywhere; the map is for exploring.
- GeoJSON, EPSG:4326, [lng, lat]. Small enough to load in one go.
- Saving = localStorage. Sharing = URL snapshot links only.
- Git: commit at the end of every phase.
- **Modular:** layers, categories and character tags are config-driven, so a new class of thing or a new layer
  is "add a GeoJSON + a registry entry", not a rewrite (see Architecture).

## Skills allowlist
Use only: `gis-app-kit` (first), `frontend-design`, `cartography-geoviz`, `geo-data-engineering`.
Ignore all other skills, plugins and MCP tools. Built-in browser pane OK for phone-width visual checks.

## Decisions (Phase 0, 2026-11-05)
| Topic | Decision |
|---|---|
| App name | **Our Istanbul Tour** (may change; lives in theme) |
| Data stack | Wikidata (backbone), Wikimedia pageviews + sitelinks (popularity), Commons (photos), Wikivoyage (research only, own words), Overture Places (cross-check only). **No OSM** except the flat's location. |
| Place count | No fixed cap. Cover the main things well; quality first. Less prominent places are visually quieter (smaller, later zoom), so the map never feels crowded. |
| Tiers | `must-see`, `worth-it`, `bonus`. No hidden-gem tier, no day trips. |
| "Vibe" | Means the **character / texture of the area** (see Character tags). Proposed list awaits Cem's edit. |
| Lines | **Walks** + **boat trips** (cruises), not ferry transport. |
| Filters | Non-matching pins dim to ~25%. Try first, revisit. |
| Turkish names | [TO CONFIRM — default: small second line under the English name] |
| Palette & fonts | Keep: navy #14213D, Iznik cobalt #1F4FA3, pomegranate #C4462E, map ground #EEEBE3; Bricolage Grotesque + Inter. All in `app/theme.json`. |
| Theme presets | Ship current look first; more presets later (proposed: Bosphorus at Night, Tea & Simit, Tile White, Gül). |
| Edit mode | `?edit=1` (hidden, not secure). |
| Mock forecast | Opt-in toggle (edit mode or `?mockweather=1`), always labelled "Sample forecast". Never shown by default. |
| Photo credits | No credit on each photo. Author + licence kept in data, shown on one small "Photo credits" screen. |
| Sharing | Snapshot links (no live sync). |
| Hosting | Later. Likely GitHub Pages (static). Must be https for geolocation. |
| Mockup tweaks (agreed) | Google Maps button = quiet secondary with official pin icon; plan step numbers in cobalt (not red); filter chips show an active count. |

## Character tags (proposed — Cem to edit)
The feel of the part of the city a place sits in. Stored per area in `data/areas.json`, inherited by places, overridable per place.
- **Grand & historic** — imperial monuments, big squares (Sultanahmet)
- **Traditional & devout** — conservative, everyday religious life (Fatih/Çarşamba, Eyüp, parts of Üsküdar)
- **Market bustle** — crowded trading streets (Eminönü, Tahtakale, bazaar quarter)
- **Bohemian & arty** — cafés, galleries, old houses (Cihangir, Balat, Kuzguncuk, Moda)
- **Lively & young** — bars, nightlife, students (Kadıköy, Beyoğlu side streets, Karaköy)
- **Waterfront & breezy** — promenades, tea by the sea (Ortaköy, Bebek, Moda shore)
- **Polished & upmarket** — boutiques, smart cafés (Nişantaşı, Bebek)

## Categories (pin icons)
Mosques & churches · Palaces & museums · Viewpoints · Bazaars & markets · Food & drink · Neighbourhoods · Parks & waterfront.
Line layers: Walks · Boat trips. Fixed: the flat, airports.

## Architecture (modular)
- `app/layers.json` — layer registry: id, file, geometry, symbology key, zoom rules, filterable fields, card template.
- `app/categories.json` — categories (icon, colour token), character tags, chips. Add a class = add an entry.
- `app/theme.json` + `app/themes/` — all visual tokens as CSS custom properties. QA fails on hard-coded hex/font names outside theme files.
- `data/*.geojson` — one file per layer. `data/areas.json` — area → shore, character tags.
- `scripts/` — acquisition + QA (Python, run locally). `qa/index.html` — QA map + table.

## Data schema
`data/places.geojson` properties:
`id` (slug) · `name` · `name_tr` · `category` · `character` (array, defaults from area) · `tier` · `score` (1–5) + `score_basis` ·
`area` · `shore` (`europe`/`asia`) · `blurb` (≤25 words, own words) · `tip` (optional) · `indoor` (bool) ·
`best_time` (`morning`/`midday`/`afternoon`/`golden-hour`/`evening`/`any`) · `dishes` (food only) · `veggie_friendly` (food only) ·
`wikidata` · `wikipedia` · `photos` [{file, author, licence}] · `source` · `qa`.

`data/walks.geojson`: `id`, `name`, `blurb`, `character`, `best_time`, `length_km` (computed), `photos`, `approx: true`.
`data/boat_trips.geojson`: `id`, `name`, `blurb`, `best_time`, `duration_hint`, piers from sourced coordinates, `approx: true` for the route line.
`data/fixed.geojson`: the flat, arrival airport, departure airport.
`data/study_area.geojson`: Bosphorus-centred study polygon for QA outlier checks.

Score = sitelinks + log 12-month EN pageviews + Wikivoyage "See" presence, sanity-checked by judgement (flag gaps ≥ 2 points).
Prominence on the map: `must-see` shows from low zoom; `worth-it` mid zoom; `bonus` close zoom, smaller and quieter.

## Phases
- [x] Phase 0 — setup, questions, CLAUDE.md, scaffold, git init
- [ ] Phase 1 — research & data (Wikidata → scores → tiers → photos → blurbs → walks & boat trips)
- [ ] Phase 2 — QA script + `qa/index.html` 🛑 Cem reviews
- [ ] Phase 3 — theme tokens, Explore + Place card 🛑 Cem tests on phone
- [ ] Phase 4 — Plan, weather, Right now, Saved & share 🛑 Cem tests on phone
- [ ] Phase 5 — presets, edit mode, states, a11y, deploy

Backlog (don't build unless asked): prayer times, food tick-list, Turkish phrases, PWA install, transport layer, live sync.

## Lessons
- **Non-ASCII in shell curl args breaks on Windows** (2026-11-05): Turkish names (ğ, ı, ü) in Overpass/Nominatim queries passed via Git Bash `curl` returned empty results. Do HTTP in Python (`urllib`, UTF-8) and run with `PYTHONIOENCODING=utf-8`, or fuzzy-match names locally after an ASCII-only bbox query.
- **Istanbul winter sunset is ~17:37, not ~16:40** (2026-11-05): Turkey is on permanent UTC+3, so clock sunsets are an hour later than old EET-based figures. Always compute (SunCalc/NOAA); never quote from memory.
- **Overpass can 502 transiently** (2026-11-05): cache raw responses in the scratchpad/`data/raw/` and retry with backoff.
