import { loadTheme, catVar } from "./theme.js";
import { icon } from "./icons.js";
import { createMap, EXTRA_BASEMAPS } from "./map.js";
import { store } from "./store.js";
import { tripStatus, sunTimes, forecast, fmtTime, istanbulToday, istMinutes } from "./sky.js";
import { order, legMode, legsGeometry } from "./routes.js";
import { renderSplash, updateSplashForecast, badgeText, countdownCard, SPLASH_CREDIT } from "./splash.js";
import { indexCodes, importFromHash, shareMyPicks, people, mergeIntoMine, removePerson, fmtAsOf } from "./share.js";

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const norm = (s) => String(s ?? "").toLocaleLowerCase("tr").normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/ı/g, "i");
const params = new URLSearchParams(location.search);
const hydrateIcons = (root = document) => root.querySelectorAll("[data-icon]").forEach((el) => { el.innerHTML = icon(el.dataset.icon, el.dataset.size ? +el.dataset.size : undefined); el.removeAttribute("data-icon"); });

// ---------- geometry ----------
function distM([lon1, lat1], [lon2, lat2]) {
  const r = 6371008.8, p1 = lat1 * Math.PI / 180, p2 = lat2 * Math.PI / 180;
  const a = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(((lon2 - lon1) * Math.PI / 180) / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
}
const fmtDist = (m) => (m < 950 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);

// ---------- state ----------
const S = { chip: "all", query: "", near: null, sheet: "peek", selected: null, savedTab: "mine", planDay: null, planRoute: null, planWho: "me", vibe: null, here: false };
let DATA = null;
let CFG, THEME, PLACES, BYID, STOPS, FERRIES, AREAS, MAP, FC = null, MOCK = false;

const catCfg = (id) => CFG.categories.find((c) => c.id === id) || { short: id, icon: "pin" };
const iconOf = (p) => catCfg(p.category).kindIcons?.[p.kind] || catCfg(p.category).icon; // churches get their own icon
// Short type label: "Church", "Synagogue"… for places of worship (data: `kind`), else the category's short name.
const typeLabel = (p) => (p.kind && catCfg(p.category).kinds?.[p.kind]) || catCfg(p.category).short;
const tierRank = { "must-see": 0, "worth-it": 1, bonus: 2, local: 3 };
// Wikimedia serves thumbnails at standard widths only; other sizes are slow or refused. Snap up to the next one.
const THUMB_W = [120, 250, 330, 500, 960, 1280];
const plainFile = (f) => { try { return decodeURIComponent(f); } catch { return f; } }; // some names arrive URL-encoded
const photoUrl = (file, w = 500) => `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(plainFile(file))}?width=${THUMB_W.find((x) => x >= w) || 1280}`;
const filterActive = () => S.chip !== "all" || !!S.query;
const dayCfg = (id) => CFG.trip.days.find((d) => d.id === id);

async function getForecast() {
  if (!FC) FC = await forecast(CFG.trip.days, CFG.map.home, { sample: MOCK });
  return FC;
}

// ---------- filtering ----------
function matchesFilter(p) {
  const chip = CFG.chips.find((c) => c.id === S.chip);
  if (chip?.match) for (const [k, vals] of Object.entries(chip.match)) if (!vals.includes(p[k])) return false;
  if (S.query) {
    // Search covers names (English + Turkish), district + neighbourhood, type (mosque, church, museum…)
    // and the short description, so "Byzantine", "Sinan" or "Ottoman palace" work too.
    // plus dishes and the area's vibe and lifestyle words ("bohemian", "cosmopolitan"); see hayOf().
    const hay = hayOf(p);
    if (!norm(S.query).split(/\s+/).every((w) => hay.includes(w))) return false;
  }
  return true;
}
function refreshPlaces({ fit = false } = {}) {
  if (!MAP) return; // typed before the map finished loading; boot applies the filter
  for (const f of PLACES.features) f.properties.dim = !matchesFilter(f.properties);
  MAP.showAllTiers(filterActive());
  MAP.setPlaces(PLACES);
  renderChips();
  // Chips keep the map where it is; only when nothing matching is in view does it zoom out to the results.
  // A typed search always frames its results (2026-11-06).
  const anyInView = () => { const b = MAP.map.getBounds(); return PLACES.features.some((f) => !f.properties.dim && b.contains(f.geometry.coordinates)); };
  if (fit === true && filterActive()) fitToMatches();
  else if (fit === "ifNone" && filterActive() && !anyInView()) fitToMatches();
  else renderList();
}
function fitToMatches() {
  const m = PLACES.features.filter((f) => !f.properties.dim);
  if (!m.length) { renderList(); return; }
  if (m.length === 1) { MAP.map.easeTo({ center: m[0].geometry.coordinates, zoom: 15.5, duration: 600 }); return; }
  const b = new maplibregl.LngLatBounds();
  m.forEach((f) => b.extend(f.geometry.coordinates));
  MAP.map.stop();
  MAP.map.fitBounds(b, { padding: 40, maxZoom: 15.5, duration: 600, linear: true });
}

// ---------- thumbnails ----------
// All small thumbnails use one size (330 px), so one cached copy serves cards, rows and the plan offline.
const THUMB = 330;
function thumb(p, { pill = true, heart = true, badge = "" } = {}) {
  const ph = p.photos?.[0];
  return `<div class="thumb" style="--cat: var(${catVar(p.colkey || p.category)})">
    ${ph ? `<img loading="lazy" alt="" src="${photoUrl(ph.file, THUMB)}" onerror="this.remove()">` : ""}
    ${icon(iconOf(p), 30)}
    ${pill && !badge ? `<span class="pill">${esc(typeLabel(p))}</span>` : ""}
    ${badge ? `<span class="badge-both">${esc(badge)}</span>` : ""}
    ${heart ? `<span class="heart ${store.isHearted(p.id) ? "is-on" : ""}" data-heart="${esc(p.id)}" role="button" tabindex="0" aria-label="Save ${esc(p.name)}" aria-pressed="${store.isHearted(p.id)}">${icon("heart", 18)}</span>` : ""}
  </div>`;
}

// ---------- chips + search ----------
function renderChips() {
  $("#chips").innerHTML = CFG.chips.map((c) => {
    const on = S.chip === c.id;
    const n = on && c.id !== "all" ? PLACES.features.filter((f) => !f.properties.dim).length : null;
    // "All" turns into a clear "Show all" reset whenever a filter or search is on.
    if (c.id === "all") return filterActive()
      ? `<button class="chip chip-reset" data-chip="all" aria-label="Show all places">${icon("close", 16)} Show all</button>`
      : `<button class="chip chip-all" data-chip="all" aria-pressed="true">All places</button>`;
    return `<button class="chip" data-chip="${c.id}" aria-pressed="${on}">${esc(c.label)}${n != null ? ` <span class="count">${n}</span>` : ""}</button>`;
  }).join("");
}
$("#chips").addEventListener("click", (e) => {
  const b = e.target.closest("[data-chip]");
  if (!b) return;
  if (b.dataset.chip === "all") {
    if (!filterActive()) return;
    S.chip = "all"; S.query = ""; $("#search").value = ""; $("#search-clear").hidden = true;
    refreshPlaces();
    return;
  }
  S.chip = S.chip === b.dataset.chip ? "all" : b.dataset.chip;
  refreshPlaces({ fit: "ifNone" });
});
// Search (2026-11-06): typing only shows suggestions (the map stays put); Enter, or "Search for …", filters the map.
// An empty, focused box offers a few example searches.
const EXAMPLES = ["Meyhane", "Fish", "Breakfast", "Bohemian", "Byzantine", "Sinan", "Ottoman palace", "Baklava"];
const SUGGEST_MAX = 6;
function hayOf(p) {
  if (!p._hay) {
    const vibe = (id) => CFG.vibe.classes.find((c) => c.id === id);
    const life = CFG.vibe.lifestyles.find((l) => l.id === p.lifestyle);
    p._hay = norm([p.name, p.name_tr, ...(p.aka || []), p.area, p.mahalle, p.kind ? "" : p.category, typeLabel(p), p.summary || p.blurb,
      ...(p.dishes || []), p.veggie_friendly ? "vegetarian veggie" : "",
      vibe(p.character?.primary)?.label, vibe(p.character?.secondary)?.label, life?.label].filter(Boolean).join(" "));
  }
  return p._hay;
}
function queryMatches(q) {
  const words = norm(q).split(/\s+/).filter(Boolean);
  return words.length ? PLACES.features.filter((f) => words.every((w) => hayOf(f.properties).includes(w))) : [];
}
function renderSuggest() {
  const box = $("#suggest");
  const q = $("#search").value.trim();
  if (document.activeElement !== $("#search")) { box.hidden = true; return; }
  if (!q) {
    box.innerHTML = `<p class="sg-title">Try</p><div class="sg-chips">${EXAMPLES.map((x) => `<button class="sg-chip" data-sg-q="${esc(x)}">${esc(x)}</button>`).join("")}</div>`;
    box.hidden = false;
    return;
  }
  const n = norm(q);
  const m = queryMatches(q);
  // Names that start with the text first, then the best-known.
  const top = m.map((f) => f.properties)
    .sort((a, b) => (norm(b.name).startsWith(n) - norm(a.name).startsWith(n)) || tierRank[a.tier] - tierRank[b.tier] || b.score - a.score)
    .slice(0, SUGGEST_MAX);
  box.innerHTML = `<button class="sg-row sg-all" data-sg-q="${esc(q)}">${icon("search", 18)}<span>Search for “${esc(q)}”<small>${m.length ? `${m.length} place${m.length > 1 ? "s" : ""} on the map` : "No matches yet"}</small></span></button>`
    + top.map((p) => `<button class="sg-row" data-sg-open="${esc(p.id)}"><span class="sg-ico" style="--cat: var(${catVar(p.colkey || p.category)})">${icon(iconOf(p), 16)}</span><span>${esc(p.name)}<small>${esc(typeLabel(p))} · ${esc(p.mahalle || p.area || "")}</small></span></button>`).join("");
  box.hidden = false;
}
function runSearch(q) {
  $("#search").value = q;
  S.query = q.trim();
  $("#search-clear").hidden = !S.query;
  $("#suggest").hidden = true;
  $("#search").blur();
  refreshPlaces({ fit: !!S.query });
}
$("#search").addEventListener("input", () => {
  $("#search-clear").hidden = !$("#search").value;
  renderSuggest();
});
$("#search").addEventListener("focus", renderSuggest);
$("#search").addEventListener("blur", () => setTimeout(() => { if (document.activeElement !== $("#search")) $("#suggest").hidden = true; }, 150));
$("#search").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); runSearch($("#search").value); }
  if (e.key === "Escape") { $("#suggest").hidden = true; $("#search").blur(); }
});
// pointerdown (not click) so the tap lands before the input's blur hides the list
$("#suggest").addEventListener("pointerdown", (e) => {
  const q = e.target.closest("[data-sg-q]");
  const o = e.target.closest("[data-sg-open]");
  if (!q && !o) return;
  e.preventDefault();
  if (q) return runSearch(q.dataset.sgQ);
  $("#suggest").hidden = true;
  $("#search").blur();
  const id = o.dataset.sgOpen;
  MAP.map.jumpTo({ center: BYID[id].geometry.coordinates, zoom: Math.max(MAP.map.getZoom(), 15.5) });
  openPlace(id);
});
$("#search-clear").addEventListener("click", () => {
  $("#search").value = ""; S.query = ""; $("#search-clear").hidden = true; $("#suggest").hidden = true; refreshPlaces();
});

// ---------- list in view ----------
function inViewPlaces() {
  const b = MAP.map.getBounds();
  const ref = S.near || MAP.map.getCenter().toArray();
  return PLACES.features
    // Every place drawn on the map counts (dots included), so the number matches what you see.
    // Food ("local" tier) only counts once you're close enough to see it, unless a filter or search is on.
    .filter((f) => !f.properties.dim && b.contains(f.geometry.coordinates)
      && (f.properties.tier !== "local" || filterActive() || MAP.map.getZoom() >= CFG.tiers.local.minzoom - 1.2))
    .map((f) => ({ p: f.properties, c: f.geometry.coordinates, d: distM(ref, f.geometry.coordinates) }))
    .sort((a, b) => (S.near ? a.d - b.d : tierRank[a.p.tier] - tierRank[b.p.tier] || b.p.score - a.p.score));
}
// Performance (2026-11-08): after a pan the list is rebuilt only if what it shows changed, and the long list
// (up to 150 rows with photos) only while the sheet is open; setSheet("open") builds it.
let LIST_KEY = "";
function renderList(opts) {
  const auto = opts?.auto;
  const items = inViewPlaces();
  const key = [S.sheet, S.near, S.query, S.chip, MAP.map.getZoom() < 11.8, items.length, ...items.slice(0, S.sheet === "open" ? 150 : 12).map((x) => x.p.id)].join("|");
  if (auto && key === LIST_KEY) return;
  LIST_KEY = key;
  // Always "in view" (2026-11-06, Cem: "Top picks in Istanbul" read as inconsistent). Zoomed right out, nudge to zoom in.
  const city = MAP.map.getZoom() < 11.8;
  $("#list-title").textContent = S.near ? "Closest to you" : S.query ? `Results for “${S.query}”` : filterActive() ? `${(({ title, label }) => title || label)(CFG.chips.find((c) => c.id === S.chip))} in view` : "Top picks in view"; // zoomed out, the sheet bar says "zoom in to explore an area"
  const sub = (x) => `${esc(x.p.area)}${S.near ? ` · ${fmtDist(x.d)}` : ""}`;
  $("#cards").innerHTML = items.length
    ? items.slice(0, 12).map((x) => `<button class="card" data-open="${esc(x.p.id)}">${thumb(x.p)}<div class="card-name">${esc(x.p.name)}</div><div class="card-sub">${sub(x)}</div></button>`).join("")
    : `<p class="empty">Nothing here with these filters. Zoom out or clear the search.</p>`;
  if (S.sheet !== "open") $("#list").innerHTML = ""; else $("#list").innerHTML = items.slice(0, 150).map((x) => `<button class="row" data-open="${esc(x.p.id)}">${thumb(x.p, { pill: false, heart: false })}
      <div class="row-txt"><div class="row-name">${esc(x.p.name)}</div><div class="row-sub">${esc(typeLabel(x.p))} · ${sub(x)}</div></div></button>`).join("")
    || `<p class="empty">Nothing in view.</p>`;
  $("#sheet-toggle").textContent = S.sheet === "open" ? "Show map" : `See all ${items.length}`;
  $("#sheet-bar-txt").textContent = MAP.map.getZoom() < 11.8 && !filterActive() && !S.near
    ? `${items.length} places · zoom in to explore an area` : `${items.length} ${items.length === 1 ? "place" : "places"} in view`;
}

// ---------- bottom sheet: closed / peek / open ----------
function sheetHeights() {
  const appH = $("#app").clientHeight - $(".tabbar").offsetHeight;
  return { closed: 70, peek: Math.min(310, Math.round(appH * 0.42)), open: appH - 72 };
}
function setSheet(state) {
  S.sheet = state;
  const h = sheetHeights();
  const sheet = $("#sheet");
  sheet.dataset.state = state;
  sheet.style.setProperty("--sheet-h", `${h[state]}px`);
  document.documentElement.style.setProperty("--sheet-peek", `${state === "open" ? h.peek : h[state]}px`);
  MAP.map.setPadding({ top: 130, bottom: state === "open" ? h.peek : h[state], left: 0, right: 0 });
  $("#sheet-handle").setAttribute("aria-label", state === "closed" ? "Show the list" : "Drag or tap to resize the list");
  renderList();
}
$("#sheet-toggle").addEventListener("click", () => setSheet(S.sheet === "open" ? "peek" : "open"));
$("#sheet-bar").addEventListener("click", () => setSheet("peek"));
// Drag the sheet by its handle, the "N places" bar or the list header (2026-11-06: was the handle only).
// A flick snaps one step in its direction; a slow drag snaps to the nearest height; a tap on the handle steps up.
(() => {
  const sheet = $("#sheet");
  const ZONES = "#sheet-handle, #sheet-bar, .sheet-head";
  const ORDER = ["closed", "peek", "open"];
  let y0 = null, h0, moved, zone, last, eatClick = false;
  sheet.addEventListener("pointerdown", (e) => {
    zone = e.target.closest(ZONES);
    if (!zone || e.button > 0) return;
    y0 = e.clientY; h0 = sheet.offsetHeight; moved = false; last = [{ y: e.clientY, t: e.timeStamp }];
  });
  window.addEventListener("pointermove", (e) => { // window: a fast first move can land outside the sheet
    if (y0 == null) return;
    const dy = y0 - e.clientY;
    if (!moved && Math.abs(dy) < 6) return; // still a tap
    if (!moved) { moved = true; sheet.classList.add("is-dragging"); try { zone.setPointerCapture(e.pointerId); } catch {} }
    const h = sheetHeights();
    sheet.style.setProperty("--sheet-h", `${Math.max(h.closed, Math.min(h.open, h0 + dy))}px`);
    last.push({ y: e.clientY, t: e.timeStamp }); if (last.length > 5) last.shift();
  });
  const end = (e) => {
    if (y0 == null) return;
    y0 = null;
    sheet.classList.remove("is-dragging");
    if (!moved) { if (zone.id === "sheet-handle") setSheet(S.sheet === "closed" ? "peek" : S.sheet === "peek" ? "open" : "peek"); return; }
    eatClick = true; setTimeout(() => (eatClick = false), 50);
    const a = last[0], b = last[last.length - 1];
    const v = b.t > a.t ? (a.y - b.y) / (b.t - a.t) : 0; // px/ms, up is positive
    const h = sheetHeights(), cur = sheet.offsetHeight;
    let to;
    if (Math.abs(v) > 0.45) { // flick: next state in that direction from where the finger let go
      const above = ORDER.filter((k) => h[k] > cur + 4), below = ORDER.filter((k) => h[k] < cur - 4);
      to = v > 0 ? (above[0] || "open") : (below[below.length - 1] || "closed");
    } else to = Object.entries(h).sort((x, y) => Math.abs(x[1] - cur) - Math.abs(y[1] - cur))[0][0];
    setSheet(to);
  };
  window.addEventListener("pointerup", end);
  window.addEventListener("pointercancel", end);
  sheet.addEventListener("click", (e) => { if (eatClick) { e.stopPropagation(); e.preventDefault(); } }, true); // no tap after a drag
})();

// ---------- hearts + opening ----------
function syncHearts(id) {
  const on = store.isHearted(id);
  document.querySelectorAll(`[data-heart="${CSS.escape(id)}"]`).forEach((x) => { x.classList.toggle("is-on", on); x.setAttribute("aria-pressed", on); });
}
document.addEventListener("click", (e) => {
  const h = e.target.closest("[data-heart]");
  if (h) {
    e.stopPropagation(); e.preventDefault();
    store.toggleHeart(h.dataset.heart);
    syncHearts(h.dataset.heart);
    if ($("#screen-saved").classList.contains("is-active")) renderSaved();
    return;
  }
  const o = e.target.closest("[data-open]");
  if (o) openPlace(o.dataset.open);
}, true);

// ---------- place card ----------
const closeBy = (id, coord) => PLACES.features.filter((f) => f.properties.id !== id && !["bonus", "local"].includes(f.properties.tier))
  .map((f) => ({ p: f.properties, d: distM(coord, f.geometry.coordinates) })).sort((a, b) => a.d - b.d).slice(0, 3);
function dayButtons(id) {
  return CFG.trip.days.map((d) => { const on = store.inDay(id, d.id);
    return `<button class="day-btn" data-day="${d.id}" aria-pressed="${on}"><span class="tick">${icon("check", 16)}</span>${d.label}</button>`; }).join("");
}
// Area character ("vibe") + lifestyle in words, e.g. "Bohemian & creative, with nightlife" (data: 07_areas.py).
const vibeCls = (id) => CFG.vibe.classes.find((c) => c.id === id);
const vibeLife = (id) => CFG.vibe.lifestyles.find((l) => l.id === id);
function vibeWords(primary, secondary, lifestyle) {
  const c = vibeCls(primary);
  if (!c) return "";
  const s = secondary && vibeCls(secondary);
  // Full class name (2026-11-06: "Residential · Mixed" was unclear). The lifestyle is said in words by vibeFeel().
  return `${c.label}${s ? `, with ${s.short.toLowerCase()}` : ""}`;
}
// One plain sentence: what the street life is like, plus the lifestyle feel ("Mosques and meyhanes side by side").
function vibeFeel(primary, lifestyle) {
  const c = vibeCls(primary), l = vibeLife(lifestyle);
  return [c?.feel, l?.feel].filter(Boolean).map((x) => x.replace(/\.?$/, ".")).join(" ");
}

function openPlace(id) {
  const f = BYID[id];
  if (!f) return;
  const p = f.properties, coord = f.geometry.coordinates;
  S.selected = id;
  MAP.select(id);
  // Bring the map to the place, so closing the card leaves you looking at it.
  MAP.map.easeTo({ center: coord, zoom: Math.max(MAP.map.getZoom(), CFG.tiers[p.tier].minzoom + 0.6, 14), duration: 0 });
  const photos = p.photos?.length ? p.photos : [null];
  const el = $("#place");
  el.style.setProperty("--cat", `var(${catVar(p.colkey || p.category)})`);
  const near = closeBy(id, coord);
  // Short description: Wikipedia intro (≤ ~50 words, scripts/08_finish_places.py), else the Wikidata line.
  const about = p.summary || (p.blurb ? p.blurb[0].toUpperCase() + p.blurb.slice(1) : "");
  const real = photos.filter(Boolean);
  el.innerHTML = `
    <div class="gallery">
      <div class="gallery-track">${photos.map((ph, i) => `<div class="gallery-slide">${ph ? `<img alt="${i ? "" : esc(p.name)}" ${i > 1 ? 'loading="lazy"' : ""} draggable="false" data-zoom="${i}" src="${photoUrl(ph.file, 900)}" onerror="this.remove()">` : icon(iconOf(p), 64)}</div>`).join("")}</div>
      <button class="icon-btn g-back" data-close aria-label="Back">${icon("back")}</button>
      <button class="icon-btn g-share" data-share-place aria-label="Share this place">${icon("share")}</button>
      <button class="icon-btn g-heart ${store.isHearted(id) ? "is-on" : ""}" data-heart="${esc(id)}" aria-label="Save" aria-pressed="${store.isHearted(id)}">${icon("heart")}</button>
      ${real.length > 1 ? `<span class="g-count">1 / ${real.length}</span>` : ""}
    </div>
    <div class="place-body">
      <h1 id="place-name">${esc(p.name)}</h1>
      ${p.name_tr && p.name_tr !== p.name ? `<div class="name-tr" lang="tr">${esc(p.name_tr)}</div>` : ""}
      <a class="gmaps" href="https://www.google.com/maps/search/?api=1&query=${coord[1]},${coord[0]}" target="_blank" rel="noopener"><img src="icons/google-maps.png" alt="" width="20" height="20"> Open in Google Maps</a>
      ${about ? `<p class="blurb">${esc(about)}</p>` : ""}
      ${p.tip ? `<p class="blurb">${esc(p.tip)}</p>` : ""}
      <h2 class="section-title">Add to a day</h2>
      <div class="days" id="days">${dayButtons(id)}</div>
      ${near.length ? `<h2 class="section-title">Close by</h2><div class="nearby">${near.map((x) => `<button class="card" data-open="${esc(x.p.id)}">${thumb(x.p, { pill: false, heart: false })}<div class="card-name">${esc(x.p.name)}</div><div class="card-sub">${Math.max(1, Math.round(x.d / 80))} min walk</div></button>`).join("")}</div>` : ""}
    </div>`;
  // Slide up + fade in when the card opens from the map; a card opened from "Close by" just swaps in place.
  const wasOpen = !el.hidden && !el.classList.contains("is-closing");
  el.classList.remove("is-closing");
  clearTimeout(placeT);
  if (!wasOpen) { el.classList.remove("is-opening"); void el.offsetWidth; el.classList.add("is-opening"); }
  el.hidden = false;
  el.scrollTop = 0;
  const track = $(".gallery-track", el), count = $(".g-count", el);
  track?.addEventListener("scroll", () => { if (count) count.textContent = `${Math.round(track.scrollLeft / track.clientWidth) + 1} / ${real.length}`; }, { passive: true });
  history.replaceState(null, "", `${location.pathname}${location.search}#place=${encodeURIComponent(id)}`);
  el.tabIndex = -1;
  el.focus({ preventScroll: true });
}

// Full-screen photo viewer: tap a photo on the place card; swipe sideways, tap ✕ (or the photo) to close.
function openViewer(photos, start) {
  const v = document.createElement("div");
  v.className = "viewer";
  v.setAttribute("role", "dialog");
  v.setAttribute("aria-label", "Photos");
  v.innerHTML = `<div class="viewer-track">${photos.map((ph) => `<div class="viewer-slide"><img draggable="false" alt="" src="${photoUrl(ph.file, 1280)}"></div>`).join("")}</div>
    <button class="icon-btn viewer-x" aria-label="Close photos">${icon("close")}</button>
    ${photos.length > 1 ? `<span class="viewer-count">${start + 1} / ${photos.length}</span>` : ""}`;
  $("#app").appendChild(v);
  const track = $(".viewer-track", v), count = $(".viewer-count", v);
  track.scrollLeft = start * track.clientWidth;
  track.addEventListener("scroll", () => { if (count) count.textContent = `${Math.round(track.scrollLeft / track.clientWidth) + 1} / ${photos.length}`; }, { passive: true });
  v.addEventListener("click", () => v.remove());
}
$("#place").addEventListener("click", (e) => {
  if (e.target.closest("[data-close]")) return closePlace();
  const z = e.target.closest("[data-zoom]");
  if (z) return openViewer(BYID[S.selected].properties.photos, +z.dataset.zoom);
  if (e.target.closest("[data-share-place]")) return sharePlace(S.selected);
  const b = e.target.closest("[data-day]");
  if (!b) return;
  const id = S.selected, day = b.dataset.day;
  const prev = store.dayOf(id);
  const added = store.toggleDay(id, day);
  syncHearts(id);
  $("#days").innerHTML = dayButtons(id);
  $(`[data-day="${day}"]`, $("#days"))?.classList.add("pop");
  const r = store.activeRoute(day);
  const label = `${dayCfg(day).label}${store.routesOf(day).length > 1 && r ? ` · ${r.name}` : ""}`;
  const moved = added && prev && prev !== day;
  toast(moved ? `Moved to ${label}` : added ? `Added to ${label}` : `Removed from ${dayCfg(day).label}`, () => {
    store.toggleDay(id, day);
    if (moved) store.toggleDay(id, prev);
    $("#days").innerHTML = dayButtons(id);
  });
});
// Share one place: a link that opens the app on its card (plus the phone's share sheet when there is one).
async function sharePlace(id) {
  const p = BYID[id]?.properties;
  if (!p) return;
  const url = `${location.origin}${location.pathname}#place=${encodeURIComponent(id)}`;
  const text = `${p.name}: one for our Istanbul trip. Opens in Istanbul Explorer with photos, how to get there and what's nearby.`;
  if (navigator.share) {
    try { await navigator.share({ title: p.name, text, url }); return; } catch (err) { if (err.name === "AbortError") return; }
  }
  try { await navigator.clipboard.writeText(url); toast("Link copied"); } catch { prompt("Copy this link:", url); }
}
let placeT;
function closePlace() {
  const el = $("#place");
  // Slide down + fade out (about 0.2 s) while the selected pin fades on the map: no flash on the way back.
  el.classList.remove("is-opening");
  el.classList.add("is-closing");
  clearTimeout(placeT);
  placeT = setTimeout(() => { el.hidden = true; el.classList.remove("is-closing"); }, matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 200);
  S.selected = null; MAP.select(null);
  history.replaceState(null, "", location.pathname + location.search);
  renderList();
  // Opened from What's here: back goes back to that panel, same spot, same pick (2026-11-08).
  if (HERE_BACK && S.here) { const b = HERE_BACK; HERE_BACK = null; showHere(b.c, { sel: b.sel }); } // re-frame: opening the place moved the map
  HERE_BACK = null;
}
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if ($(".viewer")) return $(".viewer").remove();
  if (!$("#dialog").hidden) return closeDialog();
  if (!$("#place").hidden) closePlace();
});

let toastT;
function toast(msg, undo) {
  const el = $("#toast");
  el.innerHTML = `<span>${esc(msg)}</span>${undo ? `<button>Undo</button>` : ""}`;
  el.hidden = false;
  if (undo) el.querySelector("button").onclick = () => { undo(); el.hidden = true; };
  clearTimeout(toastT); toastT = setTimeout(() => (el.hidden = true), 4500);
}

// ---------- dialogs ----------
function openDialog(html, { dismissable = true } = {}) {
  const d = $("#dialog");
  $("#dialog-card").innerHTML = html;
  $("#dialog-card").onclick = null; // a dialog that needs clicks sets its own after opening
  d.hidden = false;
  d.dataset.dismissable = dismissable;
  // Focus a text field if there is one; otherwise the card itself (focusing a button from code draws its focus ring).
  const field = $("#dialog-card").querySelector("input[autofocus]"); // no keyboard popping up for menus with a rename box
  if (field) field.focus(); else { $("#dialog-card").tabIndex = -1; $("#dialog-card").focus({ preventScroll: true }); }
}
function closeDialog() { if ($("#dialog").dataset.dismissable !== "false") { $("#dialog").hidden = true; $("#dialog").classList.remove("is-sheet"); } }
$("#dialog").addEventListener("click", (e) => { if (e.target.id === "dialog") closeDialog(); });

function askName() {
  openDialog(`<h2>Who's this?</h2>
    <p>So the others can tell whose picks are whose. It stays on this phone. No account.</p>
    <div class="name-opts">${CFG.trip.people.map((n) => `<button data-name="${esc(n)}">${esc(n)}</button>`).join("")}</div>
    <button class="name-visitor" data-name="Visitor">Visitor</button>`, { dismissable: false });
  // "Visitor" (2026-11-06): someone outside the four, e.g. opening a shared link. Same app, saved as "Visitor".
  const done = (n) => { if (!n) return; store.setName(n); $("#dialog").hidden = true; toast(n === "Visitor" ? "Welcome! Tap hearts to save places." : `Hi ${n}! Tap hearts to save places.`); };
  $("#dialog-card").addEventListener("click", (e) => { const b = e.target.closest("[data-name]"); if (b) done(b.dataset.name); });
}

function showCredits() {
  const rows = PLACES.features.filter((f) => f.properties.photos?.length)
    .flatMap((f) => f.properties.photos.map((ph) => ({ place: f.properties.name, ...ph })));
  rows.unshift(SPLASH_CREDIT);
  openDialog(`<h2>Credits</h2>
    <p>Photos from <b>Wikimedia Commons</b>, used under their licences. Place data from <b>Wikidata</b> (CC0); short descriptions from <b>Wikipedia</b> (CC BY-SA 4.0).
    Map data © <b>OpenStreetMap</b> contributors (ODbL), basemap © <b>CARTO</b>. Street and satellite maps © <b>Esri</b>, Maxar, Earthstar Geographics, HERE, Garmin; elevation for the hill shading from <b>Mapzen</b> terrain tiles (AWS Open Data). Weather by <b>Open-Meteo</b> (CC BY 4.0).</p>
    <button class="btn-secondary" data-close-dialog>Close</button>
    <ul class="credits">${rows.map((r) => `<li><b>${esc(r.place)}</b>: “${esc(r.file)}” by ${esc(r.author || "unknown")}, ${esc(r.licence || "see Commons")}</li>`).join("")}</ul>`);
  $("#dialog-card").addEventListener("click", (e) => { if (e.target.closest("[data-close-dialog]")) $("#dialog").hidden = true; });
}
$("#open-credits").addEventListener("click", showCredits);

// ---------- trip badge + splash ----------
function renderBadge() {
  $("#open-splash").innerHTML = countdownCard(CFG);
}
// The day's main route as an ordered list of names (for the splash day pop-up).
function dayPlan(day) {
  const r = BYID ? store.mainRoute(day) : null; // data may still be loading
  if (!r) return [];
  const { seq } = ordered(r);
  return seq.map((x) => x.p.name);
}
async function showSplash(after) {
  const el = $("#splash");
  renderSplash(el, { cfg: CFG, theme: THEME, fc: FC, people: CFG.trip.people, onGo: after, dayPlan });
  if (!FC) { await getForecast(); if (!el.hidden && !el.classList.contains("is-leaving")) updateSplashForecast(el, { cfg: CFG, fc: FC }); }
}
$("#open-splash").addEventListener("click", () => showSplash());
// Edit mode's date slider: show the splash for the previewed day (and refresh the More card).
window.addEventListener("oit:preview-date", () => { renderBadge(); showSplash(); });

// ---------- Look (theme picker for everyone) ----------
const LOCAL_THEME = "oit:theme-local";
async function renderThemePicker() {
  const box = $("#theme-picker");
  if (box.dataset.ready) return;
  const index = await fetch("themes/index.json").then((r) => r.json());
  const presets = await Promise.all(index.presets.map((id) => fetch(`themes/${id}.json`).then((r) => r.json())));
  const cur = THEME.id;
  // Each swatch is a tiny preview of the app in that theme: its background, the map colour, a button
  // and the accent, so "Iznik" no longer suggests the whole app turns blue (2026-11-06).
  box.innerHTML = presets.map((p) => `<button role="radio" aria-checked="${p.id === cur}" data-preset="${p.id}" class="tp" aria-label="${esc(p.label)}: ${esc(p.hint || "")}"
      style="--tp-s:${p.colors.surface};--tp-m:${p.colors["map-land"]};--tp-p:${p.colors.primary};--tp-c:${p.colors.accent};--tp-n:${p.colors.navy}">
      <span class="tp-sw"><i></i><i></i><i></i></span><span class="tp-name">${esc(p.label)}</span><span class="tp-hint">${esc(p.hint || "")}</span></button>`).join("");
  box.dataset.ready = "1";
  box.addEventListener("click", (e) => {
    const b = e.target.closest("[data-preset]");
    if (!b || b.dataset.preset === THEME.id) return;
    try { localStorage.setItem(LOCAL_THEME, JSON.stringify({ preset: b.dataset.preset, overrides: {} })); } catch { return toast("Couldn't save that on this phone"); }
    switchTheme();
  });
}

// ---------- Offline ----------
const swReady = () => ("serviceWorker" in navigator) && (location.protocol === "https:" || location.hostname === "localhost");
function renderOffline(state = {}) {
  const box = $("#offline-box");
  if (!swReady()) { box.innerHTML = `<p class="hint left">Offline saving works once the app is online at its https link.</p>`; return; }
  if (state.running) {
    box.innerHTML = `<div class="progress"><span style="width:${Math.round(state.done / state.total * 100)}%"></span></div>
      <p class="hint left">Saving… ${state.done} of ${state.total}. Keep the app open.</p>`;
    return;
  }
  let saved = null; try { saved = localStorage.getItem("oit:offline"); } catch { /* ignore */ }
  box.innerHTML = `<button class="btn-secondary" id="offline-btn">${icon("download", 20)} ${saved ? "Update offline copy" : "Save for offline"}</button>
    <p class="hint left">${saved ? `Saved ${esc(saved)}. The map, photos and plan work without signal.` : "Saves the map of the whole area, every place and the main photos (about 60 MB). Best on Wi-Fi."}</p>`;
  $("#offline-btn").onclick = saveOffline;
}
async function saveOffline() {
  await navigator.serviceWorker.ready;
  const urls = [];
  // Basemap vector tiles for the study area, zoom 10–14 (MapLibre over-zooms z14 for closer views).
  const style = MAP.map.getStyle();
  const srcUrl = Object.values(style.sources).find((s) => s.type === "vector" && s.url)?.url;
  let tiles = [];
  try { tiles = srcUrl ? (await fetch(srcUrl).then((r) => r.json())).tiles : []; } catch { /* ignore */ }
  const [w, s, e, n] = [28.9, 40.95, 29.21, 41.27];
  const t2 = (lon, lat, z) => [Math.floor((lon + 180) / 360 * 2 ** z), Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * 2 ** z)];
  if (tiles.length) for (let z = 10; z <= 14; z++) {
    const [x0, y0] = t2(w, n, z), [x1, y1] = t2(e, s, z);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) urls.push(tiles[(x + y) % tiles.length].replace("{z}", z).replace("{x}", x).replace("{y}", y));
  }
  // Photos: the card thumbnail of every place, and the first big gallery photo of every must-see / worth-it place.
  for (const f of PLACES.features) {
    const p = f.properties;
    if (!p.photos?.[0]) continue;
    urls.push(photoUrl(p.photos[0].file, THUMB));
    if (p.tier !== "bonus") urls.push(photoUrl(p.photos[0].file, 900));
  }
  const total = urls.length;
  let done = 0, failed = 0;
  renderOffline({ running: true, done, total });
  const queue = [...urls];
  const worker = async () => {
    while (queue.length) {
      const u = queue.shift();
      // Tiles are fetched by MapLibre with CORS; photos by <img> tags (no-cors), so cache each the way it's used.
      const tile = /cartocdn/.test(u);
      try { const r = await fetch(u, { mode: tile ? "cors" : "no-cors" }); if (tile && !r.ok) failed++; } catch { failed++; }
      done++;
      if (done % 20 === 0 || done === total) renderOffline({ running: true, done, total });
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  const when = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  try { localStorage.setItem("oit:offline", when); } catch { /* ignore */ }
  renderOffline();
  toast(failed > total * 0.1 ? `Saved, but ${failed} items failed. Try again on Wi-Fi.` : "Saved for offline");
}

// ---------- Install (Add to Home Screen) ----------
// Android/Chrome offers a real install prompt; iPhone Safari needs Share → Add to Home Screen.
let installEvt = null;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installEvt = e; if ($("#screen-more").classList.contains("is-active")) renderInstall(); });
function renderInstall() {
  const box = $("#install-box");
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (standalone || (!installEvt && !ios)) { box.innerHTML = ""; return; }
  box.innerHTML = `<div class="more-row static"><span>${icon("download")}</span><span><b>Install the app</b>
    <small>${installEvt ? "Opens full screen from your home screen, like a normal app" : "In Safari: tap Share, then “Add to Home Screen”"}</small></span></div>
    ${installEvt ? `<div class="offline-box"><button class="btn-secondary" id="install-btn">Install</button></div>` : ""}`;
  $("#install-btn")?.addEventListener("click", async () => { installEvt.prompt(); await installEvt.userChoice; installEvt = null; renderInstall(); });
}

// ---------- buttons ----------
// ---------- map style (basemap) picker ----------
// Four maps: the theme's own map, a detailed street map, satellite with labels, topographic. Remembered per phone.
const BASES = [
  { id: "default", label: "Auto", hint: "Matches app theme" },
  { id: "streets", label: "Streets", hint: "More detailed" },
  { id: "satellite", label: "Satellite", hint: "Imagery with labels" },
  { id: "hills", label: "Topography", hint: "Hills and mountains" },
];
const BASE_KEY = "oit:basemap";
const getBase = () => { try { const b = localStorage.getItem(BASE_KEY); return EXTRA_BASEMAPS[b] ? b : "default"; } catch { return "default"; } };
function applyBase() {
  const id = getBase();
  MAP.setBasemap(id);
  $("#map-credit").textContent = EXTRA_BASEMAPS[id]?.credit || "© OpenStreetMap · © CARTO";
  document.querySelector(".app").dataset.base = id;
}
function baseThumb(id) { // one z12 tile over the old city as a preview; our own map is drawn from the theme colours
  if (id === "default") return `<svg class="bp-own" viewBox="0 0 60 40" aria-hidden="true"><rect width="60" height="40" style="fill: var(--c-map-land)"/>
    <path d="M0 27c9-2 16 1 22-4s7-12 13-15 13-2 25-6V0H38c-4 6-9 7-14 12S12 22 0 21z" style="fill: var(--c-map-water)"/>
    <path d="M40 40c1-8 6-12 12-14s8-1 8-1v15z" style="fill: var(--c-map-park)"/>
    <path d="M4 36l14-6 10 3 12-9M30 40l-3-7" fill="none" style="stroke: var(--c-map-road)" stroke-width="1.6"/></svg>`;
  if (id === "hills") return `<svg class="bp-own" viewBox="0 0 60 40" aria-hidden="true"><rect width="60" height="40" style="fill: var(--c-map-land)"/>
    <path d="M0 40V30c8-6 12-14 20-14s10 8 16 8 10-12 16-12 8 6 8 6v22z" style="fill: var(--c-ink-2)" opacity=".28"/>
    <path d="M0 40V34c9-4 13-10 20-10s9 6 15 6 11-9 17-9 8 5 8 5v14z" style="fill: var(--c-ink-2)" opacity=".22"/>
    <path d="M38 0c-4 6-9 7-14 9S14 13 0 12V0z" style="fill: var(--c-map-water)"/></svg>`;
  const u = EXTRA_BASEMAPS[id].tiles[0].replace("{z}", 12).replace("{x}", 2377).replace("{y}", 1535);
  return `<img src="${u}" alt="" loading="lazy">`;
}
function toggleBasePop(open = $("#base-pop").hidden) {
  const pop = $("#base-pop");
  $("#btn-base").setAttribute("aria-expanded", open);
  $("#btn-base").classList.toggle("is-on", open);
  if (!open) { pop.hidden = true; return; }
  const cur = getBase();
  pop.innerHTML = `<p class="bp-title">Map style</p><div class="bp-grid">${BASES.map((b) => `<button class="bp-opt" data-base="${b.id}" aria-checked="${b.id === cur}" role="radio">
      ${baseThumb(b.id)}<span class="bp-label">${b.label}</span><span class="bp-hint">${b.hint}</span></button>`).join("")}</div>`;
  pop.hidden = false;
}
$("#btn-base").addEventListener("click", (e) => { e.stopPropagation(); toggleBasePop(); });
$("#base-pop").addEventListener("click", (e) => {
  const b = e.target.closest("[data-base]");
  if (!b) return;
  try { localStorage.setItem(BASE_KEY, b.dataset.base); } catch {}
  applyBase();
  $("#base-pop").querySelectorAll("[data-base]").forEach((x) => x.setAttribute("aria-checked", x === b));
  setTimeout(() => toggleBasePop(false), 180);
});
document.addEventListener("pointerdown", (e) => { if (!$("#base-pop").hidden && !e.target.closest("#base-pop, #btn-base")) toggleBasePop(false); });

$("#btn-home").addEventListener("click", () => MAP.map.flyTo({ center: CFG.map.home, zoom: 15, duration: 800 }));
// North button (2026-11-06): only while the map is turned; the needle turns with the map; tap = face north.
$("#btn-north").addEventListener("click", () => MAP.map.easeTo({ bearing: 0, duration: 500 }));
function wireNorth(map) {
  const btn = $("#btn-north"), needle = btn.querySelector(".north-needle");
  const sync = () => {
    const b = ((map.getBearing() % 360) + 360) % 360;
    btn.hidden = b < 0.5 || b > 359.5;
    needle.style.transform = `rotate(${-map.getBearing()}deg)`;
  };
  map.on("rotate", sync);
  map.on("moveend", sync);
  map.on("rotateend", () => { if (Math.abs(map.getBearing()) < 3 && map.getBearing() !== 0) map.easeTo({ bearing: 0, duration: 200 }); }); // snap the last few degrees
  sync();
}
$("#btn-near").addEventListener("click", () => {
  const b = $("#btn-near");
  if (S.near) { S.near = null; b.classList.remove("is-on"); MAP.setMe(null); renderList(); return; }
  if (!navigator.geolocation) return toast("Location isn't available on this device");
  navigator.geolocation.getCurrentPosition((pos) => {
    S.near = [pos.coords.longitude, pos.coords.latitude];
    b.classList.add("is-on"); MAP.setMe(S.near);
    MAP.map.flyTo({ center: S.near, zoom: Math.max(MAP.map.getZoom(), 14.5), duration: 800 });
  }, () => toast("Couldn't get your location. Check location permission."), { enableHighAccuracy: true, timeout: 10000 });
});

// ---------- Vibe map: off → Character → Lifestyle → off ----------
// While the vibe map is on, the legend replaces the bottom sheet. Tap a row to show only that kind of area;
// tap it again to show all.
S.vibeOnly = [];
function renderVibeLegend() {
  const el = $("#vibe-legend");
  if (!S.vibe) { el.hidden = true; return; }
  const life = S.vibe === "lifestyle";
  const rows = life ? CFG.vibe.lifestyles.map((l) => [l.id, l.label, `--life-${l.id}`]) : CFG.vibe.classes.map((c) => [c.id, c.short, `--vibe-${c.id}`]);
  const one = S.vibeOnly[0];
  const keep = $(".vp-chips", el)?.scrollLeft || 0; // tapping a colour must not jump the row back to the start
  el.innerHTML = `<div class="vp-head">
      <div class="vl-seg" role="tablist" aria-label="Colour the map by">
        <button role="tab" data-vmode="character" aria-selected="${!life}">Character</button>
        <button role="tab" data-vmode="lifestyle" aria-selected="${life}">Lifestyle</button></div>
      <button class="icon-btn small" data-vclose aria-label="Close the vibe map">${icon("close", 18)}</button></div>
    <div class="vp-chips">${rows.map(([id, label, v]) => `<button data-vonly="${id}" aria-pressed="${one === id}" class="${one && one !== id ? "is-off" : ""}">
      <i style="background: var(${v})"></i>${esc(label)}</button>`).join("")}</div>`;
  el.hidden = false;
  $(".vp-chips", el).scrollLeft = keep;
}
$("#vibe-legend").addEventListener("click", (e) => {
  if (e.target.closest("[data-vclose]")) return setVibe(null);
  const m = e.target.closest("[data-vmode]");
  if (m) { S.vibeOnly = []; setVibe(m.dataset.vmode); $(".vp-chips").scrollLeft = 0; return; }
  const o = e.target.closest("[data-vonly]");
  if (!o) return;
  S.vibeOnly = S.vibeOnly[0] === o.dataset.vonly ? [] : [o.dataset.vonly];
  MAP.setVibe(S.vibe, S.vibeOnly);
  renderVibeLegend();
});
// With the vibe map on, a tap on an area (not on a place) says what it's like.
function vibeTap(e) {
  if (!S.vibe || S.here) return;
  if (MAP.map.queryRenderedFeatures(e.point).some((f) => ["places", "fixed"].includes(f.source))) return;
  const a = areaAt([e.lngLat.lng, e.lngLat.lat]);
  if (!a) return;
  const cls = vibeCls(a.primary);
  toast(`${vibeWords(a.primary, a.secondary, a.lifestyle)}. ${vibeFeel(a.primary, a.lifestyle)}`);
}
function setVibe(mode) {
  const wasOn = !!S.vibe;
  if (!mode) S.vibeOnly = [];
  S.vibe = mode;
  MAP.setVibe(mode, S.vibeOnly);
  $("#btn-vibe").classList.toggle("is-on", !!mode);
  $("#btn-vibe").setAttribute("aria-pressed", !!mode);
  renderVibeLegend();
  $("#sheet").hidden = !!mode;
  document.documentElement.classList.toggle("vibe-on", !!mode);
  // The legend floats over the map: the map itself doesn't move (only the small credit line steps up).
  if (mode && !wasOn) document.documentElement.style.setProperty("--sheet-peek", `${$("#vibe-legend").offsetHeight}px`);
  if (!mode && wasOn) setSheet(S.sheet === "open" ? "peek" : S.sheet);
}
$("#btn-vibe").addEventListener("click", () => setVibe(S.vibe ? null : "character"));

// ---------- What's here: tap the map, get the area's vibe and the best things within a short walk ----------
const HERE_M = 500; // ~6 min walk (was 900 m: too big a circle)
function setHereMode(on) {
  S.here = on;
  $("#btn-here").classList.toggle("is-on", on);
  $("#btn-here").setAttribute("aria-pressed", on);
  $("#here-hint").hidden = !on;
  MAP.map.getCanvas().style.cursor = on ? "crosshair" : "";
  // While the tool is on, the filter chips step aside for more map (2026-11-08); filtering is for after.
  $("#app").classList.toggle("is-here", on);
  if (!on) {
    // Only turning the tool off clears the circle and the numbers (the panel's ✕ keeps them on the map).
    if (!$("#dialog").hidden && $("#dialog").classList.contains("is-sheet")) closeHere();
    HERE = null; HERE_BACK = null; MAP.setHere(null);
  }
}
$("#btn-here").addEventListener("click", () => setHereMode(!S.here));
function areaAt(c) {
  // Point-in-polygon on the character areas (ray casting; areas are small enough to scan).
  const inRing = (ring) => { let ins = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > c[1]) !== (yj > c[1]) && c[0] < ((xj - xi) * (c[1] - yi)) / (yj - yi) + xi) ins = !ins; } return ins; };
  const inPoly = (poly) => inRing(poly[0]) && !poly.slice(1).some(inRing);
  return AREAS?.features.find((f) => { const g = f.geometry;
    return g && (g.type === "Polygon" ? inPoly(g.coordinates) : g.type === "MultiPolygon" && g.coordinates.some(inPoly)); })?.properties || null;
}
// The listed places are numbered on the map; tapping a row (or a number on the map) picks it and shows it,
// tapping the picked row again (or its arrow) opens the card (2026-11-08: rows used to open the card straight away,
// which covered the map, so you never saw where anything was).
let HERE = null; // { c, near: [{p, c, d}], sel }
function hereSelect(i, { pan = true } = {}) {
  if (!HERE) return;
  HERE.sel = i;
  MAP.setHere(HERE.c, HERE_M, HERE.near.map((x) => x.c), i);
  document.querySelectorAll(".here-list .row").forEach((r, k) => { r.classList.toggle("is-sel", k === i); r.setAttribute("aria-pressed", k === i); });
  const row = document.querySelectorAll(".here-list .row")[i];
  row?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  if (pan && i >= 0) {
    // Only move if the pick is hidden behind the search bar, the buttons or the panel; then centre it in the gap.
    const m = MAP.map, box = m.getContainer().getBoundingClientRect(), pt = m.project(HERE.near[i].c);
    const top = $(".search-wrap").getBoundingClientRect().bottom - box.top + 10;
    const bottom = $("#dialog-card").getBoundingClientRect().top - box.top - 12;
    if (pt.x < 20 || pt.x > box.width - 68 || pt.y < top || pt.y > bottom) {
      m.easeTo({ center: HERE.near[i].c, padding: { top, bottom: box.height - bottom, left: 16, right: 68 }, duration: 400 });
    }
  }
}
function onMapClick(e) {
  if (!S.here) return vibeTap(e);
  // A tap on one of the numbers picks that place instead of starting a new search.
  const hit = HERE && MAP.map.queryRenderedFeatures(e.point, { layers: ["here-num"] })[0];
  if (hit) {
    if ($("#dialog").hidden) return showHere(HERE.c, { sel: hit.properties.n - 1, fit: false }); // panel closed: bring it back
    return hereSelect(hit.properties.n - 1, { pan: false });
  }
  showHere([e.lngLat.lng, e.lngLat.lat]);
}
// Frame the whole circle in the part of the map you can actually see: below the search bar and chips, left of the
// round buttons, above the results panel (2026-11-08: it was zoomed in too far to see the circle).
function fitHere(c) {
  const m = MAP.map, box = m.getContainer().getBoundingClientRect();
  const top = $(".search-wrap").getBoundingClientRect().bottom - box.top + 10;
  const cardTop = $("#dialog-card").getBoundingClientRect().top;
  const bottom = Math.max(0, box.bottom - cardTop + 12);
  const dx = HERE_M / 84000, dy = HERE_M / 111100;
  // fitBounds adds the map's own padding (kept for the list sheet) to this one: together they were taller than the
  // screen and MapLibre silently didn't move. Clear it first; closeHere() → setSheet() puts it back.
  m.setPadding({ top: 0, bottom: 0, left: 0, right: 0 });
  m.fitBounds([[c[0] - dx, c[1] - dy], [c[0] + dx, c[1] + dy]], { padding: { top, bottom, left: 68, right: 68 }, maxZoom: 15.5 /* even sides: the tapped spot sits in the middle */, duration: 500 });
}
let HERE_BACK = null; // the panel to come back to after opening a place from it
function showHere(c, { sel = -1, fit = true } = {}) {
  $("#here-hint").hidden = true; // done its job; it covered the map (2026-11-08)
  MAP.setHere(c, HERE_M);
  // Neighbourhoods are left out: their names are on the map already (2026-11-08).
  const near = PLACES.features
    .filter((f) => !f.properties.asLabel && f.properties.category !== "Neighbourhoods")
    .map((f) => ({ p: f.properties, c: f.geometry.coordinates, d: distM(c, f.geometry.coordinates) }))
    .filter((x) => x.d <= HERE_M)
    .sort((a, b) => tierRank[a.p.tier] - tierRank[b.p.tier] || b.p.score - a.p.score || a.d - b.d);
  const area = areaAt(c);
  // The neighbourhood name comes from the closest place's mahalle (areas are merged, so they have no single name).
  const named = PLACES.features.map((f) => ({ p: f.properties, d: distM(c, f.geometry.coordinates) })).sort((a, b) => a.d - b.d)[0];
  const where = named && named.d < 1500 ? (named.p.mahalle || named.p.area) : "This spot";
  const cls = area && vibeCls(area.primary);
  const words = area ? vibeWords(area.primary, area.secondary, area.lifestyle) : "";
  const walk = (d) => `${Math.max(1, Math.round((d * 1.25) / 80))} min walk`;
  openDialog(`<div class="here-card">
      <div class="here-head">
        <div><small>What's here</small><h2>${esc(where)}</h2></div>
        <button class="icon-btn small" data-close-here aria-label="Close">${icon("close")}</button>
      </div>
      ${cls ? `<p class="here-vibe"><span class="tag vibe" style="--vibe: var(--vibe-${area.primary})">${esc(words)}</span></p><p class="here-feel">${esc(vibeFeel(area.primary, area.lifestyle))}</p>`
        : `<p class="here-feel">Out on the water, or outside the area we mapped.</p>`}
      <h3 class="section-title">${near.length ? `Best within a ${walk(HERE_M).replace(" walk", "")} walk` : "Nothing we've mapped close by"}</h3>
      ${near.length ? `<p class="hint left here-tip">Tap one to see it on the map, tap again to open it.</p>` : ""}
      <ol class="here-list">${near.slice(0, 8).map((x, i) => `<li><div class="row" role="button" tabindex="0" aria-pressed="false" data-here-pick="${i}">
          <span class="rank">${i + 1}</span>${thumb(x.p, { pill: false, heart: false })}
          <span class="row-txt"><span class="row-name">${esc(x.p.name)}</span><span class="row-sub">${esc(typeLabel(x.p))}${x.p.tier === "must-see" ? " · Must-see" : ""} · ${walk(x.d)}</span></span>
          <button class="here-open" data-here-open="${i}" aria-label="Open ${esc(x.p.name)}">${icon("chevronRight", 18)}</button></div></li>`).join("")}</ol>
      ${near.length > 8 ? `<p class="hint left">${near.length - 8} more on the map inside the circle.</p>` : ""}
    </div>`);
  $("#dialog").classList.add("is-sheet");
  $("#dialog-card").scrollTop = 0; // a new spot starts at the top (it kept the last scroll position)
  HERE = { c, near: near.slice(0, 8), sel: -1 };
  hereSelect(sel, { pan: false });
  if (fit) fitHere(c);
  const open = (i) => { HERE_BACK = { c, sel: i }; const id = HERE.near[i].p.id; closeHere(); openPlace(id); };
  $("#dialog-card").onclick = (ev) => {
    const o = ev.target.closest("[data-here-open]");
    if (o) { ev.stopPropagation(); open(+o.dataset.hereOpen); return; }
    const pick = ev.target.closest("[data-here-pick]");
    if (pick) {
      const i = +pick.dataset.herePick;
      if (HERE?.sel === i) open(i); else hereSelect(i);
      return;
    }
    if (ev.target.closest("[data-close-here]")) closeHere();
  };
}
// Hides the panel only: the circle and the numbers stay on the map (tap a number to bring the panel back),
// until the What's here button is turned off (2026-11-08).
function closeHere() {
  $("#dialog").hidden = true; $("#dialog").classList.remove("is-sheet"); $("#dialog-card").onclick = null; setSheet(S.sheet);
}

// ---------- tabs ----------
function showScreen(name) {
  HERE_BACK = null;
  document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("is-active", x.dataset.screen === name));
  document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("is-active", s.id === `screen-${name}`));
  if (!$("#place").hidden) closePlace();
  if (name === "saved") renderSaved();
  if (name === "more") { renderThemePicker(); renderOffline(); renderInstall(); renderBadge(); }
  if (name === "plan") renderPlan();
  if (name === "explore") MAP.map.resize();
}
document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => showScreen(t.dataset.screen)));
function openFromOtherScreen(id) {
  showScreen("explore");
  MAP.map.jumpTo({ center: BYID[id].geometry.coordinates, zoom: Math.max(MAP.map.getZoom(), 14.5) });
  openPlace(id);
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-open-x]");
  if (b && !e.target.closest("[data-heart], [data-unplan]")) openFromOtherScreen(b.dataset.openX);
});

// ---------- Saved ----------
function renderSaved() {
  const me = store.get();
  const all = people.all();
  // Just your saved places. Tabs only appear once someone has shared their list with you.
  const tabs = [["mine", "Mine"], ...Object.keys(all).map((n) => [`p:${n}`, `${n}'s`])];
  if (!tabs.some(([k]) => k === S.savedTab)) S.savedTab = "mine";
  $("#saved-tabs").hidden = tabs.length < 2;
  $("#saved-tabs").innerHTML = tabs.map(([k, l]) => `<button role="tab" data-saved-tab="${esc(k)}" aria-selected="${k === S.savedTab}">${esc(l)}</button>`).join("");
  const card = (id, badge = "") => { const p = BYID[id].properties; return `<button class="card" data-open-x="${esc(id)}">${thumb(p, { badge })}<div class="card-name">${esc(p.name)}</div><div class="card-sub">${esc(p.area)}</div></button>`; };
  let top = "", ids = [], badgeFor = () => "";
  if (S.savedTab === "mine") {
    ids = me.hearts.filter((id) => BYID[id]);
    // Golden Horn at sunset (Commons; credited on the credits list via places.geojson).
    top = `<section class="share-card" style="--share-photo: url('${photoUrl("Golden Horn Metro Bridge at sunset.jpg", 960)}')">
        <h2>Share your saved places</h2>
        <button class="btn-share" id="share-btn">${icon("share", 18)} Share${ids.length ? ` · ${ids.length}` : ""}</button>
      </section>`;
    const others = Object.entries(all);
    badgeFor = (id) => { const w = others.filter(([, p]) => p.hearts.includes(id)).map(([n]) => n); return w.length ? `${w.join(" & ")} saved this too` : ""; };
  } else {
    const name = S.savedTab.slice(2), p = all[name];
    ids = p.hearts.filter((id) => BYID[id]);
    top = `<div class="asof"><span>${esc(name)}'s list · shared ${fmtAsOf(p.asOf)}</span><button class="link-btn" data-remove-person="${esc(name)}">Remove</button></div>
      <button class="btn-secondary" data-merge="${esc(name)}">Add all to mine</button>
      <p class="hint">If ${esc(name)} changes their list, they just share it again.</p>`;
    badgeFor = (id) => (store.isHearted(id) ? "You saved this too" : "");
  }
  $("#saved-top").innerHTML = top;
  $("#saved-list").innerHTML = ids.length ? ids.map((id) => card(id, badgeFor(id))).join("")
    : `<p class="empty">${S.savedTab === "mine" ? "Tap the heart on any place to save it here." : "Nothing in this list."}</p>`;
  $("#share-btn")?.addEventListener("click", async () => {
    if (!me.hearts.length) return toast("Save a few places first");
    const r = await shareMyPicks();
    if (r === "copied") toast("Link copied. Paste it in the group chat.");
  });
}
$("#screen-saved").addEventListener("click", (e) => {
  const t = e.target.closest("[data-saved-tab]");
  if (t) { S.savedTab = t.dataset.savedTab; return renderSaved(); }
  const mg = e.target.closest("[data-merge]");
  if (mg) { const n = mergeIntoMine(mg.dataset.merge); toast(n ? `Added ${n} places to your picks` : "You already have all of these"); return renderSaved(); }
  const rm = e.target.closest("[data-remove-person]");
  if (rm && confirm(`Remove ${rm.dataset.removePerson}'s snapshot from this phone?`)) { removePerson(rm.dataset.removePerson); S.savedTab = "mine"; renderSaved(); }
});

// ---------- Routes (was "Plan") ----------
// A route = the places you've added to a day. The app orders them nearest-first from the start
// (our flat by default), and between stops says only how you get there: Walk · 8 min / Tram / Ferry / Taxi.
const LEG_ICON = { walk: "walk", tram: "tram", metro: "train", rail: "train", funicular: "tram", ferry: "ship", taxi: "car" };
const rcVar = (r) => `var(--rc-${(r.ci ?? 0) % 5})`;
const rcHex = (r) => getComputedStyle(document.documentElement).getPropertyValue(`--rc-${(r.ci ?? 0) % 5}`).trim();
const ptOf = (id) => ({ id, c: BYID[id].geometry.coordinates, shore: BYID[id].properties.shore, p: BYID[id].properties });
const HOME = () => ({ id: "home", c: CFG.map.home, shore: "europe", home: true });
function startOf(r) { return r.start && r.start !== "home" && BYID[r.start] ? ptOf(r.start) : HOME(); }
function ordered(r) {
  const st = startOf(r);
  return { st, seq: order(st, r.ids.filter((id) => BYID[id] && id !== st.id).map(ptOf)) };
}
function othersRoutes(name) {
  const p = people.all()[name];
  if (!p) return [];
  const byDay = {};
  for (const [id, d] of Object.entries(p.days || {})) (byDay[d] ||= []).push(id);
  return Object.entries(byDay).map(([day, ids], i) => ({ id: `p:${name}:${day}`, day, name: `${name}'s route`, ids, start: "home", ci: 4 - (i % 5), readonly: true }));
}
async function routeFeatures(r) {
  const { st, seq } = ordered(r);
  const color = rcHex(r);
  const legs = seq.length ? await legsGeometry({ start: st, ordered: seq, stops: STOPS, ferries: FERRIES, router: CFG.routes.router }) : [];
  const lines = legs.map((l) => ({ type: "Feature", properties: { mode: l.mode, color, route: r.id }, geometry: { type: "LineString", coordinates: l.coords } }));
  const stops = [{ type: "Feature", properties: { label: "S", start: true, color, route: r.id }, geometry: { type: "Point", coordinates: st.c } },
    ...seq.map((s, i) => ({ type: "Feature", properties: { label: String(i + 1), start: false, color, route: r.id }, geometry: { type: "Point", coordinates: s.c } }))];
  return { lines, stops, bounds: [st.c, ...seq.map((s) => s.c)] };
}
const fc = (features) => ({ type: "FeatureCollection", features });

// Main map: every route switched "on map", each in its own colour, plus a small legend to hide them.
async function renderMapRoutes() {
  const on = store.routes().filter((r) => r.onMap && r.ids.length);
  const parts = await Promise.all(on.map(routeFeatures));
  MAP.setRoutes(fc(parts.flatMap((p) => p.lines)), fc(parts.flatMap((p) => p.stops)));
  const lg = $("#plans-legend");
  lg.hidden = !on.length;
  lg.innerHTML = on.map((r) => `<span class="pl-item" style="--rc:${rcVar(r)}"><i></i>${esc(dayCfg(r.day).label)} · ${esc(r.name)}
    <button data-route-off="${esc(r.id)}" aria-label="Hide ${esc(r.name)} from the map">${icon("close", 14)}</button></span>`).join("");
}
$("#plans-legend").addEventListener("click", (e) => {
  const b = e.target.closest("[data-route-off]");
  if (b) { store.setOnMap(b.dataset.routeOff, false); renderMapRoutes(); }
});

async function renderPlan() {
  const all = people.all();
  const whoOpts = [["me", "My routes"], ...Object.keys(all).map((n) => [n, `${n}'s routes`])];
  if (!whoOpts.some(([k]) => k === S.planWho)) S.planWho = "me";
  $("#plan-who").innerHTML = whoOpts.map(([k, l]) => `<option value="${esc(k)}" ${k === S.planWho ? "selected" : ""}>${esc(l)}</option>`).join("");
  $("#plan-who").hidden = whoOpts.length < 2;
  const st = tripStatus(CFG.trip.days);
  S.planDay = S.planDay || (st.phase === "during" ? CFG.trip.days[st.dayIndex - 1].id : CFG.trip.days[0].id);
  const mine = S.planWho === "me";
  const dayRoutes = (day) => (mine ? store.routesOf(day) : othersRoutes(S.planWho).filter((r) => r.day === day));
  // Day switcher: a calm segmented control (short day + date), a dot when the day has stops.
  $("#plan-tabs").innerHTML = CFG.trip.days.map((d) => {
    const n = dayRoutes(d.id).reduce((s, r) => s + r.ids.length, 0);
    const dt = new Date(d.date + "T12:00:00");
    return `<button class="dseg" role="tab" data-plan="${d.id}" aria-selected="${d.id === S.planDay}" aria-label="${d.label}${n ? `, ${n} stops` : ""}">
      <b>${d.label.slice(0, 3)}</b><small>${dt.getDate()} Nov</small>${n ? "<i></i>" : ""}</button>`;
  }).join("");
  const d = dayCfg(S.planDay);
  const routes = dayRoutes(d.id);
  let r = mine ? store.activeRoute(d.id, true) : routes[0];
  if (!mine && S.planRoute && routes.some((x) => x.id === S.planRoute)) r = routes.find((x) => x.id === S.planRoute);

  // Alternatives only show when there is more than one; the first is the day's main route (shown on the splash).
  const list = mine ? store.routesOf(d.id) : routes;
  $("#route-chips").hidden = list.length < 2;
  $("#route-chips").innerHTML = list.map((x, i) =>
    `<button class="route-chip" role="tab" data-route="${esc(x.id)}" aria-selected="${x.id === r?.id}" style="--rc:${rcVar(x)}"><i></i>${esc(x.name)}${i === 0 ? `<em>Main</em>` : ""}</button>`).join("");

  if (!r) {
    $("#route-head").innerHTML = `<div class="rh-txt"><h1 class="rh-title">${esc(d.label)}</h1></div>`;
    $("#plan-body").innerHTML = `<p class="empty">Nothing for ${d.label} in ${esc(S.planWho)}'s snapshot.</p>`;
    $("#plan-tray").innerHTML = ""; return;
  }
  const { st: start, seq } = ordered(r);
  const startOpts = [["home", "our flat"], ...r.ids.filter((id) => BYID[id]).map((id) => [id, BYID[id].properties.name])];
  const stopsTxt = seq.length ? `${seq.length} stop${seq.length > 1 ? "s" : ""}` : "No stops yet";
  const startName = startOpts.find(([k]) => k === (r.start || "home"))?.[1] || "our flat";
  $("#route-head").innerHTML = `
    <div class="rh-txt">
      <h1 class="rh-title">${esc(d.label)}</h1>
      <div class="rh-sub">${stopsTxt} · from ${mine ? `<button class="rh-start" id="route-start" aria-label="Start from ${esc(startName)}. Change">${esc(startName)}${icon("chevDown", 14)}</button>` : `<span class="rh-start">${esc(startName)}</span>`}</div>
    </div>
    ${seq.length ? `<button class="rh-map ${r.onMap ? "is-on" : ""}" id="route-onmap" aria-pressed="${!!r.onMap}">${icon(r.onMap ? "eyeOff" : "pin", 16)}${r.onMap ? "Hide from map" : "Show on map"}</button>` : ""}
    ${mine ? `<button class="icon-btn small rh-more" id="route-more" aria-label="Route options">${icon("more", 20)}</button>` : ""}`;

  const legRow = (a, b) => { const m = legMode(a, b, STOPS.features);
    return `<div class="leg leg-${m.mode}">${icon(LEG_ICON[m.mode], 15)}<span>${esc(m.label)}</span></div>`; };
  const startRow = `<div class="stop start-stop"><div class="stop-num"><b>${icon(start.home ? "home" : "pin", 14)}</b></div>
    <div class="stop-row"${start.home ? "" : ` data-open-x="${esc(start.id)}" role="button" tabindex="0"`}><div class="stop-txt"><div class="stop-name">${start.home ? "Our flat" : esc(start.p.name)}</div><div class="stop-why">Start${start.home ? " · Cihangir" : ""}</div></div></div></div>`;
  let prev = start;
  const body = seq.map((s, i) => {
    const row = `${legRow(prev, s)}<div class="stop"><div class="stop-num"><b>${i + 1}</b></div>
      <div class="stop-row" data-open-x="${esc(s.id)}" role="button" tabindex="0">${thumb(s.p, { pill: false, heart: false })}
        <div class="stop-txt"><div class="stop-name">${esc(s.p.name)}</div><div class="stop-why">${esc(typeLabel(s.p))} · ${esc(s.p.mahalle || s.p.area)}</div></div>
        ${mine ? `<button class="stop-x" data-unplan="${esc(s.id)}" aria-label="Remove ${esc(s.p.name)}">${icon("close", 16)}</button>` : ""}
      </div></div>`;
    prev = s;
    return row;
  }).join("");
  $("#plan-body").style.setProperty("--rc", rcVar(r));
  $("#plan-body").innerHTML = `${mine ? "" : `<p class="readonly-note">${esc(S.planWho)}'s route, from their link of ${fmtAsOf(all[S.planWho].asOf)}. Read-only.</p>`}
    ${startRow}${body}${seq.length ? "" : `<p class="empty rh-empty">${mine ? `Open a place and tap ${esc(d.label)}, or add one of your saved places below. They'll be put in a sensible order.` : "Nothing here yet."}</p>`}`;

  // Saved places that aren't on any route yet: one tap adds them to this route.
  const free = mine ? store.get().hearts.filter((id) => BYID[id] && !store.dayOf(id)) : [];
  $("#plan-tray").innerHTML = free.length ? `<div class="tray"><h2>Add from your saved places</h2><div class="tray-chips">${free.map((id) =>
    `<button class="tray-chip" data-plan-add="${esc(id)}" aria-label="Add ${esc(BYID[id].properties.name)} to ${esc(d.label)}">${icon("plus", 16)}${esc(BYID[id].properties.name)}</button>`).join("")}</div></div>` : "";

  S.planRoute = r.id;
}

// "Show on map": switch the route on and jump to Explore, framed on it.
async function showRouteOnExplore(r) {
  store.setOnMap(r.id, true);
  await renderMapRoutes();
  showScreen("explore");
  setSheet("closed"); // room for the route; the list is one tap away
  const f = await routeFeatures(r);
  const b = new maplibregl.LngLatBounds();
  [...f.bounds, ...f.lines.flatMap((l) => l.geometry.coordinates)].forEach((c) => b.extend(c));
  MAP.map.fitBounds(b, { padding: { top: 40, bottom: 60, left: 40, right: 80 }, maxZoom: 15.5, duration: 700 }); // on top of the map's own padding
}

$("#plan-tabs").addEventListener("click", (e) => { const b = e.target.closest("[data-plan]"); if (b) { S.planDay = b.dataset.plan; S.planRoute = null; renderPlan(); } });
$("#plan-who").addEventListener("change", (e) => { S.planWho = e.target.value; S.planRoute = null; renderPlan(); });
$("#screen-plan").addEventListener("click", (e) => {
  const chip = e.target.closest("[data-route]");
  if (chip) { if (S.planWho === "me") store.setActive(S.planDay, chip.dataset.route); S.planRoute = chip.dataset.route; return renderPlan(); }
  // Start picker: an in-app list (not the phone's native dropdown), matching the rest of the app.
  if (e.target.closest("#route-start")) {
    const r = store.route(S.planRoute);
    const opts = [["home", "Our flat", "Cihangir"], ...r.ids.filter((id) => BYID[id]).map((id) => [id, BYID[id].properties.name, BYID[id].properties.mahalle || BYID[id].properties.area])];
    const cur = r.start || "home";
    openDialog(`<h2>Start from</h2><div class="menu-list">${opts.map(([k, l, sub]) =>
      `<button class="menu-item ${k === cur ? "is-cur" : ""}" data-start="${esc(k)}">${icon(k === "home" ? "home" : "pin", 20)}<span>${esc(l)}<small>${esc(sub || "")}</small></span>${k === cur ? icon("check", 20) : ""}</button>`).join("")}</div>`);
    $("#dialog-card").onclick = (ev) => {
      const b = ev.target.closest("[data-start]");
      if (!b) return;
      $("#dialog").hidden = true; $("#dialog-card").onclick = null;
      store.setStart(r.id, b.dataset.start); renderPlan(); renderMapRoutes();
    };
    return;
  }
  if (e.target.closest("#route-onmap")) {
    const r = store.route(S.planRoute);
    if (!r) return;
    if (r.onMap) { store.setOnMap(r.id, false); renderMapRoutes(); return renderPlan(); }
    if (store.routes().filter((x) => x.onMap).length >= CFG.routes.max) return toast(`Up to ${CFG.routes.max} routes on the map at once`);
    return showRouteOnExplore(r);
  }
  if (e.target.closest("#route-more")) {
    const r = store.route(S.planRoute);
    const sameDay = store.routesOf(r.day);
    const isMain = sameDay[0]?.id === r.id;
    openDialog(`<h2>${esc(r.name)}</h2>
      <div class="menu-list">
        ${!isMain ? `<button class="menu-item" id="route-main">${icon("check", 20)}<span>Make this the main route<small>Shown first, and on the splash screen</small></span></button>` : ""}
        ${sameDay.length < 3 ? `<button class="menu-item" id="route-new">${icon("plus", 20)}<span>Plan another route for ${esc(dayCfg(r.day).label)}<small>An alternative, e.g. for a rainy day</small></span></button>` : ""}
        <button class="menu-item" id="route-share">${icon("share", 20)}<span>Share my routes and picks</span></button>
      </div>
      <form class="name-other" id="rename-form"><input id="rename-input" value="${esc(r.name)}" maxlength="30" aria-label="Route name"><button class="btn-primary">Rename</button></form>
      <button class="btn-secondary danger" id="route-delete" style="margin-top:12px">Delete this route</button>`);
    const done = () => { $("#dialog").hidden = true; renderPlan(); renderMapRoutes(); };
    $("#route-main")?.addEventListener("click", () => { store.makeMain(r.id); done(); toast(`${r.name} is now the main route`); });
    $("#route-new")?.addEventListener("click", () => { const n = store.newRoute(r.day); S.planRoute = n.id; done(); });
    $("#route-share").addEventListener("click", () => {
      $("#dialog").hidden = true;
      if (!store.get().hearts.length) return toast("Save a few places first");
      shareMyPicks().then((res) => { if (res === "copied") toast("Link copied. Paste it in the group chat."); });
    });
    $("#rename-form").addEventListener("submit", (ev) => { ev.preventDefault(); store.renameRoute(r.id, $("#rename-input").value.trim()); done(); });
    $("#route-delete").addEventListener("click", () => {
      const gone = store.deleteRoute(r.id); S.planRoute = null; done();
      toast(`Deleted ${gone.name}`, () => { store.restoreRoute(gone); renderPlan(); renderMapRoutes(); });
    });
    return;
  }
  const x = e.target.closest("[data-unplan]");
  if (x) {
    e.stopPropagation();
    const id = x.dataset.unplan, rid = S.planRoute;
    store.removeFrom(rid, id); renderPlan(); renderMapRoutes();
    toast(`Removed ${BYID[id].properties.name}`, () => { store.addTo(rid, id); renderPlan(); renderMapRoutes(); });
    return;
  }
  const a = e.target.closest("[data-plan-add]");
  if (a) { store.addTo(S.planRoute, a.dataset.planAdd); renderPlan(); renderMapRoutes(); }
});
store.on(() => { if (MAP) renderMapRoutes(); });

// Loading veil over the map until the first tiles and pins have drawn (or 8 s, whichever comes first).
function mapLoading(on) {
  const el = $("#map-loading");
  if (on) { el.hidden = false; el.classList.remove("is-done"); return; }
  el.classList.add("is-done");
  setTimeout(() => { if (el.classList.contains("is-done")) el.hidden = true; }, 350);
}
async function buildMap(camera) {
  mapLoading(true);
  MAP = await createMap({ container: "map", theme: THEME, config: CFG, data: DATA, onPlace: (id) => { if (!S.here) openPlace(id); },
    onStop: (st) => { if (!S.here) toast(`${st.name} · ${{ metro: "Metro station", tram: "Tram stop", funicular: "Funicular", ferry: "Ferry pier", rail: "Train station" }[st.mode] || "Stop"}${st.lines ? ` (${[].concat(st.lines).join(", ")})` : ""}`); } });
  if (new URLSearchParams(location.search).has("debug")) window.OIT = { MAP, S };
  if (camera) MAP.map.jumpTo(camera);
  wireNorth(MAP.map);
  watchContext(MAP.map);
  MAP.map.on("moveend", () => renderList({ auto: true }));
  // Small spinner by the list title while the map moves or tiles load, so the list never looks stuck (2026-11-06).
  let busyT;
  const busy = (on) => { clearTimeout(busyT); if (on) busyT = setTimeout(() => ($("#list-busy").hidden = false), 150); else $("#list-busy").hidden = true; };
  MAP.map.on("movestart", () => busy(true));
  MAP.map.on("dataloading", () => { if (!MAP.map.areTilesLoaded()) busy(true); });
  MAP.map.on("idle", () => busy(false));
  MAP.map.on("click", onMapClick);
  applyBase();
  renderMapRoutes();
  const done = () => { clearTimeout(t); mapLoading(false); };
  const t = setTimeout(done, 8000);
  MAP.map.once("idle", done);
}
// Freeze recovery (2026-11-08): when an iPhone runs short of graphics memory (satellite tiles, fast zooming) it takes
// the map's WebGL context away; the map then freezes on its last frame while the buttons still work. If the browser
// doesn't hand it back within a moment, rebuild the map in place at the same view (at most 3 times a minute).
let REBUILDS = [];
function watchContext(map) {
  let t;
  map.on("webglcontextlost", () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      if (MAP.map !== map) return;
      REBUILDS = REBUILDS.filter((x) => Date.now() - x < 60000);
      if (REBUILDS.length >= 3) { toast("The map ran out of memory. Close and reopen the app."); return; }
      REBUILDS.push(Date.now());
      await rebuildMap();
    }, 1200);
  });
  map.on("webglcontextrestored", () => clearTimeout(t));
}
async function rebuildMap() {
  const camera = { center: MAP.map.getCenter(), zoom: MAP.map.getZoom(), bearing: MAP.map.getBearing() };
  const vibe = S.vibe;
  try { MAP.map.remove(); } catch { /* already gone */ }
  await buildMap(camera);
  refreshPlaces();
  if (vibe) { S.vibe = null; setVibe(vibe); } else setSheet(S.sheet);
}
// Theme change: re-apply tokens and rebuild the maps in place (no page reload).
async function switchTheme() {
  THEME = await loadTheme();
  const camera = { center: MAP.map.getCenter(), zoom: MAP.map.getZoom(), bearing: MAP.map.getBearing() };
  const vibe = S.vibe;
  MAP.map.remove();
  await buildMap(camera);
  refreshPlaces();
  if (vibe) { S.vibe = null; setVibe(vibe); } else setSheet(S.sheet);
  $("#theme-picker").querySelectorAll("[data-preset]").forEach((b) => b.setAttribute("aria-checked", b.dataset.preset === THEME.id));
}

// ---------- boot ----------
(async function boot() {
  hydrateIcons();
  THEME = await loadTheme();
  const get = (u) => fetch(u).then((r) => { if (!r.ok) throw new Error(u); return r.json(); });
  CFG = await get("config.json");
  // Splash once per app open (not when arriving from a shared link or a place link), shown before anything else.
  const linkHash = /(^#|&)(from|z|place)=/.test(location.hash);
  // Every open, refreshes included (2026-11-06, Cem); not for shared or place links, or ?splash=0.
  const withSplash = !linkHash && params.get("splash") !== "0";
  let splashGone = !withSplash, mapReady = false;
  const afterSplash = () => { splashGone = true; if (mapReady && !store.get().name) askName(); };
  if (withSplash) showSplash(afterSplash);
  document.documentElement.classList.remove("booting");
  let editMod = null;
  if (params.get("edit") === "1") editMod = await import("./edit.js");
  MOCK = params.get("mockweather") === "1" || (editMod ? editMod.mockWeatherOn() : (() => { try { return localStorage.getItem("oit:mockweather") === "1"; } catch { return false; } })());
  const L = Object.fromEntries(CFG.layers.map((l) => [l.id, l.file]));
  const [places, mask, ferries, stops, fixed, areas] = await Promise.all([L.places, L.mask, L.ferries, L.stops, L.fixed, CFG.vibe.file].map(get));
  const labelCats = new Set(CFG.categories.filter((c) => c.asLabel).map((c) => c.id));
  for (const f of places.features) {
    const ki = catCfg(f.properties.category).kindIcons?.[f.properties.kind];
    f.properties.catslug = slug(f.properties.category) + (ki ? `-${f.properties.kind}` : "");
    f.properties.colkey = catCfg(f.properties.category).kindColors?.[f.properties.kind] || f.properties.category;
    f.properties.asLabel = labelCats.has(f.properties.category);
    f.properties.dim = false;
  }
  PLACES = places; STOPS = stops; FERRIES = ferries; AREAS = areas;
  // A chip only shows when the data has something for it (e.g. Food stays hidden until food places are added).
  CFG.chips = CFG.chips.filter((c) => !c.match || places.features.some((f) => Object.entries(c.match).every(([k, v]) => v.includes(f.properties[k]))));
  BYID = Object.fromEntries(places.features.map((f) => [f.properties.id, f]));
  indexCodes(Object.keys(BYID));
  renderBadge();
  renderChips();
  DATA = { places, mask, ferries, stops, fixed, areas };
  await buildMap();
  setSheet("peek");

  const imp = importFromHash();
  if (imp) {
    const msg = { added: `${imp.name}'s ${imp.count} picks added`, updated: `Updated: ${imp.name}'s picks`, same: `You already have this link from ${imp.name}`,
      self: "That's your own link", older: `You already have a newer link from ${imp.name}` }[imp.status];
    toast(msg);
    if (imp.status === "added" || imp.status === "updated") { S.savedTab = `p:${imp.name}`; showScreen("saved"); }
  }
  const m = location.hash.match(/place=([^&]+)/);
  if (m) openPlace(decodeURIComponent(m[1]));
  mapReady = true;
  if (splashGone && !store.get().name) askName();
  if (editMod) editMod.startEditMode(THEME, CFG);
  getForecast();
  if (swReady()) navigator.serviceWorker.register("sw.js").catch(() => {});
})();
