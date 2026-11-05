import { loadTheme, catVar } from "./theme.js";
import { icon } from "./icons.js";
import { createMap, createMiniMap } from "./map.js";
import { store } from "./store.js";
import { tripStatus, sunTimes, forecast, fmtTime, istanbulToday, istMinutes, dayParts } from "./sky.js";
import { order, legMode, legsGeometry } from "./routes.js";
import { renderSplash, badgeText } from "./splash.js";
import { indexCodes, importFromHash, shareMyPicks, people, mergeIntoMine, removePerson, matches, fmtAsOf } from "./share.js";

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const norm = (s) => String(s ?? "").toLocaleLowerCase("tr").normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/ı/g, "i");
const params = new URLSearchParams(location.search);
const hydrateIcons = (root = document) => root.querySelectorAll("[data-icon]").forEach((el) => { el.innerHTML = icon(el.dataset.icon); el.removeAttribute("data-icon"); });

// ---------- geometry ----------
function distM([lon1, lat1], [lon2, lat2]) {
  const r = 6371008.8, p1 = lat1 * Math.PI / 180, p2 = lat2 * Math.PI / 180;
  const a = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(((lon2 - lon1) * Math.PI / 180) / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
}
const fmtDist = (m) => (m < 950 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);

// ---------- state ----------
const S = { chip: "all", query: "", near: null, sheet: "peek", selected: null, savedTab: "mine", planDay: null, planRoute: null, planWho: "me", vibe: null, here: false };
let CFG, THEME, PLACES, BYID, STOPS, FERRIES, AREAS, MAP, FC = null, MOCK = false;

const catCfg = (id) => CFG.categories.find((c) => c.id === id) || { short: id, icon: "pin" };
const tierRank = { "must-see": 0, "worth-it": 1, bonus: 2 };
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
    const hay = norm([p.name, p.name_tr, ...(p.aka || []), p.area, p.mahalle, p.category, catCfg(p.category).short, p.blurb, ...(p.dishes || [])].join(" "));
    if (!norm(S.query).split(/\s+/).every((w) => hay.includes(w))) return false;
  }
  return true;
}
function refreshPlaces({ fit = false } = {}) {
  for (const f of PLACES.features) f.properties.dim = !matchesFilter(f.properties);
  MAP.showAllTiers(filterActive());
  MAP.setPlaces(PLACES);
  renderChips();
  if (fit && filterActive()) fitToMatches();
  else renderList();
}
function fitToMatches() {
  const m = PLACES.features.filter((f) => !f.properties.dim);
  if (!m.length) { renderList(); return; }
  if (m.length === 1) { MAP.map.flyTo({ center: m[0].geometry.coordinates, zoom: 15.5, duration: 700 }); return; }
  const b = new maplibregl.LngLatBounds();
  m.forEach((f) => b.extend(f.geometry.coordinates));
  MAP.map.fitBounds(b, { padding: 40, maxZoom: 15.5, duration: 700 });
}

// ---------- thumbnails ----------
// All small thumbnails use one size (330 px), so one cached copy serves cards, rows and the plan offline.
const THUMB = 330;
function thumb(p, { pill = true, heart = true, badge = "" } = {}) {
  const ph = p.photos?.[0];
  return `<div class="thumb" style="--cat: var(${catVar(p.category)})">
    ${ph ? `<img loading="lazy" alt="" src="${photoUrl(ph.file, THUMB)}" onerror="this.remove()">` : ""}
    ${icon(catCfg(p.category).icon, 30)}
    ${pill && !badge ? `<span class="pill">${esc(catCfg(p.category).short)}</span>` : ""}
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
  refreshPlaces({ fit: true });
});
let searchT;
$("#search").addEventListener("input", (e) => {
  clearTimeout(searchT);
  searchT = setTimeout(() => {
    S.query = e.target.value.trim();
    $("#search-clear").hidden = !S.query;
    refreshPlaces({ fit: !!S.query });
  }, 220);
});
$("#search").addEventListener("keydown", (e) => { if (e.key === "Enter") e.target.blur(); });
$("#search-clear").addEventListener("click", () => {
  $("#search").value = ""; S.query = ""; $("#search-clear").hidden = true; refreshPlaces();
});

// ---------- list in view ----------
function inViewPlaces() {
  const b = MAP.map.getBounds();
  const ref = S.near || MAP.map.getCenter().toArray();
  return PLACES.features
    // Every place drawn on the map counts (dots included), so the number matches what you see.
    .filter((f) => !f.properties.dim && b.contains(f.geometry.coordinates))
    .map((f) => ({ p: f.properties, c: f.geometry.coordinates, d: distM(ref, f.geometry.coordinates) }))
    .sort((a, b) => (S.near ? a.d - b.d : tierRank[a.p.tier] - tierRank[b.p.tier] || b.p.score - a.p.score));
}
function renderList() {
  const items = inViewPlaces();
  $("#list-title").textContent = S.near ? "Closest to you" : S.query ? `Results for “${S.query}”` : filterActive() ? `${CFG.chips.find((c) => c.id === S.chip).label} in view` : "Top picks in view";
  const sub = (x) => `${esc(x.p.area)}${S.near ? ` · ${fmtDist(x.d)}` : ""}`;
  $("#cards").innerHTML = items.length
    ? items.slice(0, 12).map((x) => `<button class="card" data-open="${esc(x.p.id)}">${thumb(x.p)}<div class="card-name">${esc(x.p.name)}</div><div class="card-sub">${sub(x)}</div></button>`).join("")
    : `<p class="empty">Nothing here with these filters. Zoom out or clear the search.</p>`;
  $("#list").innerHTML = items.slice(0, 150).map((x) => `<button class="row" data-open="${esc(x.p.id)}">${thumb(x.p, { pill: false, heart: false })}
      <div class="row-txt"><div class="row-name">${esc(x.p.name)}</div><div class="row-sub">${esc(catCfg(x.p.category).short)} · ${sub(x)}</div></div></button>`).join("")
    || `<p class="empty">Nothing in view.</p>`;
  $("#sheet-toggle").textContent = S.sheet === "open" ? "Show map" : `See all ${items.length}`;
  $("#sheet-bar-txt").textContent = `${items.length} ${items.length === 1 ? "place" : "places"} in view`;
  renderRightNow();
}

// ---------- right now ----------
function currentPart(sunsetMin) {
  const now = istMinutes(new Date());
  return dayParts(sunsetMin).find((p) => now >= p.from && now < p.to)?.id || (now < 540 ? "morning" : "evening");
}
function renderRightNow() {
  const el = $("#rightnow");
  const ref = S.near || CFG.map.home;
  const sun = sunTimes(istanbulToday(), CFG.map.home);
  const now = new Date();
  const minsToSunset = (sun.sunset - now) / 60000;
  const status = tripStatus(CFG.trip.days);
  const part = currentPart(istMinutes(sun.sunset));
  const wx = status.phase === "during" && FC?.status === "ok" ? FC.days[status.today]?.parts?.[part] : null;
  const pool = PLACES.features.filter((f) => !f.properties.dim && f.properties.tier !== "bonus");
  const nearest = (pred) => pool.filter((f) => pred(f.properties))
    .map((f) => ({ p: f.properties, d: distM(ref, f.geometry.coordinates) })).sort((a, b) => a.d - b.d)[0];
  let pick, head, reason, ico;
  if (wx && wx.rain >= 50) {
    pick = nearest((p) => p.indoor && p.tier === "must-see") || nearest((p) => p.indoor);
    head = `Rain likely. ${pick?.p.name} is indoors.`; reason = `${wx.rain}% chance of rain now · ${fmtDist(pick?.d || 0)} away`; ico = "rain";
  } else if (minsToSunset > 0 && minsToSunset < 100) {
    pick = nearest((p) => p.best_time === "golden-hour");
    head = `Golden hour soon${wx ? ", and it's dry" : ""}. Head to ${pick?.p.name}.`; reason = `Sunset ${fmtTime(sun.sunset)}`; ico = "sunset";
  } else if (minsToSunset <= 0 || now < sun.sunrise) {
    pick = nearest((p) => p.best_time === "evening" || p.category === "Neighbourhoods");
    head = `Evening stroll: ${pick?.p.name}.`; reason = "Lively after dark"; ico = "sparkle";
  } else {
    pick = nearest((p) => p.tier === "must-see" && (p.best_time === part || p.best_time === "any")) || nearest((p) => p.tier === "must-see");
    head = `${pick?.p.name} is a good shout now.`; reason = `${fmtDist(pick?.d || 0)} away · sunset ${fmtTime(sun.sunset)}`; ico = "sun";
  }
  if (!pick) { el.hidden = true; return; }
  el.hidden = false;
  el.dataset.open = pick.p.id;
  el.innerHTML = `<span class="rn-ico">${icon(ico, 22)}</span><span class="rn-txt"><small>${status.phase === "before" ? "If you were there right now" : "Right now"}</small><b>${esc(head)}</b><small>${esc(reason)}</small></span>${icon("chevronRight", 20)}`;
}

// ---------- bottom sheet: closed / peek / open ----------
function sheetHeights() {
  const appH = $("#app").clientHeight - parseInt(getComputedStyle(document.documentElement).getPropertyValue("--tabbar-h"));
  return { closed: 70, peek: Math.min(310, Math.round(appH * 0.42)), open: appH - 72 };
}
function setSheet(state) {
  S.sheet = state;
  const h = sheetHeights();
  const sheet = $("#sheet");
  sheet.dataset.state = state;
  sheet.style.setProperty("--sheet-h", `${h[state]}px`);
  document.documentElement.style.setProperty("--sheet-peek", `${state === "open" ? h.peek : h[state]}px`);
  MAP.map.setPadding({ top: 120, bottom: state === "open" ? h.peek : h[state], left: 0, right: 0 });
  $("#sheet-handle").setAttribute("aria-label", state === "closed" ? "Show the list" : "Drag or tap to resize the list");
  renderList();
}
$("#sheet-toggle").addEventListener("click", () => setSheet(S.sheet === "open" ? "peek" : "open"));
$("#sheet-bar").addEventListener("click", () => setSheet("peek"));
(() => {
  const handle = $("#sheet-handle"), sheet = $("#sheet");
  let y0 = null, h0, moved;
  handle.addEventListener("pointerdown", (e) => { y0 = e.clientY; h0 = sheet.offsetHeight; moved = false; sheet.classList.add("is-dragging"); handle.setPointerCapture(e.pointerId); });
  handle.addEventListener("pointermove", (e) => {
    if (y0 == null) return;
    const dy = y0 - e.clientY; if (Math.abs(dy) > 5) moved = true;
    const h = sheetHeights();
    sheet.style.setProperty("--sheet-h", `${Math.max(h.closed, Math.min(h.open, h0 + dy))}px`);
  });
  const end = () => {
    if (y0 == null) return;
    sheet.classList.remove("is-dragging");
    y0 = null;
    if (!moved) return setSheet(S.sheet === "closed" ? "peek" : S.sheet === "peek" ? "open" : "peek");
    const h = sheetHeights(), cur = sheet.offsetHeight;
    const nearest = Object.entries(h).sort((a, b) => Math.abs(a[1] - cur) - Math.abs(b[1] - cur))[0][0];
    setSheet(nearest);
  };
  handle.addEventListener("pointerup", end);
  handle.addEventListener("pointercancel", end);
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
function gettingThere(coord) {
  const { maxWalkM, metersPerMin } = CFG.gettingThere;
  const best = {};
  for (const s of STOPS.features) {
    const d = distM(coord, s.geometry.coordinates);
    if (d > maxWalkM) continue;
    const m = s.properties.mode;
    if (!best[m] || d < best[m].d) best[m] = { d, s: s.properties };
  }
  const rows = Object.keys(best).sort((a, b) => best[a].d - best[b].d).slice(0, 3);
  const label = { tram: "Tram", metro: "Metro", funicular: "Funicular", ferry: "Ferry pier", rail: "Train" };
  const ico = { tram: "tram", metro: "train", funicular: "tram", ferry: "ship", rail: "train" };
  if (!rows.length) return `<div class="go-row"><span class="go-ico" style="--mode: var(--c-ink-2)">${icon("car", 18)}</span><span><b>Taxi is easiest</b><br><small>No station or pier within a ${Math.round(maxWalkM / metersPerMin)}-min walk</small></span></div>`;
  return rows.map((m) => {
    const x = best[m];
    return `<div class="go-row"><span class="go-ico" style="--mode: var(--transit-${m})">${icon(ico[m], 18)}</span>
      <span><b>${esc(x.s.name)}</b> <small>${label[m]}${x.s.lines ? ` · ${esc(x.s.lines)}` : ""}</small><br><small>${Math.max(1, Math.round(x.d / metersPerMin))} min walk · ${fmtDist(x.d)}</small></span></div>`;
  }).join("");
}
const closeBy = (id, coord) => PLACES.features.filter((f) => f.properties.id !== id && f.properties.tier !== "bonus")
  .map((f) => ({ p: f.properties, d: distM(coord, f.geometry.coordinates) })).sort((a, b) => a.d - b.d).slice(0, 3);
function dayButtons(id) {
  return CFG.trip.days.map((d) => { const on = store.inDay(id, d.id);
    return `<button class="day-btn" data-day="${d.id}" aria-pressed="${on}"><span class="tick">${icon("check", 16)}</span>${d.label}</button>`; }).join("");
}
// Area character ("vibe") + lifestyle in words, e.g. "Bohemian, with nightlife · Cosmopolitan" (data: 07_areas.py).
const vibeCls = (id) => CFG.vibe.classes.find((c) => c.id === id);
const vibeLife = (id) => CFG.vibe.lifestyles.find((l) => l.id === id);
function vibeWords(primary, secondary, lifestyle) {
  const c = vibeCls(primary);
  if (!c) return "";
  const s = secondary && vibeCls(secondary);
  return `${c.short}${s ? `, with ${s.short.toLowerCase()}` : ""}${vibeLife(lifestyle) ? ` · ${vibeLife(lifestyle).label}` : ""}`;
}
function vibeTag(p) {
  const ch = p.character;
  if (!ch?.primary) return "";
  return `<span class="tag vibe" style="--vibe: var(--vibe-${ch.primary})">${esc(vibeWords(ch.primary, ch.secondary, p.lifestyle))}</span>`;
}
const BEST = { morning: "in the morning", midday: "around midday", afternoon: "in the afternoon", "golden-hour": "at golden hour", evening: "in the evening", any: "any time" };

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
  el.style.setProperty("--cat", `var(${catVar(p.category)})`);
  const near = closeBy(id, coord);
  const blurb = p.blurb ? p.blurb[0].toUpperCase() + p.blurb.slice(1) : "";
  el.innerHTML = `
    <div class="gallery">
      <div class="gallery-track">${photos.map((ph, i) => `<div class="gallery-slide">${ph ? `<img alt="${i ? "" : esc(p.name)}" ${i > 1 ? 'loading="lazy"' : ""} src="${photoUrl(ph.file, 900)}" onerror="this.remove()">` : icon(catCfg(p.category).icon, 64)}</div>`).join("")}</div>
      <button class="icon-btn g-back" data-close aria-label="Back">${icon("back")}</button>
      <button class="icon-btn g-share" data-share-place aria-label="Share this place">${icon("share")}</button>
      <button class="icon-btn g-heart ${store.isHearted(id) ? "is-on" : ""}" data-heart="${esc(id)}" aria-label="Save" aria-pressed="${store.isHearted(id)}">${icon("heart")}</button>
      ${photos.length > 1 ? `<span class="g-count">1 / ${photos.length} · swipe</span>` : ""}
    </div>
    <div class="place-body">
      <div class="tags">
        <span class="tag cat">${esc(catCfg(p.category).short)}</span>
        ${p.tier !== "bonus" ? `<span class="tag tier">${esc(CFG.tiers[p.tier].label)}</span>` : ""}
        <span class="tag">${esc(p.area)}</span>
        ${vibeTag(p)}
      </div>
      <h1 id="place-name">${esc(p.name)}</h1>
      ${p.name_tr && p.name_tr !== p.name ? `<div class="name-tr" lang="tr">${esc(p.name_tr)}</div>` : ""}
      ${blurb ? `<p class="blurb ${p.blurb_status === "placeholder-wikidata" ? "is-placeholder" : ""}">${esc(blurb)}</p>` : ""}
      ${p.tip ? `<p class="blurb">${esc(p.tip)}</p>` : ""}
      ${p.best_time ? `<div class="besttime">${icon(p.best_time === "golden-hour" ? "sunset" : p.best_time === "evening" ? "sparkle" : "sun", 24)}<span><b>Best ${BEST[p.best_time]}</b>${p.indoor ? "Indoors, so fine in the rain" : "Outdoors, so skip it in heavy rain"}</span></div>` : ""}
      <h2 class="section-title">Add to a day</h2>
      <div class="days" id="days">${dayButtons(id)}</div>
      <h2 class="section-title">Getting there</h2>
      <div class="getting">${gettingThere(coord)}</div>
      ${near.length ? `<h2 class="section-title">Close by</h2><div class="nearby">${near.map((x) => `<button class="card" data-open="${esc(x.p.id)}">${thumb(x.p, { pill: false, heart: false })}<div class="card-name">${esc(x.p.name)}</div><div class="card-sub">${Math.max(1, Math.round(x.d / 80))} min walk</div></button>`).join("")}</div>` : ""}
      <a class="gmaps" href="https://www.google.com/maps/search/?api=1&query=${coord[1]},${coord[0]}" target="_blank" rel="noopener">${icon("pin", 20)} Open in Google Maps</a>
    </div>`;
  el.hidden = false;
  el.scrollTop = 0;
  const track = $(".gallery-track", el), count = $(".g-count", el);
  track?.addEventListener("scroll", () => { if (count) count.textContent = `${Math.round(track.scrollLeft / track.clientWidth) + 1} / ${photos.length} · swipe`; }, { passive: true });
  history.replaceState(null, "", `${location.pathname}${location.search}#place=${encodeURIComponent(id)}`);
  $(".g-back", el).focus({ preventScroll: true });
}
$("#place").addEventListener("click", (e) => {
  if (e.target.closest("[data-close]")) return closePlace();
  if (e.target.closest("[data-share-place]")) return sharePlace(S.selected);
  const b = e.target.closest("[data-day]");
  if (!b) return;
  const id = S.selected, day = b.dataset.day;
  const added = store.toggleDay(id, day);
  syncHearts(id);
  $("#days").innerHTML = dayButtons(id);
  $(`[data-day="${day}"]`, $("#days"))?.classList.add("pop");
  const r = store.activeRoute(day);
  const label = `${dayCfg(day).label}${store.routesOf(day).length > 1 && r ? ` · ${r.name}` : ""}`;
  toast(added ? `Added to ${label}` : `Removed from ${dayCfg(day).label}`, () => {
    store.toggleDay(id, day); $("#days").innerHTML = dayButtons(id);
  });
});
// Share one place: a link that opens the app on its card (plus the phone's share sheet when there is one).
async function sharePlace(id) {
  const p = BYID[id]?.properties;
  if (!p) return;
  const url = `${location.origin}${location.pathname}#place=${encodeURIComponent(id)}`;
  const text = `${p.name}, for our Istanbul trip`;
  if (navigator.share) {
    try { await navigator.share({ title: p.name, text, url }); return; } catch (err) { if (err.name === "AbortError") return; }
  }
  try { await navigator.clipboard.writeText(url); toast("Link copied"); } catch { prompt("Copy this link:", url); }
}
function closePlace() {
  $("#place").hidden = true; S.selected = null; MAP.select(null);
  history.replaceState(null, "", location.pathname + location.search);
  renderList();
}
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
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
  d.hidden = false;
  d.dataset.dismissable = dismissable;
  $("#dialog-card").querySelector("button, input")?.focus();
}
function closeDialog() { if ($("#dialog").dataset.dismissable !== "false") { $("#dialog").hidden = true; $("#dialog").classList.remove("is-sheet"); } }
$("#dialog").addEventListener("click", (e) => { if (e.target.id === "dialog") closeDialog(); });

function askName() {
  openDialog(`<h2>Who's this?</h2>
    <p>Just a first name, so the family can tell whose picks are whose. It stays on this phone. No account.</p>
    <div class="name-opts">${CFG.trip.people.map((n) => `<button data-name="${esc(n)}">${esc(n)}</button>`).join("")}</div>
    <form class="name-other" id="name-form"><input id="name-input" placeholder="Someone else?" maxlength="30" autocomplete="given-name"><button class="btn-primary">OK</button></form>`, { dismissable: false });
  const done = (n) => { if (!n) return; store.setName(n); $("#dialog").hidden = true; toast(`Hi ${n}! Tap hearts to save places.`); };
  $("#dialog-card").addEventListener("click", (e) => { const b = e.target.closest("[data-name]"); if (b) done(b.dataset.name); });
  $("#name-form").addEventListener("submit", (e) => { e.preventDefault(); done($("#name-input").value.trim()); });
}

function showCredits() {
  const rows = PLACES.features.filter((f) => f.properties.photos?.length)
    .flatMap((f) => f.properties.photos.map((ph) => ({ place: f.properties.name, ...ph })));
  openDialog(`<h2>Credits</h2>
    <p>Photos from <b>Wikimedia Commons</b>, used under their licences. Place data from <b>Wikidata</b> (CC0).
    Map data © <b>OpenStreetMap</b> contributors (ODbL), basemap © <b>CARTO</b>. Weather by <b>Open-Meteo</b> (CC BY 4.0).</p>
    <button class="btn-secondary" data-close-dialog>Close</button>
    <ul class="credits">${rows.map((r) => `<li><b>${esc(r.place)}</b>: “${esc(r.file)}” by ${esc(r.author || "unknown")}, ${esc(r.licence || "see Commons")}</li>`).join("")}</ul>`);
  $("#dialog-card").addEventListener("click", (e) => { if (e.target.closest("[data-close-dialog]")) $("#dialog").hidden = true; });
}
$("#open-credits").addEventListener("click", showCredits);

// ---------- trip badge + splash ----------
function renderBadge() {
  $("#open-splash").lastChild.textContent = ` Countdown & trip forecast · ${badgeText(CFG)}`;
}
async function showSplash(after) {
  const el = $("#splash");
  renderSplash(el, { cfg: CFG, theme: THEME, fc: FC, people: CFG.trip.people, onGo: after });
  if (!FC) { await getForecast(); if (!el.hidden && !el.classList.contains("is-leaving")) renderSplash(el, { cfg: CFG, theme: THEME, fc: FC, people: CFG.trip.people, onGo: after }); }
}
$("#open-splash").addEventListener("click", () => showSplash());

// ---------- Look (theme picker for everyone) ----------
const LOCAL_THEME = "oit:theme-local";
async function renderThemePicker() {
  const box = $("#theme-picker");
  if (box.dataset.ready) return;
  const index = await fetch("themes/index.json").then((r) => r.json());
  const presets = await Promise.all(index.presets.map((id) => fetch(`themes/${id}.json`).then((r) => r.json())));
  const cur = THEME.id;
  box.innerHTML = presets.map((p) => `<button role="radio" aria-checked="${p.id === cur}" data-preset="${p.id}" class="tp"
      style="--tp-a:${p.colors.navy};--tp-b:${p.colors.primary};--tp-c:${p.colors.accent};--tp-d:${p.colors["map-land"]}">
      <span class="tp-sw"><i></i><i></i><i></i></span><span class="tp-name">${esc(p.label)}</span></button>`).join("");
  box.dataset.ready = "1";
  box.addEventListener("click", (e) => {
    const b = e.target.closest("[data-preset]");
    if (!b || b.dataset.preset === THEME.id) return;
    try { localStorage.setItem(LOCAL_THEME, JSON.stringify({ preset: b.dataset.preset, overrides: {} })); } catch { return toast("Couldn't save that on this phone"); }
    location.reload();
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

// ---------- buttons ----------
$("#btn-home").addEventListener("click", () => MAP.map.flyTo({ center: CFG.map.home, zoom: 15, duration: 800 }));
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
// Tap a legend row to show only that kind of area (tap more to add; "Show all" clears).
S.vibeOnly = [];
function renderVibeLegend() {
  const el = $("#vibe-legend");
  if (!S.vibe) { el.hidden = true; return; }
  const life = S.vibe === "lifestyle";
  const rows = life ? CFG.vibe.lifestyles.map((l) => [l.id, l.label, `--life-${l.id}`]) : CFG.vibe.classes.map((c) => [c.id, c.short, `--vibe-${c.id}`]);
  const any = S.vibeOnly.length > 0;
  el.innerHTML = `<div class="vl-seg" role="tablist">
      <button role="tab" data-vmode="character" aria-selected="${!life}">Character</button>
      <button role="tab" data-vmode="lifestyle" aria-selected="${life}">Lifestyle</button></div>
    <ul>${rows.map(([id, label, v]) => `<li><button data-vonly="${id}" aria-pressed="${S.vibeOnly.includes(id)}" class="${any && !S.vibeOnly.includes(id) ? "is-off" : ""}">
      <i style="background: var(${v})"></i>${esc(label)}</button></li>`).join("")}</ul>
    ${any ? `<button class="link-btn vl-all" data-vonly="">Show all</button>` : `<p class="vl-tip">Tap one to show only those</p>`}`;
  el.hidden = false;
}
$("#vibe-legend").addEventListener("click", (e) => {
  const m = e.target.closest("[data-vmode]");
  if (m) { S.vibeOnly = []; return setVibe(m.dataset.vmode); }
  const o = e.target.closest("[data-vonly]");
  if (!o) return;
  const id = o.dataset.vonly;
  S.vibeOnly = !id ? [] : S.vibeOnly.includes(id) ? S.vibeOnly.filter((x) => x !== id) : [...S.vibeOnly, id];
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
  toast(`${vibeWords(a.primary, a.secondary, a.lifestyle)}. ${cls?.feel || ""}`);
}
function setVibe(mode) {
  if (!mode) S.vibeOnly = [];
  S.vibe = mode;
  MAP.setVibe(mode, S.vibeOnly);
  $("#btn-vibe").classList.toggle("is-on", !!mode);
  $("#btn-vibe").setAttribute("aria-pressed", !!mode);
  renderVibeLegend();
}
$("#btn-vibe").addEventListener("click", () => setVibe(S.vibe ? null : "character"));

// ---------- What's here: tap the map, get the area's vibe and the best things within a short walk ----------
const HERE_M = 900;
function setHereMode(on) {
  S.here = on;
  $("#btn-here").classList.toggle("is-on", on);
  $("#btn-here").setAttribute("aria-pressed", on);
  $("#here-hint").hidden = !on;
  MAP.map.getCanvas().style.cursor = on ? "crosshair" : "";
  if (!on) MAP.setHere(null);
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
function onMapClick(e) {
  if (!S.here) return vibeTap(e);
  const c = [e.lngLat.lng, e.lngLat.lat];
  MAP.setHere(c, HERE_M);
  // Keep the spot and its circle visible above the results panel.
  const mapH = MAP.map.getContainer().clientHeight;
  const panel = $("#app").clientHeight * 0.56 - (mapH < $("#app").clientHeight ? $("#app").clientHeight - mapH : 0);
  MAP.map.easeTo({ center: c, zoom: 13.4, padding: { top: 110, bottom: Math.max(0, panel), left: 0, right: 0 }, duration: 500 });
  const near = PLACES.features
    .map((f) => ({ p: f.properties, d: distM(c, f.geometry.coordinates) }))
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
      ${cls ? `<p class="here-vibe"><span class="tag vibe" style="--vibe: var(--vibe-${area.primary})">${esc(words)}</span></p><p class="here-feel">${esc(cls.feel)}</p>`
        : `<p class="here-feel">Out on the water, or outside the area we mapped.</p>`}
      <h3 class="section-title">${near.length ? `Best within a ${walk(HERE_M).replace(" walk", "")} walk` : "Nothing we've mapped close by"}</h3>
      <ol class="here-list">${near.slice(0, 8).map((x, i) => `<li><button class="row" data-here-open="${esc(x.p.id)}">
          <span class="rank">${i + 1}</span>${thumb(x.p, { pill: false, heart: false })}
          <span class="row-txt"><span class="row-name">${esc(x.p.name)}</span><span class="row-sub">${esc(catCfg(x.p.category).short)}${x.p.tier === "must-see" ? " · Must-see" : ""} · ${walk(x.d)}</span></span></button></li>`).join("")}</ol>
      ${near.length > 8 ? `<p class="hint left">${near.length - 8} more on the map inside the circle.</p>` : ""}
    </div>`);
  $("#dialog").classList.add("is-sheet");
  $("#dialog-card").onclick = (ev) => {
    const o = ev.target.closest("[data-here-open]");
    if (o) { closeHere(); openPlace(o.dataset.hereOpen); return; }
    if (ev.target.closest("[data-close-here]")) closeHere();
  };
}
function closeHere() { $("#dialog").hidden = true; $("#dialog").classList.remove("is-sheet"); $("#dialog-card").onclick = null; setSheet(S.sheet); }

// ---------- tabs ----------
function showScreen(name) {
  document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("is-active", x.dataset.screen === name));
  document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("is-active", s.id === `screen-${name}`));
  if (!$("#place").hidden) closePlace();
  if (name === "saved") { renderSaved(); renderThemePicker(); renderOffline(); }
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
  const m = matches();
  const tabs = [["mine", `Mine (${me.hearts.filter((id) => BYID[id]).length})`],
    ...Object.entries(all).map(([n, p]) => [`p:${n}`, `${n}'s (${p.hearts.length})`]),
    ["matches", `Matches (${m.length})`]];
  if (!tabs.some(([k]) => k === S.savedTab)) S.savedTab = "mine";
  $("#saved-tabs").innerHTML = tabs.map(([k, l]) => `<button role="tab" data-saved-tab="${esc(k)}" aria-selected="${k === S.savedTab}">${esc(l)}</button>`).join("");
  const card = (id, badge = "") => { const p = BYID[id].properties; return `<button class="card" data-open-x="${esc(id)}">${thumb(p, { badge })}<div class="card-name">${esc(p.name)}</div><div class="card-sub">${esc(p.area)}</div></button>`; };
  let top = "", ids = [], badgeFor = () => "";
  if (S.savedTab === "mine") {
    ids = me.hearts.filter((id) => BYID[id]);
    top = `<div class="share-row"><p>Send your picks to the family chat as a link.</p>
      <button class="btn-pill" id="share-btn">${icon("share", 16)} Share</button></div>`;
    const others = Object.entries(all);
    badgeFor = (id) => { const w = others.filter(([, p]) => p.hearts.includes(id)).map(([n]) => n); return w.length ? `${w.join(" & ")} saved this too` : ""; };
  } else if (S.savedTab === "matches") {
    ids = m.map((x) => x.id).filter((id) => BYID[id]);
    top = `<p class="hint">Places saved by two or more of you.</p>`;
    badgeFor = (id) => m.find((x) => x.id === id).who.join(" · ");
  } else {
    const name = S.savedTab.slice(2), p = all[name];
    ids = p.hearts.filter((id) => BYID[id]);
    top = `<div class="asof"><span>${esc(name)}'s picks · as of ${fmtAsOf(p.asOf)}</span><button class="link-btn" data-remove-person="${esc(name)}">Remove</button></div>
      <button class="btn-secondary" data-merge="${esc(name)}">Merge into mine</button>
      <p class="hint">Snapshots don't update themselves. If ${esc(name)} changes their picks, they share a new link.</p>`;
    badgeFor = (id) => (store.isHearted(id) ? "You both saved this" : "");
  }
  $("#saved-top").innerHTML = top;
  $("#saved-list").innerHTML = ids.length ? ids.map((id) => card(id, badgeFor(id))).join("")
    : `<p class="empty">${S.savedTab === "mine" ? "Tap the heart on any place to save it here." : S.savedTab === "matches" ? "No matches yet. Share links with each other to see them." : "Nothing in this snapshot."}</p>`;
  $("#share-btn")?.addEventListener("click", async () => {
    if (!me.hearts.length) return toast("Save a few places first");
    const r = await shareMyPicks();
    if (r === "copied") toast("Link copied. Paste it in the family chat.");
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
let MINI = null;
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
  $("#plan-tabs").innerHTML = CFG.trip.days.map((d) => {
    const n = dayRoutes(d.id).reduce((s, r) => s + r.ids.length, 0);
    return `<button class="day-tab" role="tab" data-plan="${d.id}" aria-selected="${d.id === S.planDay}">${d.label}${n ? `<small>${n}</small>` : ""}</button>`;
  }).join("");
  const d = dayCfg(S.planDay);
  const routes = dayRoutes(d.id);
  let r = mine ? store.activeRoute(d.id, true) : routes[0];
  if (!mine && S.planRoute && routes.some((x) => x.id === S.planRoute)) r = routes.find((x) => x.id === S.planRoute);

  // route chips: one per alternative, plus "+ Another route"
  $("#route-chips").innerHTML = (mine ? store.routesOf(d.id) : routes).map((x) =>
    `<button class="route-chip" role="tab" data-route="${esc(x.id)}" aria-selected="${x.id === r?.id}" style="--rc:${rcVar(x)}"><i></i>${esc(x.name)}</button>`).join("")
    + (mine && store.routesOf(d.id).length < 3 ? `<button class="route-chip add" data-route-new>${icon("plus", 16)} Another route</button>` : "");

  if (!r) {
    $("#route-tools").innerHTML = ""; $("#plan-body").innerHTML = `<p class="empty">Nothing for ${d.label} in ${esc(S.planWho)}'s snapshot.</p>`;
    $("#plan-tray").innerHTML = ""; showMini(null); return;
  }
  const { st: start, seq } = ordered(r);
  const startOpts = [["home", "Our flat"], ...r.ids.filter((id) => BYID[id]).map((id) => [id, BYID[id].properties.name])];
  $("#route-tools").innerHTML = `
    <label class="start-pick" aria-label="Where this route starts"><span class="sp-lbl">${icon("pin", 16)}From</span>${icon("chevDown", 16)}
      <select id="route-start" ${mine ? "" : "disabled"}>${startOpts.map(([k, l]) => `<option value="${esc(k)}" ${(r.start || "home") === k ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></label>
    ${mine ? `<label class="switch"><input type="checkbox" id="route-onmap" ${r.onMap ? "checked" : ""}><span class="sw"></span>On map</label>
      <button class="icon-btn small" id="route-share" aria-label="Share my routes and picks">${icon("share", 18)}</button>
      <button class="icon-btn small" id="route-more" aria-label="Rename or delete ${esc(r.name)}">${icon("more", 20)}</button>` : ""}`;

  const legRow = (a, b) => { const m = legMode(a, b, STOPS.features);
    return `<div class="leg leg-${m.mode}">${icon(LEG_ICON[m.mode], 16)}<span>${esc(m.label)}</span></div>`; };
  const startRow = start.home
    ? `<div class="stop start-stop"><div class="stop-num"><b>S</b></div><div class="stop-card"><span class="home-dot">${icon("home", 20)}</span><div class="stop-txt"><div class="stop-name">Our flat</div><div class="stop-why">Cihangir · start</div></div></div></div>`
    : `<div class="stop start-stop"><div class="stop-num"><b>S</b></div><div class="stop-card" data-open-x="${esc(start.id)}" role="button" tabindex="0">${thumb(start.p, { pill: false, heart: false })}<div class="stop-txt"><div class="stop-name">${esc(start.p.name)}</div><div class="stop-why">Start</div></div></div></div>`;
  let prev = start;
  const body = seq.map((s, i) => {
    const row = `${legRow(prev, s)}<div class="stop"><div class="stop-num"><b>${i + 1}</b></div>
      <div class="stop-card" data-open-x="${esc(s.id)}" role="button" tabindex="0">${thumb(s.p, { pill: false, heart: false })}
        <div class="stop-txt"><div class="stop-name">${esc(s.p.name)}</div><div class="stop-why">${esc(s.p.mahalle || s.p.area)}</div></div>
        ${mine ? `<button class="stop-x" data-unplan="${esc(s.id)}" aria-label="Remove ${esc(s.p.name)}">${icon("close", 18)}</button>` : ""}
      </div></div>`;
    prev = s;
    return row;
  }).join("");
  $("#plan-body").style.setProperty("--rc", rcVar(r));
  $("#plan-body").innerHTML = `${mine ? "" : `<p class="readonly-note">${esc(S.planWho)}'s route, from their link of ${fmtAsOf(all[S.planWho].asOf)}. Read-only.</p>`}
    ${startRow}${body || `<p class="empty">Nothing on this route yet.${mine ? " Open a place and tap a day, or add from your saved places below." : ""}</p>`}`;

  // Saved places that aren't on any route yet: one tap adds them to this route.
  const free = mine ? store.get().hearts.filter((id) => BYID[id] && !store.dayOf(id)) : [];
  $("#plan-tray").innerHTML = free.length ? `<div class="tray"><h2>Saved, not in a route yet</h2><div class="tray-chips">${free.map((id) =>
    `<button class="tray-chip" data-plan-add="${esc(id)}" aria-label="Add ${esc(BYID[id].properties.name)} to ${esc(r.name)}">${icon("plus", 18)}${esc(BYID[id].properties.name)}</button>`).join("")}</div></div>` : "";

  S.planRoute = r.id;
  showMini(r);
}

async function showMini(r) {
  const empty = $("#route-map-empty");
  if (!MINI) MINI = await createMiniMap({ container: "route-map", theme: THEME, config: CFG });
  MINI.map.resize();
  if (!r || !r.ids.length) {
    MINI.setRoutes(fc([]), fc([]));
    empty.hidden = false; empty.textContent = "Add places to this day and they'll appear here in order.";
    MINI.map.jumpTo({ center: CFG.map.home, zoom: 13 });
    return;
  }
  empty.hidden = true;
  const f = await routeFeatures(r);
  if (S.planRoute !== r.id) return; // user moved on
  MINI.setRoutes(fc(f.lines), fc(f.stops));
  const b = new maplibregl.LngLatBounds();
  [...f.bounds, ...f.lines.flatMap((l) => l.geometry.coordinates)].forEach((c) => b.extend(c));
  MINI.map.fitBounds(b, { padding: 34, maxZoom: 15.5, duration: 0 });
}

$("#plan-tabs").addEventListener("click", (e) => { const b = e.target.closest("[data-plan]"); if (b) { S.planDay = b.dataset.plan; S.planRoute = null; renderPlan(); } });
$("#plan-who").addEventListener("change", (e) => { S.planWho = e.target.value; S.planRoute = null; renderPlan(); });
$("#screen-plan").addEventListener("change", (e) => {
  if (e.target.id === "route-start") { store.setStart(S.planRoute, e.target.value); renderPlan(); renderMapRoutes(); }
  if (e.target.id === "route-onmap") {
    const onCount = store.routes().filter((x) => x.onMap).length;
    if (e.target.checked && onCount >= CFG.routes.max) { e.target.checked = false; return toast(`Up to ${CFG.routes.max} routes on the map at once`); }
    store.setOnMap(S.planRoute, e.target.checked); renderMapRoutes();
    if (e.target.checked) toast("Showing on the Explore map");
  }
});
$("#screen-plan").addEventListener("click", (e) => {
  const chip = e.target.closest("[data-route]");
  if (chip) { if (S.planWho === "me") store.setActive(S.planDay, chip.dataset.route); S.planRoute = chip.dataset.route; return renderPlan(); }
  if (e.target.closest("[data-route-new]")) { store.newRoute(S.planDay); return renderPlan(); }
  if (e.target.closest("#route-share")) {
    if (!store.get().hearts.length) return toast("Add a few places first");
    shareMyPicks().then((res) => { if (res === "copied") toast("Link copied. Paste it in the family chat."); });
    return;
  }
  if (e.target.closest("#route-more")) {
    const r = store.route(S.planRoute);
    openDialog(`<h2>${esc(r.name)}</h2>
      <form class="name-other" id="rename-form"><input id="rename-input" value="${esc(r.name)}" maxlength="30" aria-label="Route name"><button class="btn-primary">Rename</button></form>
      <button class="btn-secondary danger" id="route-delete" style="margin-top:12px">Delete this route</button>`);
    $("#rename-form").addEventListener("submit", (ev) => { ev.preventDefault(); store.renameRoute(r.id, $("#rename-input").value.trim()); $("#dialog").hidden = true; renderPlan(); renderMapRoutes(); });
    $("#route-delete").addEventListener("click", () => {
      const gone = store.deleteRoute(r.id); $("#dialog").hidden = true; S.planRoute = null; renderPlan(); renderMapRoutes();
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

// ---------- boot ----------
(async function boot() {
  hydrateIcons();
  THEME = await loadTheme();
  const get = (u) => fetch(u).then((r) => { if (!r.ok) throw new Error(u); return r.json(); });
  CFG = await get("config.json");
  let editMod = null;
  if (params.get("edit") === "1") editMod = await import("./edit.js");
  MOCK = params.get("mockweather") === "1" || (editMod ? editMod.mockWeatherOn() : (() => { try { return localStorage.getItem("oit:mockweather") === "1"; } catch { return false; } })());
  const L = Object.fromEntries(CFG.layers.map((l) => [l.id, l.file]));
  const [places, mask, ferries, stops, fixed, areas] = await Promise.all([L.places, L.mask, L.ferries, L.stops, L.fixed, CFG.vibe.file].map(get));
  const labelCats = new Set(CFG.categories.filter((c) => c.asLabel).map((c) => c.id));
  for (const f of places.features) {
    f.properties.catslug = slug(f.properties.category);
    f.properties.asLabel = labelCats.has(f.properties.category);
    f.properties.dim = false;
  }
  PLACES = places; STOPS = stops; FERRIES = ferries; AREAS = areas;
  BYID = Object.fromEntries(places.features.map((f) => [f.properties.id, f]));
  indexCodes(Object.keys(BYID));
  renderBadge();
  renderChips();
  MAP = await createMap({ container: "map", theme: THEME, config: CFG, data: { places, mask, ferries, stops, fixed, areas }, onPlace: (id) => { if (!S.here) openPlace(id); } });
  if (new URLSearchParams(location.search).has("debug")) window.OIT = { MAP, S };
  MAP.map.on("moveend", renderList);
  MAP.map.on("click", onMapClick);
  setSheet("peek");
  renderMapRoutes();

  const imp = importFromHash();
  if (imp) {
    const msg = { added: `${imp.name}'s ${imp.count} picks added`, updated: `Updated: ${imp.name}'s picks`, same: `You already have this link from ${imp.name}`,
      self: "That's your own link", older: `You already have a newer link from ${imp.name}` }[imp.status];
    toast(msg);
    if (imp.status === "added" || imp.status === "updated") { S.savedTab = `p:${imp.name}`; showScreen("saved"); }
  }
  const m = location.hash.match(/place=([^&]+)/);
  if (m) openPlace(decodeURIComponent(m[1]));
  const afterSplash = () => { if (!store.get().name) askName(); };
  // Splash once per app open (not when arriving from a shared link or a place link).
  let seen = false; try { seen = sessionStorage.getItem("oit:splash") === "1"; sessionStorage.setItem("oit:splash", "1"); } catch { /* ignore */ }
  if (!imp && !m && !seen && params.get("splash") !== "0") showSplash(afterSplash); else afterSplash();
  if (editMod) editMod.startEditMode(THEME);
  getForecast().then(renderRightNow);
  if (swReady()) navigator.serviceWorker.register("sw.js").catch(() => {});
})();
