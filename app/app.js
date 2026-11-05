import { loadTheme, catVar } from "./theme.js";
import { icon } from "./icons.js";
import { createMap } from "./map.js";
import { store } from "./store.js";
import { tripStatus, sunTimes, forecast, fmtTime, istanbulToday } from "./sky.js";

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const norm = (s) => String(s ?? "").toLocaleLowerCase("tr").normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/ı/g, "i");
const params = new URLSearchParams(location.search);

function hydrateIcons(root = document) {
  root.querySelectorAll("[data-icon]").forEach((el) => { el.innerHTML = icon(el.dataset.icon); el.removeAttribute("data-icon"); });
}

// ---------- geometry helpers ----------
function distM([lon1, lat1], [lon2, lat2]) {
  const r = 6371008.8, p1 = lat1 * Math.PI / 180, p2 = lat2 * Math.PI / 180;
  const dp = p2 - p1, dl = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
}
function inRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function inGeom(pt, g) {
  const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  return polys.some((p) => inRing(pt, p[0]) && !p.slice(1).some((h) => inRing(pt, h)));
}
const fmtDist = (m) => (m < 950 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);

// ---------- app state ----------
const S = { chip: "all", query: "", near: null, sheetOpen: false, selected: null };
let CFG, THEME, PLACES, BYID, STOPS, SHORES, MAP;

const catCfg = (id) => CFG.categories.find((c) => c.id === id) || { short: id, icon: "pin" };
const tierRank = { "must-see": 0, "worth-it": 1, bonus: 2 };
const photoUrl = (file, w = 480) => `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(decodeURIComponent(file))}?width=${w}`;

function matches(p) {
  const chip = CFG.chips.find((c) => c.id === S.chip);
  if (chip?.match) for (const [k, vals] of Object.entries(chip.match)) if (!vals.includes(p[k])) return false;
  if (S.query) {
    const hay = norm([p.name, p.name_tr, p.area, p.mahalle, p.category, catCfg(p.category).short, ...(p.dishes || [])].join(" "));
    if (!norm(S.query).split(/\s+/).every((w) => hay.includes(w))) return false;
  }
  return true;
}

function refreshPlaces() {
  for (const f of PLACES.features) f.properties.dim = !matches(f.properties);
  MAP.setPlaces(PLACES);
  renderList();
  renderChips();
}

// ---------- thumbnails ----------
function thumb(p, { pill = true, heart = true, w = 400 } = {}) {
  const ph = p.photos?.[0];
  return `<div class="thumb" style="--cat: var(${catVar(p.category)})">
    ${ph ? `<img loading="lazy" alt="" src="${photoUrl(ph.file, w)}" onerror="this.remove()">` : ""}
    ${icon(catCfg(p.category).icon, 30)}
    ${pill ? `<span class="pill">${esc(catCfg(p.category).short)}</span>` : ""}
    ${heart ? `<span class="heart ${store.isHearted(p.id) ? "is-on" : ""}" data-heart="${esc(p.id)}" role="button" aria-label="Save ${esc(p.name)}" aria-pressed="${store.isHearted(p.id)}">${icon("heart", 18)}</span>` : ""}
  </div>`;
}

// ---------- chips ----------
function renderChips() {
  const el = $("#chips");
  el.innerHTML = CFG.chips.map((c) => {
    const on = S.chip === c.id;
    const n = on && c.id !== "all" ? PLACES.features.filter((f) => !f.properties.dim).length : null;
    return `<button class="chip" data-chip="${c.id}" aria-pressed="${on}">${esc(c.label)}${n != null ? ` <span class="count">${n}</span>` : ""}</button>`;
  }).join("");
}
$("#chips").addEventListener("click", (e) => {
  const b = e.target.closest("[data-chip]");
  if (!b) return;
  S.chip = S.chip === b.dataset.chip ? "all" : b.dataset.chip;
  refreshPlaces();
});

// ---------- search ----------
let searchT;
$("#search").addEventListener("input", (e) => {
  clearTimeout(searchT);
  searchT = setTimeout(() => {
    S.query = e.target.value.trim();
    $("#search-clear").hidden = !S.query;
    refreshPlaces();
    if (S.query) fitToMatches();
  }, 180);
});
$("#search-clear").addEventListener("click", () => {
  $("#search").value = ""; S.query = ""; $("#search-clear").hidden = true; refreshPlaces();
});
function fitToMatches() {
  const m = PLACES.features.filter((f) => !f.properties.dim);
  if (!m.length || m.length > 60) return;
  const b = new maplibregl.LngLatBounds();
  m.forEach((f) => b.extend(f.geometry.coordinates));
  MAP.map.fitBounds(b, { padding: { top: 200, bottom: 340, left: 40, right: 40 }, maxZoom: 15.5, duration: 600 });
}

// ---------- list in view ----------
function visibleNow(p) {
  return MAP.map.getZoom() >= CFG.tiers[p.tier].minzoom - 0.01;
}
function inViewPlaces() {
  const b = MAP.map.getBounds();
  const ref = S.near || MAP.map.getCenter().toArray();
  return PLACES.features
    .filter((f) => !f.properties.dim && b.contains(f.geometry.coordinates) && visibleNow(f.properties))
    .map((f) => ({ p: f.properties, c: f.geometry.coordinates, d: distM(ref, f.geometry.coordinates) }))
    .sort((a, b) => (S.near ? a.d - b.d : tierRank[a.p.tier] - tierRank[b.p.tier] || b.p.score - a.p.score));
}
function renderList() {
  const items = inViewPlaces();
  $("#list-title").textContent = S.near ? "Closest to you" : S.query ? `Results for “${S.query}”` : "Top picks in view";
  const sub = (x) => `${esc(x.p.area)}${S.near ? ` · ${fmtDist(x.d)}` : ""}`;
  $("#cards").innerHTML = items.length
    ? items.slice(0, 12).map((x) => `<button class="card" data-open="${esc(x.p.id)}">${thumb(x.p)}<div class="card-name">${esc(x.p.name)}</div><div class="card-sub">${sub(x)}</div></button>`).join("")
    : `<p class="empty">Nothing here with these filters. Zoom out or clear the search.</p>`;
  $("#list").innerHTML = items.slice(0, 120).map((x) => `<button class="row" data-open="${esc(x.p.id)}">${thumb(x.p, { pill: false, heart: false, w: 160 })}
      <div class="row-txt"><div class="row-name">${esc(x.p.name)}</div><div class="row-sub">${esc(catCfg(x.p.category).short)} · ${sub(x)}</div></div></button>`).join("")
    || `<p class="empty">Nothing in view.</p>`;
  $("#sheet-toggle").textContent = S.sheetOpen ? "Show map" : `See all ${items.length}`;
  renderRightNow();
}

// ---------- side badge ----------
function updateBadge() {
  const pt = S.near || MAP.map.getCenter().toArray();
  const shore = SHORES.features.find((f) => inGeom(pt, f.geometry));
  const el = $("#side-badge");
  if (!shore) { el.hidden = true; return; }
  el.hidden = false;
  el.textContent = `${S.near ? "You're" : "Map is"} on the ${shore.properties.shore === "asia" ? "Asian" : "European"} side`;
}

// ---------- right now (light rule-based) ----------
function renderRightNow() {
  const el = $("#rightnow");
  const ref = S.near || CFG.map.home;
  const today = istanbulToday();
  const sun = sunTimes(today, CFG.map.home);
  const now = new Date();
  const minsToSunset = (sun.sunset - now) / 60000;
  const status = tripStatus(CFG.trip.days);
  const pool = PLACES.features.filter((f) => !f.properties.dim && f.properties.tier !== "bonus");
  const nearest = (pred) => pool.filter((f) => pred(f.properties))
    .map((f) => ({ p: f.properties, d: distM(ref, f.geometry.coordinates) })).sort((a, b) => a.d - b.d)[0];
  let pick, head, reason, ico;
  if (minsToSunset > 0 && minsToSunset < 100) {
    pick = nearest((p) => p.category === "Viewpoints" || p.category === "Parks & waterfront");
    head = `Golden hour soon. Head to ${pick?.p.name}.`; reason = `Sunset ${fmtTime(sun.sunset)}`; ico = "sunset";
  } else if (minsToSunset <= 0 || now < sun.sunrise) {
    pick = nearest((p) => p.category === "Neighbourhoods" || p.category === "Food & drink");
    head = `Evening stroll: ${pick?.p.name}.`; reason = "Lively after dark"; ico = "sparkle";
  } else {
    pick = nearest((p) => p.tier === "must-see");
    head = `${pick?.p.name} is close by.`; reason = `${fmtDist(pick?.d || 0)} away · sunset ${fmtTime(sun.sunset)}`; ico = "sun";
  }
  if (!pick) { el.hidden = true; return; }
  el.hidden = false;
  el.dataset.open = pick.p.id;
  el.innerHTML = `<span class="rn-ico">${icon(ico, 22)}</span><span class="rn-txt"><small>Right now${status.phase === "before" ? " · preview" : ""}</small><b>${esc(head)}</b><small>${esc(reason)}</small></span>${icon("chevronRight", 20)}`;
}

// ---------- sheet ----------
function sheetHeights() {
  const appH = $("#app").clientHeight - parseInt(getComputedStyle(document.documentElement).getPropertyValue("--tabbar-h"));
  return { peek: 300, open: appH - 72 };
}
function setSheet(open) {
  S.sheetOpen = open;
  const h = sheetHeights();
  // Keep the map's visual centre in the strip between the search/chips and the sheet.
  MAP.map.setPadding({ top: 150, bottom: h.peek, left: 0, right: 0 });
  $("#sheet").classList.toggle("is-open", open);
  $("#sheet").style.setProperty("--sheet-h", `${open ? h.open : h.peek}px`);
  renderList();
}
$("#sheet-toggle").addEventListener("click", () => setSheet(!S.sheetOpen));
(() => {
  const handle = $("#sheet-handle"), sheet = $("#sheet");
  let y0, h0, moved;
  handle.addEventListener("pointerdown", (e) => { y0 = e.clientY; h0 = sheet.offsetHeight; moved = false; sheet.classList.add("is-dragging"); handle.setPointerCapture(e.pointerId); });
  handle.addEventListener("pointermove", (e) => {
    if (y0 == null) return;
    const dy = y0 - e.clientY; if (Math.abs(dy) > 4) moved = true;
    const h = sheetHeights();
    sheet.style.setProperty("--sheet-h", `${Math.max(140, Math.min(h.open, h0 + dy))}px`);
  });
  handle.addEventListener("pointerup", (e) => {
    sheet.classList.remove("is-dragging");
    const dy = y0 - e.clientY; y0 = null;
    setSheet(moved ? dy > 40 || (S.sheetOpen && dy > -40) : !S.sheetOpen);
  });
})();

// ---------- hearts + opening ----------
document.addEventListener("click", (e) => {
  const h = e.target.closest("[data-heart]");
  if (h) {
    e.stopPropagation();
    const on = store.toggleHeart(h.dataset.heart);
    document.querySelectorAll(`[data-heart="${CSS.escape(h.dataset.heart)}"]`).forEach((x) => { x.classList.toggle("is-on", on); x.setAttribute("aria-pressed", on); });
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
  const order = ["tram", "metro", "funicular", "ferry", "rail"];
  const rows = order.filter((m) => best[m]).sort((a, b) => best[a].d - best[b].d).slice(0, 3);
  const label = { tram: "Tram", metro: "Metro", funicular: "Funicular", ferry: "Ferry pier", rail: "Train" };
  const ico = { tram: "tram", metro: "train", funicular: "tram", ferry: "ship", rail: "train" };
  if (!rows.length) return `<div class="go-row"><span class="go-ico" style="--mode: var(--c-ink-2)">${icon("car", 18)}</span><span><b>Taxi is easiest</b><br><small>No station or pier within a ${Math.round(maxWalkM / metersPerMin)}-min walk</small></span></div>`;
  return rows.map((m) => {
    const x = best[m];
    return `<div class="go-row"><span class="go-ico" style="--mode: var(--transit-${m})">${icon(ico[m], 18)}</span>
      <span><b>${esc(x.s.name)}</b> <small>${label[m]}${x.s.lines ? ` · ${esc(x.s.lines)}` : ""}</small><br><small>${Math.max(1, Math.round(x.d / metersPerMin))} min walk · ${fmtDist(x.d)}</small></span></div>`;
  }).join("");
}

function closeBy(id, coord) {
  return PLACES.features.filter((f) => f.properties.id !== id && f.properties.tier !== "bonus")
    .map((f) => ({ p: f.properties, d: distM(coord, f.geometry.coordinates) }))
    .sort((a, b) => a.d - b.d).slice(0, 3);
}

function dayButtons(id) {
  const cur = store.dayOf(id);
  return CFG.trip.days.map((d) => `<button class="day-btn" data-day="${d.id}" aria-pressed="${cur === d.id}"><span class="tick">${icon("check", 16)}</span>${d.label}</button>`).join("");
}

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
  el.innerHTML = `
    <div class="gallery">
      <div class="gallery-track">${photos.map((ph) => `<div class="gallery-slide">${ph ? `<img alt="${esc(p.name)}" src="${photoUrl(ph.file, 900)}" onerror="this.remove()">` : ""}${ph ? "" : icon(catCfg(p.category).icon, 64)}</div>`).join("")}</div>
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
      ${p.blurb ? `<p class="blurb ${p.blurb_status === "placeholder-wikidata" ? "is-placeholder" : ""}">${esc(p.blurb[0].toUpperCase() + p.blurb.slice(1))}</p>` : ""}
      ${p.best_time ? `<div class="besttime">${icon(p.best_time === "golden-hour" ? "sunset" : "sun", 24)}<span><b>Best ${p.best_time === "golden-hour" ? "at golden hour" : "in the " + esc(p.best_time)}</b>${p.indoor ? "Indoors, good for rain" : ""}</span></div>` : ""}
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
  history.replaceState(null, "", `#place=${encodeURIComponent(id)}`);
}

$("#place").addEventListener("click", (e) => {
  if (e.target.closest("[data-close]")) return closePlace();
  const b = e.target.closest("[data-day]");
  if (!b) return;
  const id = S.selected, day = b.dataset.day;
  const was = store.dayOf(id);
  const next = was === day ? null : day;
  store.setDay(id, next);
  $("#days").innerHTML = dayButtons(id);
  const nb = $(`[data-day="${day}"]`, $("#days"));
  nb?.classList.add("pop");
  const label = CFG.trip.days.find((d) => d.id === day).label;
  toast(next ? `Added to ${label}` : `Removed from ${label}`, () => { store.setDay(id, was); $("#days").innerHTML = dayButtons(id); });
});
function closePlace() {
  $("#place").hidden = true; S.selected = null; MAP.select(null);
  history.replaceState(null, "", location.pathname + location.search);
  renderList();
}
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#place").hidden) closePlace(); });

let toastT;
function toast(msg, undo) {
  const el = $("#toast");
  el.innerHTML = `<span>${esc(msg)}</span>${undo ? `<button>Undo</button>` : ""}`;
  el.hidden = false;
  if (undo) el.querySelector("button").onclick = () => { undo(); el.hidden = true; };
  clearTimeout(toastT); toastT = setTimeout(() => (el.hidden = true), 4000);
}

// ---------- countdown + forecast ----------
async function renderCountdown() {
  const st = tripStatus(CFG.trip.days);
  const d = CFG.trip.days;
  if (st.phase === "before") { $("#cd-num").textContent = st.daysToGo; $("#cd-label").textContent = st.daysToGo === 1 ? "day to go" : "days to go"; }
  else if (st.phase === "during") { $("#cd-num").textContent = `Day ${st.dayIndex}`; $("#cd-label").textContent = `of ${st.of}`; }
  else { $("#cd-num").textContent = "Teşekkürler"; $("#cd-label").textContent = ""; }
  $("#cd-sub").textContent = `Istanbul · ${d[0].label} to ${d[d.length - 1].label}`;
}
$("#countdown").addEventListener("click", async () => {
  const btn = $("#countdown"), panel = $("#forecast-panel");
  const open = btn.getAttribute("aria-expanded") !== "true";
  btn.setAttribute("aria-expanded", open);
  panel.hidden = !open;
  if (!open) return;
  panel.innerHTML = `<p class="fc-empty">Loading…</p>`;
  const fc = await forecast(CFG.trip.days, CFG.map.home, { sample: params.get("mockweather") === "1" });
  const sun = CFG.trip.days.map((d) => sunTimes(d.date, CFG.map.home));
  const cells = CFG.trip.days.map((d, i) => {
    const w = fc.days.find((x) => x.date === d.date);
    return `<div class="fc-day"><b>${d.label}</b>${w ? `${icon(w.icon, 26)}<div class="fc-temp">${w.max}°<small> / ${w.min}°</small></div><div>${w.rain}% rain</div>` : `${icon("sunset", 26)}`}<div>Sunset ${fmtTime(sun[i].sunset)}</div></div>`;
  }).join("");
  const note = fc.status === "too-early" ? "Forecast appears closer to the trip (about 2 weeks before)." :
    fc.status === "error" ? "Couldn't load the forecast. Try again later." : "";
  panel.innerHTML = `<div class="fc-days">${cells}</div>
    <div class="fc-note"><span>${fc.sample ? `<span class="tag-sample">Sample forecast</span>` : note || "Open-Meteo forecast"}</span><span>Sunrise ≈ ${fmtTime(sun[0].sunrise)}</span></div>`;
});

// ---------- buttons ----------
$("#btn-home").addEventListener("click", () => MAP.map.flyTo({ center: CFG.map.home, zoom: 15, duration: 800 }));
$("#btn-near").addEventListener("click", () => {
  const b = $("#btn-near");
  if (S.near) { S.near = null; b.classList.remove("is-on"); MAP.setMe(null); renderList(); updateBadge(); return; }
  if (!navigator.geolocation) return toast("Location isn't available on this device");
  navigator.geolocation.getCurrentPosition((pos) => {
    S.near = [pos.coords.longitude, pos.coords.latitude];
    b.classList.add("is-on"); MAP.setMe(S.near);
    MAP.map.flyTo({ center: S.near, zoom: Math.max(MAP.map.getZoom(), 14.5), duration: 800 });
    updateBadge();
  }, () => toast("Couldn't get your location. Check location permission."), { enableHighAccuracy: true, timeout: 10000 });
});

// ---------- tabs: Saved + Plan (basic until Phase 4) ----------
document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => {
  document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("is-active", x === t));
  document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("is-active", s.id === `screen-${t.dataset.screen}`));
  if (!$("#place").hidden) closePlace();
  if (t.dataset.screen === "saved") renderSaved();
  if (t.dataset.screen === "plan") renderPlan();
  if (t.dataset.screen === "explore") MAP.map.resize();
}));
function renderSaved() {
  const ids = store.get().hearts.filter((id) => BYID[id]);
  $("#saved-list").innerHTML = ids.length
    ? ids.map((id) => { const p = BYID[id].properties; return `<button class="card" data-open-saved="${esc(id)}">${thumb(p)}<div class="card-name">${esc(p.name)}</div><div class="card-sub">${esc(p.area)}</div></button>`; }).join("")
    : `<p class="empty">Tap the heart on any place to save it here.</p>`;
}
let planDay = CFG?.trip?.days?.[0]?.id;
function renderPlan() {
  planDay = planDay || CFG.trip.days[0].id;
  $("#plan-tabs").innerHTML = CFG.trip.days.map((d) => `<button class="day-tab" role="tab" data-plan="${d.id}" aria-selected="${d.id === planDay}">${d.label}</button>`).join("");
  const d = CFG.trip.days.find((x) => x.id === planDay);
  const st = store.get();
  const ids = Object.keys(st.days).filter((id) => st.days[id] === planDay && BYID[id]).sort((a, b) => (st.addedAt[a] || 0) - (st.addedAt[b] || 0));
  const sun = sunTimes(d.date, CFG.map.home);
  $("#plan-body").innerHTML = `
    ${d.start ? `<div class="fixed-stop">${icon("plane", 20)}<span><b>${d.start}</b> · ${esc(d.startNote)}</span></div>` : ""}
    ${ids.length ? ids.map((id, i) => { const p = BYID[id].properties; return `<button class="row" data-open-saved="${esc(id)}">${thumb(p, { pill: false, heart: false, w: 160 })}<div class="row-txt"><div class="row-name">${i + 1}. ${esc(p.name)}</div><div class="row-sub">${esc(p.area)}</div></div></button>`; }).join("")
      : `<p class="empty">Nothing planned for ${d.label} yet. Open a place and tap “${d.label}”.</p>`}
    <div class="fixed-stop">${icon("sunset", 20)}<span>Sunset ${fmtTime(sun.sunset)}</span></div>
    ${d.end ? `<div class="fixed-stop">${icon("plane", 20)}<span><b>${d.end}</b> · ${esc(d.endNote)}</span></div>` : ""}`;
}
$("#plan-tabs").addEventListener("click", (e) => { const b = e.target.closest("[data-plan]"); if (b) { planDay = b.dataset.plan; renderPlan(); } });
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-open-saved]");
  if (!b) return;
  document.querySelector('.tab[data-screen="explore"]').click();
  const f = BYID[b.dataset.openSaved];
  MAP.map.jumpTo({ center: f.geometry.coordinates, zoom: Math.max(MAP.map.getZoom(), 14) });
  openPlace(b.dataset.openSaved);
});

// ---------- boot ----------
(async function boot() {
  hydrateIcons();
  THEME = await loadTheme();
  const get = (u) => fetch(u).then((r) => r.json());
  CFG = await get("config.json");
  const L = Object.fromEntries(CFG.layers.map((l) => [l.id, l.file]));
  const [places, mask, ferries, stops, fixed, shores] = await Promise.all(
    [L.places, L.mask, L.ferries, L.stops, L.fixed, CFG.context[0].file].map(get));
  const labelCats = new Set(CFG.categories.filter((c) => c.asLabel).map((c) => c.id));
  for (const f of places.features) {
    f.properties.catslug = slug(f.properties.category);
    f.properties.asLabel = labelCats.has(f.properties.category);
    f.properties.dim = false;
  }
  PLACES = places; STOPS = stops; SHORES = shores;
  BYID = Object.fromEntries(places.features.map((f) => [f.properties.id, f]));
  renderCountdown();
  renderChips();
  MAP = await createMap({ container: "map", theme: THEME, config: CFG, data: { places, mask, ferries, stops, fixed }, onPlace: openPlace });
  MAP.map.on("moveend", () => { renderList(); updateBadge(); });
  setSheet(false);
  updateBadge();
  const m = location.hash.match(/place=([^&]+)/);
  if (m) openPlace(decodeURIComponent(m[1]));
})();
