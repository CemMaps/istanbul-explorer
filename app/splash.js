// Splash: countdown that gets more excited as the trip approaches, plus the trip-days forecast.
import { icon } from "./icons.js";
import { tripStatus, sunTimes, fmtTime } from "./sky.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// Süleymaniye at sunset under a pink sky (Commons, Jorge Franganillo, CC BY 2.0; listed on the Credits screen).
const SPLASH_PHOTO = "Süleymaniye Mosque in 2025 (54490714777) (cropped).jpg";
export const SPLASH_CREDIT = { place: "Splash screen", file: SPLASH_PHOTO, author: "Jorge Franganillo", licence: "CC BY 2.0" };
const fmtDay =(iso) => { const d = new Date(iso + "T12:00:00+03:00"); return `${d.getUTCDate()} ${MON[d.getUTCMonth()]}`; };

// Copy by phase. "level" drives how excited it looks (0 calm → 3 party); "plane" on the two flying days.
// 2026-11-06 (Cem): more exciting as the date nears, a plane on the day we fly.
export function mood(cfg) {
  const st = tripStatus(cfg.trip.days);
  const days = cfg.trip.days, n = days.length;
  if (st.phase === "after") return { st, level: 0, big: "Teşekkürler", unit: "", line: "Thanks for a great trip. Same time next year?" };
  if (st.phase === "during") {
    const i = st.dayIndex;
    if (i === 1) return { st, level: 3, plane: true, big: "Hoş geldiniz!", unit: "", line: `We fly today and land at SAW at ${days[0].start}. Drop the bags and go and find a sunset.` };
    if (i === n) return { st, level: 2, plane: true, big: "Last day", unit: "", line: `Make it count. Leave for the airport at ${days[n - 1].end}.` };
    return { st, level: 2, big: `Day ${i}`, unit: `of ${n}`, line: "Günaydın! Here's what today looks like." };
  }
  const d = st.daysToGo;
  if (d === 1) return { st, level: 3, plane: true, big: "Tomorrow!", unit: "", line: `Bags packed? We land at SAW at ${days[0].start}.` };
  if (d <= 7) return { st, level: 3, big: String(d), unit: "days to go!", line: "Under a week. Comfy shoes: Istanbul is all hills." };
  if (d <= 14) return { st, level: 2, big: String(d), unit: "days to go!", line: "Two weeks! The forecast starts coming in." };
  if (d <= 30) return { st, level: 1, big: String(d), unit: "days to go!", line: "" };
  return { st, level: 0, big: String(d), unit: "days to go!", line: "" };
}

// Countdown card for the More tab: the big number, the countdown line, sunset photo behind.
export function countdownCard(cfg) {
  const m = mood(cfg);
  const photo = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(SPLASH_PHOTO)}?width=960`;
  return `<span class="cc-photo" style="background-image:url('${photo}')"></span>
    <span class="cc-body" data-level="${m.level}">${m.plane ? `<span class="cc-plane" aria-hidden="true">${icon("plane2", 26)}</span>` : ""}<span class="cc-big${/^\d+$/.test(m.big) ? "" : " is-word"}">${esc(m.big)}</span>${m.unit ? `<span class="cc-unit">${esc(m.unit)}</span>` : ""}
      ${countLine(cfg, m)}<span class="cc-more">Days, plans and forecast ${icon("chevronRight", 16)}</span></span>`;
}

export function badgeText(cfg) {
  const m = mood(cfg);
  if (m.st.phase === "before") return m.st.daysToGo === 1 ? "1 day" : `${m.st.daysToGo} days`;
  if (m.st.phase === "during") return `Day ${m.st.dayIndex}`;
  return "Trip";
}

function forecastHtml(cfg, fc, m) {
  const days = cfg.trip.days;
  const cells = days.map((d) => {
    const w = fc?.days?.[d.date];
    const sun = sunTimes(d.date, cfg.map.home);
    const today = m.st.phase === "during" && m.st.today === d.date;
    return `<li><button class="sp-day ${today ? "is-today" : ""}" data-day="${d.id}" aria-expanded="false" aria-label="${d.label}: the plan and weather">
      <span class="sp-dow">${d.label.slice(0, 3)}</span><span class="sp-date">${fmtDay(d.date)}</span>
      ${w ? `${icon(w.icon, 30)}<span class="sp-temp">${w.max}°<small>${w.min}°</small></span><span class="sp-rain">${w.rain}% rain</span>` : ""}</button></li>`;
  }).join("");
  const note = fc?.sample ? `<span class="tag-sample">Sample forecast</span>`
    : fc?.status === "too-early" || !fc ? "The forecast will appear about two weeks before the trip."
    : fc?.status === "error" ? "Couldn't load the forecast just now." : "Forecast: Open-Meteo";
  return `<ul class="sp-days">${cells}</ul><p class="sp-note">${note}</p>`;
}

// Countdown line: one quiet tick per day still to go, then the four trip days as a brighter block.
function countLine(cfg, m) {
  if (m.st.phase !== "before" || m.st.daysToGo > 60) return "";
  const n = m.st.daysToGo;
  const ticks = Array.from({ length: n }, (_, i) => `<i${i === 0 ? ' class="now"' : ""}></i>`).join("");
  const plane = `<span class="sc-plane" aria-hidden="true">${icon("plane2", 14)}</span>`;
  return `<div class="sp-count" role="img" aria-label="${n} days to go, then ${cfg.trip.days.length} days in Istanbul">
    <div class="sc-line">${ticks}<b style="flex:${cfg.trip.days.length}"></b></div>
    <div class="sc-lbl"><span>Today</span><span>${plane}${fmtDay(cfg.trip.days[0].date)}</span></div></div>`;
}

// Day pop-up: the main route's stops in order, plus that day's weather and sunset. Nothing else.
function dayPop(cfg, fc, d, names) {
  const w = fc?.days?.[d.date];
  const sun = sunTimes(d.date, cfg.map.home);
  const wx = w ? `<span>${icon(w.icon, 18)}${w.max}° / ${w.min}° · ${w.rain}% rain</span>` : "";
  const list = names.length ? `<ol class="dp-list">${names.map((n) => `<li>${esc(n)}</li>`).join("")}</ol>`
    : `<p class="dp-empty">Nothing planned yet. Add places to ${esc(d.label)} in Routes.</p>`;
  return `<div class="dp-head"><b>${esc(d.label)}</b>${wx}<span>${icon("sunset", 18)}Sunset ${fmtTime(sun.sunset)}</span></div>${list}`;
}

// When the forecast arrives, only the forecast block changes (the button stays, so a tap is never lost).
export function updateSplashForecast(el, { cfg, fc }) {
  const box = el.querySelector(".sp-fc");
  el._fc = fc;
  const pop = el.querySelector("#sp-pop");
  if (pop) pop.hidden = true;
  if (box) box.innerHTML = forecastHtml(cfg, fc, mood(cfg));
}

export function renderSplash(el, { cfg, theme, fc, people, onGo, dayPlan }) {
  const m = mood(cfg);
  el.dataset.level = m.level;
  // Sunset over the Golden Horn (Wikimedia Commons; credited on the Photo credits screen via places.geojson),
  // drifting slowly like a drone shot.
  const photo = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(SPLASH_PHOTO)}?width=1280`;
  el.innerHTML = `
    <div class="sp-photo" aria-hidden="true"><img src="${photo}" alt="" onload="this.parentNode.classList.add('is-loaded')"></div>
    <div class="sp-scrim" aria-hidden="true"></div>
    <div class="sp-inner">
      <div class="sp-hero">
        ${m.plane ? `<span class="sp-plane" aria-hidden="true">${icon("plane2", 44)}</span>` : ""}
        <h1 class="sp-big${/^\d+$/.test(m.big) ? "" : " is-word"}">${esc(m.big)}</h1>
        ${m.unit ? `<div class="sp-unit">${esc(m.unit)}</div>` : ""}
        ${m.line ? `<p class="sp-line">${esc(m.line)}</p>` : ""}
        ${countLine(cfg, m)}
      </div>
      <div class="sp-fc-wrap"><div class="sp-pop" id="sp-pop" hidden></div><div class="sp-fc">${forecastHtml(cfg, fc, m)}</div></div>
      <button class="sp-go" id="sp-go">${icon("compass", 22)}Explore Istanbul</button>
    </div>`;
  el.hidden = false;
  el.classList.remove("is-leaving");
  // Tap a day: a small pop-up above the cards with that day's plan; tap it again (or anywhere) to close.
  el.querySelector(".sp-fc").onclick = (e) => {
    const b = e.target.closest("[data-day]");
    const pop = el.querySelector("#sp-pop");
    const open = b && b.getAttribute("aria-expanded") !== "true";
    el.querySelectorAll("[data-day]").forEach((x) => x.setAttribute("aria-expanded", "false"));
    if (!open) { pop.hidden = true; return; }
    const d = cfg.trip.days.find((x) => x.id === b.dataset.day);
    pop.innerHTML = dayPop(cfg, el._fc, d, dayPlan?.(d.id) || []);
    const i = cfg.trip.days.indexOf(d);
    pop.style.setProperty("--arrow", `${((i + 0.5) / cfg.trip.days.length) * 100}%`);
    pop.hidden = false;
    b.setAttribute("aria-expanded", "true");
  };
  el._fc = fc;
  const go = el.querySelector("#sp-go");
  go.addEventListener("click", () => {
    el.classList.add("is-leaving");
    setTimeout(() => { el.hidden = true; el.innerHTML = ""; onGo?.(); }, 900); // free the big photo; renderSplash rebuilds it
  }, { once: true });
}
