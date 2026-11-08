# Our Istanbul Tour — project memory

Re-read this file at the start of every session and keep it current.

## Goal
A small, beautiful, phone-only web map for Cem, Lucy, Michele and Coş's Istanbul trip, shared via WhatsApp.
Browse photos, heart places, loosely plan each day, and see what's around you during the trip.
Consumer feel (Airbnb-style), not a GIS analysis tool. Beauty, photos and simplicity beat features.
Cem tends to overbuild: hold to scope.

## The weather / sunset layer (nice-to-have, not the centrepiece)
Places carry `best_time` and `indoor`. The app uses the Open-Meteo forecast and sunset (SunCalc) to:
a "Right now" suggestion card, a "Suggested" day order, and a weather chip per planned stop.
Keep it light; it supports exploring, it is not the main point.

## Trip facts
- Dates: **Fri 27 Nov 2026 – Mon 30 Nov 2026** (4 day tabs: Fri, Sat, Sun, Mon).
- Arrival Fri 16:15 at **Sabiha Gökçen (SAW)**. Departure **Mon 21:00 from SAW**; be at the airport by **19:00**.
- Last day: fixed stop "Leave for SAW" at **17:00** (Cihangir → SAW is roughly 45–90 min by road; Monday evening rush). Editable in the Plan.
- Stay: a flat on **Hüseyin Ağa Bahçe Sokağı, Beyoğlu** (Cihangir / Firuzağa side, just below İstiklal).
  Coordinates: street centre 41.03098, 28.98062, source `osm:way/183820655`. [House number would make it exact — optional.]
- Time zone: `Europe/Istanbul`, UTC+3 all year (Turkey has no DST since 2016).
- Sun (computed, NOAA algorithm, Beyoğlu): sunrise ≈ 08:05–08:09, **sunset ≈ 17:37–17:38** on all four days.
  Golden hour ≈ 16:50–17:37. Mornings are dark-ish until 08:00.
- People (share-link names): **Cem, Lucy, Michele, Coş** (fixed list, no free-text name). No kids; everyone walks well.
- Food: no dietary requirements, but one person avoids red meat and likes vegetarian dishes → food entries flag `veggie_friendly` / fish options.

## Guardrails
- Phone only, 360–430 px. Wider screens: same layout, filling up to 600 px (no fake phone frame). No desktop/tablet layout.
- Static site, no backend, no accounts, no database. Plain HTML/CSS/JS, CDN libs pinned to exact versions. No bundler without asking.
- MapLibre GL JS + free keyless light basemap (CARTO Positron/Voyager) with attribution. Style needs a `glyphs` URL.
- No Google data in the dataset. Google = "Open in Google Maps" link only (`https://www.google.com/maps/search/?api=1&query=<lat>,<lng>`).
- Never invent coordinates. Every point has a `source`. No source → drop or flag.
- No API keys in client code, no runtime AI calls. "Suggested" order is a local heuristic.
- No opening hours, prices or booking info. One short tip line max.
- No turn-by-turn routing (Google Maps does that). Allowed: a ferry-lines layer and a short "Getting there" line per place
  built from sourced stop data (nearest stations/piers + lines). If data is thin, say "Taxi is easiest" rather than guess.
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
| Data stack | Wikidata (backbone), Wikimedia pageviews + sitelinks (popularity), Commons (photos), Wikivoyage (research only, own words), Overture Places (cross-check + area-character evidence). OSM only where nothing else works: the flat, neighbourhood polygons, ferry lines, stations/piers (ODbL credit in the map attribution). DuckDB is a local data-prep tool only; nothing is hosted. |
| Place count | No fixed cap. Cover the main things well; quality first. Less prominent places are visually quieter (smaller, later zoom), so the map never feels crowded. |
| Tiers | `must-see`, `worth-it`, `bonus`. No hidden-gem tier, no day trips. |
| "Vibe" | Means the **character / texture of the area** (see Area character). Shown as an optional **Vibe map** layer. |
| Lines | **Walks**, **boat trips** (cruises) and **ferry lines** (transport, so you can see where a boat helps). |
| Getting there | Short per-place line: nearest metro/tram/funicular/ferry stop, walk distance, line name; "Taxi is easiest" when nothing is close. |
| Filters | Non-matching places **disappear** (changed 2026-11-05, Cem: "hide, don't dim"). "All places" chip becomes a "✕ Show all" reset when a filter/search is on. Chip label "Viewpoints". |
| Routes (replaces Plan, 2026-11-05) | Tab "Routes". A route = places added to a day; app orders them nearest-first from the start (our flat by default, "Start:" picker) with nearest-neighbour + 2-opt. No times, weather, fixed arrival/airport stops or "As added". Between stops only the mode: "Walk · N min", Tram/Metro/Ferry, or Taxi (`routes.js` `legMode`). Up to 3 alternative routes per day, each its own colour (5 route colours in theme). "On map" switch shows up to 5 routes on Explore with a legend. Lines follow streets via the keyless FOSSGIS OSRM foot router (`routing.openstreetmap.de/routed-foot`, cached in localStorage) and ferry lines for ferry legs. No mini map (2026-11-06): "Show on map" turns the route on and jumps to Explore, framed on it. Days = segmented control; alternatives only shown when >1; the first route of a day is its **main** route (⋯ → "Make this the main route"); tray "Add from your saved places". |
| What's here | Button under My location: tap it, tap the map → 500 m circle (was 900 m; cut 2026-11-06), the neighbourhood (nearest mahalle), its vibe words + feel, and the best places inside ranked by tier, score, distance. |
| Name | **Istanbul Explorer** (renamed 2026-11-05; theme `app.name`, manifest, title). |
| Splash photo | "Süleymaniye Mosque in 2025 (54490714777) (cropped).jpg": Süleymaniye at sunset, pink sky (Jorge Franganillo, CC BY 2.0; `SPLASH_CREDIT` in `splash.js`, first row of Credits). Cem 2026-11-06: "definitely needs to be sunset". No falling confetti ("looks like snow"). (Commons, credited via places.geojson) with a slow drone-like drift; Explore fades into the map. |
| Vibe button | White 56 px circle (bigger than the other map buttons) with a small patchwork glyph over the word "Vibe"; navy when on (2026-11-06). Top of the right-hand stack, above What's here. Legend floats under it: Character / Lifestyle switch, tap rows to show only those areas. With the vibe map on, tapping an area (not a pin) shows its vibe in a toast. |
| Map chrome | No MapLibre "i" attribution button: small text credit bottom-left. My location + Home stacked bottom-right. Type: titles 700, labels 600, body 400, no italics; warm grey `ink-2` #5E5A55. App fills up to 600 px wide (no fake phone frame). Share button on every place card (`#place=<id>` link) and on Routes. |
| Turkish names | Yes: small second line under the English name. |
| Palette & fonts | Keep: navy #14213D, Iznik cobalt #1F4FA3, pomegranate #C4462E, map ground #EEEBE3. Font: **Figtree** (changed 2026-11-05 at Cem's request: "a font better for an application"; Geist offered as option). All in `app/themes/`. |
| Theme presets | 5 presets (Iznik Navy, Bosphorus at Night, Tea & Simit, Tile White, Gül). **Everyone can pick** one on the Saved screen ("Look"); `?edit=1` is the full editor. |
| Splash | Each app open: "21 / days to go!", a quiet countdown line (one tick per day left, then the 4 trip days), trip-day cards (forecast when available); **tap a day** → pop-up with the main route's stops in order + weather + sunset (sizes to content, no inner scroll). Centred "Explore Istanbul" button with the Explore (compass) icon. Shown on **every** open incl. refresh (not for #place/#from links or `?splash=0`). The same countdown is the top card on More (tap → splash). Replaces the old top bar; a days badge in the search bar reopens it. `?splash=0` skips it. |
| Discovery | Every place is always at least a small category-coloured dot; icons appear by tier zoom on top. Tapping a dot zooms in. |
| Offline | Service worker (https or localhost). "Save for offline" on the Saved screen caches basemap tiles z10–14 for the area + one thumbnail per place + first big photo of top places (~60 MB). Add to Home Screen via `manifest.webmanifest`. |
| Edit mode | `?edit=1` (hidden, not secure). |
| Mock forecast | Opt-in toggle (edit mode or `?mockweather=1`), always labelled "Sample forecast". Never shown by default. |
| Photo credits | No credit on each photo. Author + licence kept in data. Credits = one tiny line at the bottom of More (tap → full list); no menu row (2026-11-06). |
| Sharing | Snapshot links (no live sync). |
| Hosting | Vercel: **https://explore-istanbul.vercel.app** (from the GitHub repo; push = deploy). |
| Place card (2026-11-06) | No tag row (no category/tier/area/vibe/lifestyle tags), no "Best in the morning" box. Under the title: "Open in Google Maps" pill, then `summary` (Wikipedia intro). Tap a photo → full-screen viewer. |
| Round 7 (2026-11-06) | Filters: Iconic, Food & drink, Viewpoints, Mosques, Churches & synagogues, Palaces & museums, Bazaars, Parks (no Neighbourhoods chip). A place sits on **one day only** (picking another day moves it). No "Getting there" on cards. Google Maps button uses the official pin (`app/icons/google-maps.png`, Commons 2026 icon). My location = icon inside the search bar; Home alone bottom-right. **Vibe** = first in the top-right stack, above What's here (see Vibe button). Lifestyle "mixed" = #8F8981. Saved share card over the Golden Horn sunset photo. Map `fadeDuration: 0` + selected pin ignores placement (no blink on close). |
| Food (2026-11-06) | `scripts/10_food.py`: Wikidata food places (search API) with photos, plus Overture local places as tier **`local`** (icons from z15.4, dots ~1 zoom earlier; not counted in "in view" before that). Chains, fast food and foreign cuisines left out. `kind` = Meyhane/Fish/Kebab/Lokanta/Breakfast/Café/Coffee/Tea/Bakery/Sweets/Ice cream/Bar/Restaurant. |
| Study area v3 (2026-11-06) | `scripts/09_study_area_v3.py`: concave hull of the sights + shore points (ratio 0.12), padded 900 m, plus a Sea of Marmara band from Zeytinburnu to Fenerbahçe, opened 2 km, rounded 2.5 km, then grown 700 m with round joins (rounds the outward corners). ~400 km². Earlier outlines in `data/raw/study_area_v2.geojson`, `study_area_v3a.geojson`; `qa/shape.html` compares. Vibe areas clipped to it; food re-run after. |
| Outside the area (2026-11-06, superseded 2026-11-08 by Performance) | Very light grey outline (ink-2, 22 %). Fade starts 30 px outside the line so edge labels stay sharp; blur 3 px + 58 % tint (Cem: blur "hurts my eyes"). A DOM veil over the map (`.map-veil`, backdrop-filter blur + milky tint) masked by a feathered study-area cut-out drawn per frame on a quarter-size canvas (`frostOutside` in `map.js`, shadow-blur trick so iOS works): blur fades in over ~1.6 km past the edge. Hidden when the view is fully inside. Fallback without backdrop-filter: the old milky fill. |
| Round 9 (2026-11-06) | Ferry lines quieter (opacity 0.18–0.32). Routes: "Show on map" ↔ "Hide from map"; start picker is an in-app list, not the native select. Themes: swatch = mini preview (background, map, button, accent) + hint ("Light, blue", "Dark"…); Tile is now mono (black primary). More: countdown card, theme, install, Offline last, credits. Search: typing shows suggestions only (map stays put); Enter or "Search for …" filters; empty focus shows example searches; index adds vibe + lifestyle words and "vegetarian" (meyhane/lokanta/breakfast only). Placeholder "Search anything". Zoomed out (< z11.8): "Top picks in Istanbul" + "zoom in to explore an area". |
| Food icons (2026-11-06) | `local` tier icon size 0.42 (others 0.62+), icon-padding 3, 90 % opacity: fewer, smaller icons at street zoom, the rest stay dots. 4,083 food places. |
| Places of worship (2026-11-06) | One category, but each place has `kind` (mosque/church/synagogue/monastery/tomb) for labels; chips "Mosques" and "Churches & synagogues". A chip with no matching data is hidden (Food, until food places exist). |
| PWA (2026-11-06) | Installable: PNG icons in `app/icons/` (rendered from the SVGs with headless Edge), manifest with maskable icon, apple-touch-icon; More shows "Install the app" (Android prompt / iPhone Share → Add to Home Screen). |
| Round 10 (2026-11-06) | Filter chips keep the view (zoom out to results only if none in view); typed search still frames results. Edge: clear band 12 px (was 30), outline opacity 0.18. Churches/monasteries and synagogues have their own pin icons (`kindIcons` in config, `catslug` gets `-<kind>`). **Map style** button (stacked sheets icon) above Home: Our map (theme CARTO vector) / Streets (Esri World Street Map) / Satellite (Esri World Imagery + Esri labels) / Hills (OpenTopoMap, max z17); raster under our layers, vector basemap hidden; `oit:basemap` in localStorage; credit line changes. CARTO raster tiles now need a key, so not used. Routes tab icon = folded map with a route (`routeMap`). New app icon: mosque skyline at sunset over the water (`app/icons/*.svg` → PNG via headless Edge). Place card rises 48 px + fades (0.34 s), sinks out (0.2 s); selected pin fades out (no flash). Area tags: full class name ("Everyday residential") + one sentence incl. the lifestyle feel (no bare "Mixed"). Map loading pill until the first idle. Sheet drags by handle, bar and list header; flicks snap one step. Vibe legend selected = navy filled like chips. Countdown moods: ≤30 golden trip block, ≤14 golden unit + line, ≤7 / tomorrow / day 1 golden glowing number + pulsing today tick; plane on "Tomorrow!", day 1 and last day; new theme token `sun` #F6C25B. Date preview: `?today=YYYY-MM-DD` or the edit-mode slider (top of the editor). List titles use chip `title` ("Iconic landmarks in view"). |
| Round 11 (2026-11-06) | Map styles: **Auto** ("Matches app theme"), Streets, Satellite, **Hills** = theme map + MapLibre hillshade from keyless Terrarium tiles (AWS Open Data; OpenTopoMap dropped, too busy). Map style button = folded map; Routes tab = plain 4-node route. Palaces & museums icon = palace front with dome and flag (columns read as "university"). No "Our flat" label on the map. Vibe icon/text gap 5 px. Iconic: 35 must-sees; tiers by judgement in `08_finish_places.py` `TIER` (15 promoted, e.g. Spice Bazaar, Rüstem Pasha, Ortaköy, Balat, Pierre Loti; Sublime Porte, Taksim Square, Şehzade demoted; Yavuz Sultan Selim Bridge → bonus). Taksim Square → Neighbourhoods (label). Stations/piers = small badges (M/T/F/R, boat for ferry), tap → toast. Food icons: own 17 px image (`-sm`), fixed size, fade 120 ms. Churches, monasteries, synagogues: own colour token `Churches & synagogues` (`kindColors`, place `colkey`). |
| Round 12 (2026-11-06) | App icon v3: map pin holding the sunset mosque (wide low dome + crescent, slim pencil minarets), Bosphorus with a dashed ferry route, navy background with contour lines. Routes icon uses the standard 1.9 stroke. Countdown plane sits on 27 Nov, not "Today". Map style hints: Streets "More detailed", Satellite "Imagery with labels", **Topography** "Hills and mountains". List titles always "… in view"; zoomed right out the default title is "Zoom in for top picks". With a filter on, food icons still start at z14 (below that, dots): collided icons at city zoom looked like a grid. |
| Round 13 (2026-11-06) | List title is always "Top picks in view" (the bar says "zoom in to explore an area" when zoomed out). Palaces & museums get a `kind` in `08_finish_places.py` (`pm_kind`): Palace, Museum, Cistern, Fortress, City walls, Landmark (default). Cards top-align (a two-line name no longer pushes the photo up). App icon v4 after Cem's ChatGPT draft: pin with a thin cream outline, sunset glow, mosque, blurred sun reflection, plain blue gradient ground. |
| Round 14 (2026-11-06) | Icon outline 9 px; water = soft glow column + bright horizon + broken shimmering streaks (not stacked lines). Spinner next to the list title while the map moves or tiles load (`#list-busy`). Always show Cem the icon PNG in chat after each icon change. |
| Final app icon (2026-11-06) | Cem's own image, kept as `app/icons/icon-source.webp` (1254 px). PNGs rendered with headless Edge at the same scale: only the black rounded corners are filled with the image's navy #0D1D53 (no zoom). Full-bleed 512/192/180, maskable at 80 %, transparent rounded favicons 32/64 + `icon-rounded-512.png`. Favicon, apple-touch-icon and Open Graph tags (og:image = absolute https://explore-istanbul.vercel.app/app/icons/icon-512.png) in `app/index.html` and the root `index.html`. Old SVG icon art removed. Background recoloured to Iznik navy #14213D around the pin only (flood fill stopped by the outline): `design/icon_recolour.html`, rendered with headless Edge `--allow-file-access-from-files`. |
| Visitor (2026-11-06) | "Who's this?" prompt has a quiet underlined "Visitor" button under the four names, for anyone outside the group (e.g. opening a shared link). Saved as name "Visitor"; their share links read "Visitor's picks". |
| What's here v2 (2026-11-08) | The listed places (top 8) get numbered markers on the map matching numbered rows. Tap a row (or a number on the map) to pick it: marker grows in the accent, map pans if it's out of view. Tap the picked row again, or its › arrow, to open the card. Closing the panel keeps the circle, drops the numbers. Round 2: the "Tap anywhere" hint hides once you've tapped; the panel is at most half the screen and starts scrolled to the top; the map fits the whole circle between the chips, the round buttons and the panel (map padding cleared first: fitBounds adds it and silently gives up when it doesn't fit); neighbourhoods are left out; Back from a place opened here returns to the panel (same spot, same pick). Search bar 26 px below the status bar. Photo cache cap 2,500. |
| Performance (2026-11-08) | Freezes after a few minutes on iPhone. The per-frame blur veil (canvas → PNG → CSS mask on every move, backdrop-filter over the whole map) is **gone**: the outside is now a static feathered tint drawn by the map (`scripts/11_mask_feather.py` → `data/study_mask.geojson`: 60 m clear strip, 16 smoothstep rings to 1.6 km, then solid; `a` = share of the theme's `maskOpacity`; one `edge` line feature). No blur any more, only the milky tint, but no flicker and no per-frame cost. Map drawn at max 2× pixel ratio, no refresh of expired tiles. List: rebuilt after a pan only if its content changed; the 150-row list only while the sheet is open. Service worker: tile/ext caches trimmed at most every 20 s (was after every tile), all basemap tiles in the capped tile bucket, other downloads capped at 800. Splash empties itself after closing. **Freeze recovery:** iOS drops the WebGL context when short of graphics memory (satellite, fast zooms): map freezes, buttons still work. `watchContext` in app.js rebuilds the map in place at the same view if it isn't restored within 1.2 s (max 3/min). Tile cache 80 tiles / 3 zoom levels; terrain DEM max z12; no page-wide touchmove listener (the map's pinch is never blocked). Search bar and map buttons 8 px lower, clear of the status-bar blur. |
| iPhone polish (2026-11-06) | Installed app: no page bounce (overscroll-behavior on html, **no** position:fixed/overflow on body: that clipped the app to iOS 26's short viewport → band at the bottom), no page zoom (viewport meta + gesture block; map keeps its pinch), `--app-h` from screen height in the installed app, tab bar 14 px closer to the home bar, place-card buttons below the status bar. Splash drift pans the photo's own overflow (never runs out). Edge blur mask decodes before swapping (no full-map flash). **No 3D tilt** (maxPitch 0); rotation on, with a north button (needle turns with the map) shown only while rotated. |
| Mockup tweaks (agreed) | Google Maps button = quiet secondary with official pin icon; plan step numbers in cobalt (not red); filter chips show an active count. |

## Area character ("vibe") — v2, researched (2026-11-05)
**One question:** *what does street life feel like here, for a visitor, most of the day?*
History and religion are properties of places (the categories), not of areas. That removes the old "devout vs historic" overlap.

Basis: UK townscape character practice (typology first → merge into character areas; fieldwork/evidence checks;
Landscape Institute TIN 05/2017, Historic England *Understanding Place*), plus Istanbul neighbourhood-pattern research
(Oruç, Ertekin & Dökmeci: historical, westernised, modern, gated and "Manhattan-type" forms) and gentrification literature.

**Exhaustive by design:** every land polygon in the study area gets exactly one primary class. "Everyday residential"
is the catch-all for built-up land and "Green & open" for unbuilt land, so nothing is left unclassified. Water is not classified.

| # | Class | What it feels like | Examples |
|---|---|---|---|
| 1 | Monumental old city | Imperial sights, squares, tour groups | Sultanahmet, Süleymaniye |
| 2 | Market & trade | Packed shopping/wholesale streets by day, quiet at night | Eminönü, Tahtakale, Grand Bazaar quarter |
| 3 | Conservative local | Traditional, observant everyday life; modest dress, little nightlife | Çarşamba/Fatih, Eyüp, parts of Üsküdar |
| 4 | Bohemian & creative | Old houses, cafés, galleries, gentrifying | Cihangir, Galata, Balat/Fener, Kuzguncuk, Moda |
| 5 | Nightlife & youth | Bars, music, students, late nights | Beyoğlu side streets, Kadıköy bar streets, Karaköy |
| 6 | Bosphorus village | Waterfront promenades, tea gardens, wooden yalı houses | Ortaköy, Arnavutköy, Bebek, Çengelköy |
| 7 | Modern & upmarket | Towers, malls, brands, smart cafés | Nişantaşı, Levent, Bağdat Caddesi |
| 8 | Working-class inner city | Dense, busy, rough at the edges, real local life | Tarlabaşı, Kasımpaşa, Dolapdere |
| 9 | Everyday residential | Ordinary apartment neighbourhoods; not a destination (catch-all, neutral grey) | most outer mahalles |
| 10 | Green & open | Big parks, groves, hillsides, cemeteries (neutral green) | Yıldız, Emirgan, Çamlıca |

**Overlaps:** each area has one `primary` (sets the map colour) and an optional `secondary`
(shown in words, e.g. "Bohemian, with nightlife"). Places inherit both from their area and can override.

**Method (Phase 1):**
1. Unit = OSM mahalle polygons (official neighbourhoods, ~370 in the study area), clipped to land.
2. Evidence per mahalle: Overture Places mix (share of bars, cafés/galleries, mosques, wholesale shops, offices/malls, parks),
   Wikivoyage district text, published research and press, my judgement.
3. Written rules turn evidence into a class; I review and note why. Thin evidence → Everyday residential.
4. Merge neighbouring same-class mahalles into smooth character areas → `data/areas.geojson`.
5. Cem reviews on the QA page (Phase 2).

**In the app:** a "Vibe map" toggle shows a soft translucent fill under the pins plus a legend; off by default.
Classes 1–8 get distinct colours (≤8 categorical hues), 9 and 10 stay neutral.

## Lifestyle — second, independent dimension (2026-11-05)
Istanbul runs from Bodrum-style secular and European-feeling to traditional and observant, often side by side.
This is a **separate field** from area character, so any combination works (e.g. Green & open + Traditional,
Modern & upmarket + Cosmopolitan, Market & trade + Mixed).

| Value | What a visitor notices | Examples (to verify) |
|---|---|---|
| `cosmopolitan` | Secular, European-leaning; bars and meyhanes everywhere, relaxed dress, late nights | Cihangir, Kadıköy/Moda, Bebek, Nişantaşı |
| `mixed` | Both side by side: mosques and meyhanes on the same street | Beşiktaş, Üsküdar centre, Karaköy, Balat |
| `traditional` | Conservative and family-centred; little or no alcohol, modest dress common, quiet evenings | Çarşamba/Fatih, Eyüp |

- Describes **street life**, not anyone's beliefs. Useful for practical things: where you'll find a drink, what to wear in a mosque-heavy area.
- Evidence per mahalle: share of alcohol-serving venues (bars, meyhanes, wine shops) vs mosques and family tea houses in Overture,
  plus Wikivoyage, published research and judgement. **No election or vote data.**
- Stored on every mahalle/area (`lifestyle`) and inherited by places. Shown in words on cards ("Bohemian · Cosmopolitan").
  The Vibe map can switch between "Character" and "Lifestyle" colouring (a 3-step diverging scale for lifestyle).

## Categories (pin icons)
Mosques & churches · Palaces & museums · Viewpoints · Bazaars & markets · Food & drink · Neighbourhoods · Parks & waterfront.
Line layers: Walks · Boat trips · Ferry lines. Area layer: Vibe map. Fixed: the flat, SAW airport.

## Architecture (modular)
- `app/layers.json` — layer registry: id, file, geometry, symbology key, zoom rules, filterable fields, card template.
- `app/categories.json` — categories (icon, colour token), character tags, chips. Add a class = add an entry.
- `app/theme.json` + `app/themes/` — all visual tokens as CSS custom properties. QA fails on hard-coded hex/font names outside theme files.
- `data/*.geojson` — one file per layer. `data/areas.json` — area → shore, character tags.
- `scripts/` — acquisition + QA (Python, run locally). `qa/index.html` — QA map + table.

## Data schema
`data/places.geojson` properties:
`id` (slug) · `name` · `name_tr` · `category` · `character` {primary, secondary} (defaults from area) · `tier` · `score` (1–5) + `score_basis` ·
`area` · `shore` (`europe`/`asia`) · `blurb` (≤25 words, own words; currently the Wikidata description) · `summary` (≤ ~50 words, first sentences of the English Wikipedia intro, CC BY-SA; `summary_source`) · `kind` (places of worship) · `tip` (optional) · `indoor` (bool) ·
`best_time` (`morning`/`midday`/`afternoon`/`golden-hour`/`evening`/`any`) · `dishes` (food only) · `veggie_friendly` (food only) ·
`wikidata` · `wikipedia` · `photos` [{file, author, licence}] · `source` · `qa`.

`data/walks.geojson`: `id`, `name`, `blurb`, `character`, `best_time`, `length_km` (computed), `photos`, `approx: true`.
`data/boat_trips.geojson`: `id`, `name`, `blurb`, `best_time`, `duration_hint`, piers from sourced coordinates, `approx: true` for the route line.
`data/ferries.geojson`: ferry lines from OSM `route=ferry` (operator, ref, name, piers).
`data/stops.geojson`: metro/tram/funicular stations and ferry piers (name, mode, lines) → feeds "Getting there".
`data/areas.geojson`: merged character areas: `primary`, `secondary`, `lifestyle`, `mahalles`, `evidence`, `notes`.
Places also get `getting_there`: [{stop, mode, lines, walk_m}] (computed) + optional `getting_there_note`.
`data/fixed.geojson`: the flat, SAW airport.
Places also carry `mahalle` (containing or nearest OSM mahalle) and `lifestyle`, both from `07_areas.py`.
Saved state (localStorage `oit:v1:me`): `{name, hearts, routes:[{id, day, name, ids, start:"home"|placeId, onMap, ci}], active:{day: routeId}, addedAt}`;
old `days` maps migrate into one route per day.
`data/study_area.geojson`: Bosphorus-centred study polygon for QA outlier checks.

Score = sitelinks + log 12-month EN pageviews + Wikivoyage "See" presence, sanity-checked by judgement (flag gaps ≥ 2 points).
Prominence on the map: `must-see` shows from low zoom; `worth-it` mid zoom; `bonus` close zoom, smaller and quieter.

## Phases
- [x] Phase 0 — setup, questions, CLAUDE.md, scaffold, git init
- [~] Phase 1 — research & data. Done: study area (4 km band from the water, data-chosen), OSM mahalles/ferries/stops,
      Wikidata candidates (670 places, provisional tiers), coverage + bias check, overrides.json.
      Done 2026-11-05: photos (1,335 with credits, `05_photos.py`), Overture 2026-10-21.0 places (`06_overture.py`, 172k POIs),
      area character + lifestyle for 305 mahalles → 123 areas (`07_areas.py`, rules + reasoned overrides, evidence in
      `data/mahalle_character.csv` for Cem to review). Run order 04 → 05 → 07 → 08 → 09 → 10 (10a once) → 08 (restore `data/raw/places_before_07.geojson` before re-running 07).
      2026-11-06: `08_finish_places.py` drops 22 non-places (2024 church shooting, a church council, a hoax, demolished buildings,
      consulates, a hotel, schools), adds `kind` and `summary`. The two "Food & drink" entries were pavilions → re-filed; **no food places yet**.
      To do: 12-month pageviews (rate-limited, see lessons), food places, own-words blurbs, best_time/indoor, walks, boat trips.
- [ ] Phase 2 — QA script + `qa/index.html` 🛑 Cem reviews (`qa/preview.html` is a quick data map for now)
- [~] Phase 3 — started early at Cem's request (2026-11-05), on provisional data: theme tokens, config-driven layers,
      Explore (countdown, forecast panel, search, chips, tiered pins, mask, shore badge, near me/home, sheet, Right now),
      Place card (gallery, heart, days + undo, Getting there, Close by, quiet Google Maps). Basic Saved + Plan.
      `scripts/qa_theme.py` enforces no hard-coded colours/fonts. 🛑 Cem tests on phone
      UI fixes (2026-11-05): sheet closed/peek/open, filters + search zoom to results (all tiers shown while filtering),
      shore badge removed, "Search anything" (names, Turkish names, areas, categories, dishes), ground-colour page background.
- [~] Phase 4 — built 2026-11-05: name prompt, Plan (day tabs, part-of-day weather strip, As added / Suggested via `plan.js`,
      fixed Fri arrival / Mon airport stops, tray of unplanned saves, read-only view of others' snapshots),
      Saved & share (`share.js`: compact `#from=…&p=` links, lz fallback, Mine / per-person / Matches, merge, remove),
      Right now uses live weather during the trip. 🛑 Cem tests on phone
      2026-11-05: Plan rebuilt as **Routes** (see Decisions; `plan.js` removed, `routes.js` added), Vibe map toggle + legend,
      What's here, share on place cards. Tested at 375×812 in the preview.
- [~] Phase 5 — built: 5 presets in `app/themes/`, `?edit=1` editor (`edit.js`: preset, name, logo, fonts, corners, colours
      with contrast check, basemap, pins, sample-forecast toggle, save locally / export theme.json), credits screen,
      offline `sw.js` (https only). To do: a11y pass, loading/empty polish, deploy.

Backlog (don't build unless asked): prayer times, food tick-list, Turkish phrases, transport layer, live sync.

## Lessons
- **MapLibre `fitBounds` padding is added to the map's own padding** (2026-11-08): with the sheet padding set, the total was taller than the map and fitBounds silently did nothing. Clear `setPadding` first (or subtract it).
- **iOS takes WebGL away under memory pressure** (2026-11-08): the map freezes on its last frame while DOM buttons still work. Listen for `webglcontextlost` and rebuild the map if it isn't restored; keep the tile cache small.
- **Never redraw a CSS mask image per frame** (2026-11-08): a canvas → toDataURL → `mask-image` veil on every map move flickered (async decode) and, with backdrop-filter, froze iPhones after a few minutes. Precompute the shape as GeoJSON and let the map draw it.
- **`position: fixed` + `overflow: hidden` on body clips installed iOS 26 apps** (2026-11-06): the app was cut to a too-short viewport (band at the bottom). Use `overscroll-behavior: none` on html for the bounce; size the app from the screen height when installed.
- **CARTO raster tiles need an API key now** (2026-11-06): `basemaps.cartocdn.com/rastertiles/*` and `{a-d}.basemaps.cartocdn.com/light_all/*` return a 2 kB "API key required" PNG. The GL vector styles still work keyless. Esri `server.arcgisonline.com` tiles and OpenTopoMap are keyless.
- **The preview keeps old ES modules after edits** (2026-11-06): reloads served cached `icons.js` even after unregistering the SW and `cache: "reload"` fetches. Test on a fresh loopback origin (127.0.0.2, .3 …: each has its own cache and localStorage). Real users get the SW `VERSION` bump.
- **Sheet drag: listen for move/up on `window`** (2026-11-06): a fast first move can land outside the sheet, so listeners on the sheet never see it. Eat the click that follows a drag (capture phase).
- **Theme `golden` is a pale tint, not gold** (2026-11-06): use `sun` for gold accents on the splash.
- **Chromium blocks WebGL for an origin after repeated context loss** (2026-11-06): many reloads/theme switches in the preview → "Web page caused context loss and was blocked", blank map. Not an app bug: open a new tab on another origin (127.0.0.1 vs localhost).
- **Generic class names collide** (2026-11-06): the Routes day buttons used `.seg`, which already styled the vibe legend switch (padding, background), so days sat off-centre. Prefix new component classes.
- **DOM overlays added to a MapLibre container outlive `map.remove()`** (2026-11-06): the blur veil stayed after a theme switch (whole map blurred). Remove them on the map's `remove` event.
- **Kind-level guesses make bad search facts** (2026-11-06): `veggie_friendly: true` for every café/bar made "vegetarian" match 3,685 places. Only set flags where they are actually true.
- **Non-ASCII in shell curl args breaks on Windows** (2026-11-05): Turkish names (ğ, ı, ü) in Overpass/Nominatim queries passed via Git Bash `curl` returned empty results. Do HTTP in Python (`urllib`, UTF-8) and run with `PYTHONIOENCODING=utf-8`, or fuzzy-match names locally after an ASCII-only bbox query.
- **Istanbul winter sunset is ~17:37, not ~16:40** (2026-11-05): Turkey is on permanent UTC+3, so clock sunsets are an hour later than old EET-based figures. Always compute (SunCalc/NOAA); never quote from memory.
- **Overpass can 502 transiently** (2026-11-05): cache raw responses in `data/raw/`, retry with backoff, fall back to a mirror (overpass.private.coffee).
- **`python -I` ignores `PYTHONIOENCODING`** (2026-11-05): use `python -I -X utf8` for Turkish text output.
- **Never type Wikidata QIDs from memory** (2026-11-05): four QIDs I "knew" (SAW, Blue Mosque, Galata Tower, Maiden's Tower) were all wrong.
  Look them up (wbsearchentities) or copy from the data; `04_build_places.py` now fails on unknown QIDs in overrides.json.
- **Wikimedia APIs rate-limit anonymous clients hard** (2026-11-05): per-article pageviews REST and WDQS SPARQL return 429 with
  Retry-After up to 1000 s. Batch (Action API: 50 titles/ids per call), cache everything, honour Retry-After.
  A User-Agent with a contact (e.g. a GitHub URL) would lift limits — ask Cem before adding one.
- **Category rules: EXCLUDE words hide real sights** (2026-11-05): "road bridge" hit `road`, districts hit `municipality`.
  Use a KEEP list and re-run `scripts/analysis_coverage.py` after changing rules.
- **Heredoc + Python string escapes can write control characters** (2026-11-05): `\b` became a backspace in a regex. Edit files with the Edit tool, not string-replace scripts.
- **Wikimedia thumbnails: standard widths only** (2026-11-05): use 120/250/330/500/960/1280 (`photoUrl` snaps up). Some
  Wikidata P18 file names arrive URL-encoded (`%20`); decode before `encodeURIComponent` or every link breaks.
- **Study area smoothing can drop real sights** (2026-11-05): an open (erode/dilate) of 1.5 km+ cut off Yedikule and the
  Golden Gate. After changing `CLOSE_M`/`OPEN_M`, check no place in places.geojson falls outside (v2: close 4 km, open 1 km).
- **Overture 2026 schema dropped `categories`** (2026-11-05): DuckDB BinderException. Use `taxonomy.primary`,
  `taxonomy.hierarchy`, `basic_category`, `operating_status`; mosques are `muslim_place_of_worship`.
- **FOSSGIS foot router path says "driving"** (2026-11-05): `https://routing.openstreetmap.de/routed-foot/route/v1/driving/lon,lat;lon,lat?overview=simplified&geometries=geojson`.
  The server picks the profile; the path segment stays `driving`. Keyless, CORS `*`; cache results and be gentle.
- **Map padding moves the "centre"** (2026-11-05): with the bottom sheet, `easeTo({offset})` lands in the wrong place.
  Pass `padding` for the panel that will cover the map, then restore with `setSheet(S.sheet)`.
- **Service worker serves stale JS in the preview** (2026-11-05): unregister + clear caches, and bump `VERSION` in `sw.js` when files change.
- **Gallery photos spilled out of their frame** (2026-11-06): in a grid slide, `height: 100%` on a portrait `<img>` didn't hold, so it
  overflowed (562 px in a 300 px gallery) and could be dragged up/down. Fix: `position: absolute; inset: 0` + `overflow-y: hidden` on the track.
- **Splash "tap twice"** (2026-11-06): the forecast arrival re-rendered the whole splash and replaced the button mid-tap; also `focus()` drew the outline.
  Update only the forecast block; don't focus buttons from code.
- **Wikipedia plain-text extracts can have unclosed brackets** (2026-11-06): e.g. "Mecidiyeköy (Turkish pronunciation: [..] is a …". Strip brackets
  with a depth counter, and when unbalanced cut from the bracket to the main verb (`08_finish_places.py`).
- **WDQS (SPARQL) times out / rate-limits** (2026-11-06): a `P31/P279*` walk inside `wikibase:box` never returned. Use the
  Wikidata search API instead: `list=search&srsearch=haswbstatement:P31=Q11707 nearcoord:12km,41.03,28.98`, then wbgetentities.
- **Inline `style` on SVG beats stylesheet rules** (2026-11-06): use a class when a theme state must restyle a path.
- **data.ibb.gov.tr timed out from here** (2026-11-05): Istanbul's open-data portal may block non-Turkish IPs; don't depend on it.
