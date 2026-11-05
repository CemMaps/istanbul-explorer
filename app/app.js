import { loadTheme, catVar } from "./theme.js";
import { icon } from "./icons.js";
import { createMap } from "./map.js";
import { store } from "./store.js";
import { tripStatus, sunTimes, forecast, fmtTime, istanbulToday, istMinutes, dayParts } from "./sky.js";
import { suggest } from "./plan.js";
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
const S = { chip: "all", query: "", near: null, sheet: "peek", selected: null, savedTab: "mine", planDay: null, planMode: "suggested", planWho: "me" };
let CFG, THEME, PLACES, BYID, STOPS, MAP, FC = null, MOCK = false;

const catCfg = (id) => CFG.categories.find((c) => c.id === id) || { short: id, icon: "pin" };
const tierRank = { "must-see": 0, "worth-it": 1, bonus: 2 };
const photoUrl = (file, w = 480) => `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=${w}`;
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
function thumb(p, { pill = true, heart = true, w = 400, badge = "" } = {}) {
  const ph = p.photos?.[0];
  return `<div class="thumb" style="--cat: var(${catVar(p.category)})">
    ${ph ? `<img loading="lazy" alt="" src="${photoUrl(ph.file, w)}" onerror="this.remove()">` : ""}
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
    return `<button class="chip" data-chip="${c.id}" aria-pressed="${on}">${esc(c.label)}${n != null ? ` <span class="count">${n}</span>` : ""}</button>`;
  }).join("");
}
$("#chips").addEventListener("click", (e) => {
  const b = e.target.closest("[data-chip]");
  if (!b) return;
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
  const b = MAP.map.getBounds(), z = MAP.map.getZoom();
  const ref = S.near || MAP.map.getCenter().toArray();
  return PLACES.features
    .filter((f) => !f.properties.dim && b.contains(f.geometry.coordinates) && (filterActive() || z >= CFG.tiers[f.properties.tier].minzoom - 0.01))
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
  $("#list").innerHTML = items.slice(0, 150).map((x) => `<button class="row" data-open="${esc(x.p.id)}">${thumb(x.p, { pill: false, heart: false, w: 160 })}
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
  el.innerHTML = `<span class="rn-ico">${icon(ico, 22)}</span><span class="rn-txt"><small>Right now${status.phase === "before" ? " · preview" : ""}</small><b>${esc(head)}</b><small>${esc(reason)}</small></span>${icon("chevronRight", 20)}`;
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
  MAP.map.setPadding({ top: 150, bottom: state === "open" ? h.peek : h[state], left: 0, right: 0 });
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
  const cur = store.dayOf(id);
  return CFG.trip.days.map((d) => `<button class="day-btn" data-day="${d.id}" aria-pressed="${cur === d.id}"><span class="tick">${icon("check", 16)}</span>${d.label}</button>`).join("");
}
const BEST = { morning: "in the morning", midday: "around midday", afternoon: "in the afternoon", "golden-hour": "at golden hour", evening: "in the evening", any: "any time" };

function openPlace(id) {
  const f = BYID[id];
  if (!f) return;
  const p = f.properties, coord = f.geometry.coordinates;
  S.selected = id;
  MAP.select(id);
  const photos = p.photos?.length ? p.photos : [null];
  const el = $("#place");
  el.style.setProperty("--cat", `var(${catVar(p.category)})`);
  const near = closeBy(id, coord);
  const blurb = p.blurb ? p.blurb[0].toUpperCase() + p.blurb.slice(1) : "";
  el.innerHTML = `
    <div class="gallery">
      <div class="gallery-track">${photos.map((ph, i) => `<div class="gallery-slide">${ph ? `<img alt="${i ? "" : esc(p.name)}" ${i > 1 ? 'loading="lazy"' : ""} src="${photoUrl(ph.file, 900)}" onerror="this.remove()">` : icon(catCfg(p.category).icon, 64)}</div>`).join("")}</div>
      <button class="icon-btn g-back" data-close aria-label="Back">${icon("back")}</button>
      <button class="icon-btn g-heart ${store.isHearted(id) ? "is-on" : ""}" data-heart="${esc(id)}" aria-label="Save" aria-pressed="${store.isHearted(id)}">${icon("heart")}</button>
      ${photos.length > 1 ? `<span class="g-count">1 / ${photos.length} · swipe</span>` : ""}
    </div>
    <div class="place-body">
      <div class="tags">
        <span class="tag cat">${esc(catCfg(p.category).short)}</span>
        ${p.tier !== "bonus" ? `<span class="tag tier">${esc(CFG.tiers[p.tier].label)}</span>` : ""}
        <span class="tag">${esc(p.area)} · ${p.shore === "asia" ? "Asia" : "Europe"} side</span>
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
      ${near.length ? `<h2 class="section-title">Close by</h2><div class="nearby">${near.map((x) => `<button class="card" data-open="${esc(x.p.id)}">${thumb(x.p, { pill: false, heart: false, w: 240 })}<div class="card-name">${esc(x.p.name)}</div><div class="card-sub">${Math.max(1, Math.round(x.d / 80))} min walk</div></button>`).join("")}</div>` : ""}
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
  const b = e.target.closest("[data-day]");
  if (!b) return;
  const id = S.selected, day = b.dataset.day;
  const was = store.dayOf(id);
  const next = was === day ? null : day;
  store.setDay(id, next);
  syncHearts(id);
  $("#days").innerHTML = dayButtons(id);
  $(`[data-day="${day}"]`, $("#days"))?.classList.add("pop");
  const label = dayCfg(day).label;
  toast(next ? `Added to ${label}${was ? ` (moved from ${dayCfg(was).label})` : ""}` : `Removed from ${label}`, () => {
    store.setDay(id, was); $("#days").innerHTML = dayButtons(id);
  });
});
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
function closeDialog() { if ($("#dialog").dataset.dismissable !== "false") $("#dialog").hidden = true; }
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

// ---------- countdown + forecast panel ----------
function renderCountdown() {
  const st = tripStatus(CFG.trip.days);
  const d = CFG.trip.days;
  if (st.phase === "before") { $("#cd-num").textContent = st.daysToGo; $("#cd-label").textContent = st.daysToGo === 1 ? "day to go" : "days to go"; }
  else if (st.phase === "during") { $("#cd-num").textContent = `Day ${st.dayIndex}`; $("#cd-label").textContent = `of ${st.of}`; }
  else { $("#cd-num").textContent = "Teşekkürler"; $("#cd-label").textContent = "thanks for a great trip"; }
  $("#cd-sub").textContent = `Istanbul · ${d[0].label} to ${d[d.length - 1].label}`;
  if (THEME.app.logo) { $("#logo").src = THEME.app.logo; $("#logo").hidden = false; }
}
$("#countdown").addEventListener("click", async () => {
  const btn = $("#countdown"), panel = $("#forecast-panel");
  const open = btn.getAttribute("aria-expanded") !== "true";
  btn.setAttribute("aria-expanded", open);
  panel.hidden = !open;
  if (!open) return;
  panel.innerHTML = `<p class="fc-empty">Loading…</p>`;
  const fc = await getForecast();
  const cells = CFG.trip.days.map((d) => {
    const w = fc.days[d.date];
    const sun = sunTimes(d.date, CFG.map.home);
    return `<div class="fc-day"><b>${d.label}</b>${w ? `${icon(w.icon, 26)}<div class="fc-temp">${w.max}°<small> / ${w.min}°</small></div><div>${w.rain}% rain</div>` : icon("sunset", 26)}<div>Sunset ${fmtTime(sun.sunset)}</div></div>`;
  }).join("");
  const note = fc.status === "too-early" ? "Forecast appears closer to the trip (about 2 weeks before)." :
    fc.status === "error" ? "Couldn't load the forecast. Try again later." : "Forecast by Open-Meteo";
  panel.innerHTML = `<div class="fc-days">${cells}</div>
    <div class="fc-note"><span>${fc.sample ? `<span class="tag-sample">Sample forecast</span>` : note}</span><span>Sunrise ≈ ${fmtTime(sunTimes(CFG.trip.days[0].date, CFG.map.home).sunrise)}</span></div>`;
});

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

// ---------- tabs ----------
function showScreen(name) {
  document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("is-active", x.dataset.screen === name));
  document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("is-active", s.id === `screen-${name}`));
  if (!$("#place").hidden) closePlace();
  if (name === "saved") renderSaved();
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
  if (b && !e.target.closest("[data-heart], [data-unplan], [data-plan-add]")) openFromOtherScreen(b.dataset.openX);
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
    top = `<button class="btn-primary" id="share-btn">${icon("share", 20)} Share my picks</button>
      <p class="hint">Makes a link for the family chat. No accounts, nothing stored on a server.</p>`;
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

// ---------- Plan ----------
async function renderPlan() {
  const all = people.all();
  const whoOpts = [["me", `${store.get().name || "My"} plan`], ...Object.keys(all).map((n) => [n, `${n}'s plan`])];
  if (!whoOpts.some(([k]) => k === S.planWho)) S.planWho = "me";
  $("#plan-who").innerHTML = whoOpts.map(([k, l]) => `<option value="${esc(k)}" ${k === S.planWho ? "selected" : ""}>${esc(l)}</option>`).join("");
  $("#plan-who").hidden = whoOpts.length < 2;
  const st = tripStatus(CFG.trip.days);
  S.planDay = S.planDay || (st.phase === "during" ? CFG.trip.days[st.dayIndex - 1].id : CFG.trip.days[0].id);
  $("#plan-tabs").innerHTML = CFG.trip.days.map((d) => `<button class="day-tab" role="tab" data-plan="${d.id}" aria-selected="${d.id === S.planDay}">${d.label}</button>`).join("");
  document.querySelectorAll("#plan-mode [data-mode]").forEach((b) => b.setAttribute("aria-selected", b.dataset.mode === S.planMode));

  const mine = S.planWho === "me";
  const src = mine ? store.get() : all[S.planWho];
  const d = dayCfg(S.planDay);
  const addedAt = mine ? src.addedAt : {};
  const ids = Object.keys(src.days).filter((id) => src.days[id] === S.planDay && BYID[id])
    .sort((a, b) => (addedAt[a] || 0) - (addedAt[b] || 0) || src.hearts.indexOf(a) - src.hearts.indexOf(b));

  // weather strip
  const fc = await getForecast();
  const sun = sunTimes(d.date, CFG.map.home);
  const w = fc.days[d.date];
  const parts = dayParts(istMinutes(sun.sunset)).filter((p) => p.id !== "golden-hour");
  $("#plan-weather").innerHTML = `<div class="wx">${w ? `<div class="wx-parts">${parts.map((p) => { const x = w.parts[p.id]; return `<div>${esc(p.label)}${x ? `${icon(x.icon, 24)}<b>${x.temp}°</b>${x.rain}%` : "–"}</div>`; }).join("")}</div>`
    : `<p class="wx-empty">${fc.status === "too-early" ? "Forecast appears closer to the trip." : "Forecast unavailable right now."}</p>`}
    <div class="wx-foot"><span>${fc.sample ? `<span class="tag-sample">Sample forecast</span>` : w ? "Open-Meteo" : ""}</span><span>Sunset ≈ ${fmtTime(sun.sunset)}</span></div></div>`;

  // stops
  const stops = ids.map((id) => ({ id, p: BYID[id].properties, c: BYID[id].geometry.coordinates }));
  let ordered = stops, partOf = {}, labels = {};
  if (S.planMode === "suggested" && stops.length) {
    const r = suggest({ day: d, stops, home: CFG.map.home, weather: w });
    ordered = r.order;
    r.parts.forEach((p) => (labels[p.id] = p.label));
    ordered.forEach((s) => (partOf[s.id] = s.part));
  }
  const fixed = (time, note) => `<div class="stop fixed-stop"><div class="stop-num"><b>${icon("plane", 16)}</b></div><div class="stop-card"><div class="stop-txt"><div class="stop-part">${esc(time)}</div><div class="stop-name">${esc(note)}</div></div></div></div>`;
  const body = ordered.map((s, i) => {
    const part = partOf[s.id];
    const x = part && w ? w.parts[part] : null;
    return `<div class="stop"><div class="stop-num"><b>${i + 1}</b></div>
      <div class="stop-card" data-open-x="${esc(s.id)}" role="button" tabindex="0">${thumb(s.p, { pill: false, heart: false, w: 160 })}
        <div class="stop-txt">${part ? `<div class="stop-part">${esc(labels[part] || part)}</div>` : ""}<div class="stop-name">${esc(s.p.name)}</div>
          <div class="stop-why">${esc(part ? s.reason : s.p.area)}</div></div>
        ${x ? `<span class="wx-chip">${icon(x.icon, 16)}${x.temp}°</span>` : ""}
        ${mine ? `<button class="stop-x" data-unplan="${esc(s.id)}" aria-label="Remove ${esc(s.p.name)} from ${d.label}">${icon("close", 18)}</button>` : ""}
      </div></div>`;
  }).join("");
  $("#plan-body").innerHTML = `${mine ? "" : `<p class="readonly-note">Viewing ${esc(S.planWho)}'s plan (read-only snapshot from ${fmtAsOf(src.asOf)}).</p>`}
    ${d.start ? fixed(d.start, d.startNote) : ""}
    ${body || `<p class="empty">Nothing planned for ${d.label} yet.${mine ? ` Add places from their card, or from the tray below.` : ""}</p>`}
    ${d.end ? fixed(d.end, d.endNote) : ""}`;

  // tray: hearted but not on any day
  const unplanned = mine ? store.get().hearts.filter((id) => BYID[id] && !store.dayOf(id)) : [];
  $("#plan-tray").innerHTML = mine && unplanned.length ? `<div class="tray"><h2>Saved, not planned yet</h2><div class="tray-chips">${unplanned.map((id) =>
    `<button class="tray-chip" data-plan-add="${esc(id)}">${icon("check", 18).replace("ico", "ico plus")}${esc(BYID[id].properties.name)}</button>`).join("")}</div></div>` : "";
  $("#plan-tray").querySelectorAll(".tray-chip .ico").forEach((el) => (el.outerHTML = icon("sparkle", 18)));
}
$("#plan-tabs").addEventListener("click", (e) => { const b = e.target.closest("[data-plan]"); if (b) { S.planDay = b.dataset.plan; renderPlan(); } });
$("#plan-mode").addEventListener("click", (e) => { const b = e.target.closest("[data-mode]"); if (b) { S.planMode = b.dataset.mode; renderPlan(); } });
$("#plan-who").addEventListener("change", (e) => { S.planWho = e.target.value; renderPlan(); });
$("#screen-plan").addEventListener("click", (e) => {
  const x = e.target.closest("[data-unplan]");
  if (x) {
    e.stopPropagation();
    const id = x.dataset.unplan, was = store.dayOf(id);
    store.setDay(id, null); renderPlan();
    toast(`Removed from ${dayCfg(was).label}`, () => { store.setDay(id, was); renderPlan(); });
    return;
  }
  const a = e.target.closest("[data-plan-add]");
  if (a) { store.setDay(a.dataset.planAdd, S.planDay); renderPlan(); toast(`Added to ${dayCfg(S.planDay).label}`, () => { store.setDay(a.dataset.planAdd, null); renderPlan(); }); }
});

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
  const [places, mask, ferries, stops, fixed] = await Promise.all([L.places, L.mask, L.ferries, L.stops, L.fixed].map(get));
  const labelCats = new Set(CFG.categories.filter((c) => c.asLabel).map((c) => c.id));
  for (const f of places.features) {
    f.properties.catslug = slug(f.properties.category);
    f.properties.asLabel = labelCats.has(f.properties.category);
    f.properties.dim = false;
  }
  PLACES = places; STOPS = stops;
  BYID = Object.fromEntries(places.features.map((f) => [f.properties.id, f]));
  indexCodes(Object.keys(BYID));
  renderCountdown();
  renderChips();
  MAP = await createMap({ container: "map", theme: THEME, config: CFG, data: { places, mask, ferries, stops, fixed }, onPlace: openPlace });
  MAP.map.on("moveend", renderList);
  setSheet("peek");

  const imp = importFromHash();
  if (imp) {
    const msg = { added: `${imp.name}'s ${imp.count} picks added`, updated: `Updated: ${imp.name}'s picks`, same: `You already have this link from ${imp.name}`,
      self: "That's your own link", older: `You already have a newer link from ${imp.name}` }[imp.status];
    toast(msg);
    if (imp.status === "added" || imp.status === "updated") { S.savedTab = `p:${imp.name}`; showScreen("saved"); }
  }
  if (!store.get().name) askName();
  const m = location.hash.match(/place=([^&]+)/);
  if (m) openPlace(decodeURIComponent(m[1]));
  if (editMod) editMod.startEditMode(THEME);
  getForecast().then(renderRightNow);
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
})();
