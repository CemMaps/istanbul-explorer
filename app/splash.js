// Splash: countdown that gets more excited as the trip approaches, plus the trip-days forecast.
import { icon } from "./icons.js";
import { tripStatus, sunTimes, fmtTime } from "./sky.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// Süleymaniye from above, the Golden Horn and Galata behind it, on a sunny day (Commons; credited via places.geojson).
const SPLASH_PHOTO = "SüleymaniyeMosqueIstanbul (cropped).jpg";
const fmtDay =(iso) => { const d = new Date(iso + "T12:00:00+03:00"); return `${d.getUTCDate()} ${MON[d.getUTCMonth()]}`; };

// Copy by phase. "level" drives how celebratory it looks (0 calm → 3 party).
export function mood(cfg) {
  const st = tripStatus(cfg.trip.days);
  const n = cfg.trip.days.length;
  if (st.phase === "after") return { st, level: 0, big: "Teşekkürler", unit: "", line: "Thanks for a great trip. Same time next year?" };
  if (st.phase === "during") {
    const i = st.dayIndex;
    if (i === 1) return { st, level: 3, big: "Hoş geldiniz!", unit: "", line: "You made it. Day 1 of " + n + ": drop the bags and go and find a sunset." };
    if (i === n) return { st, level: 2, big: "Last day", unit: "", line: `Make it count. Leave for the airport at ${cfg.trip.days[n - 1].end}.` };
    return { st, level: 2, big: `Day ${i}`, unit: `of ${n}`, line: "Günaydın! Here's what today looks like." };
  }
  const d = st.daysToGo;
  if (d === 1) return { st, level: 3, big: "Tomorrow!", unit: "", line: "" };
  if (d <= 7) return { st, level: 3, big: String(d), unit: "days to go!", line: "" };
  if (d <= 14) return { st, level: 2, big: String(d), unit: "days to go!", line: "" };
  if (d <= 30) return { st, level: 1, big: String(d), unit: "days to go!", line: "" };
  return { st, level: 0, big: String(d), unit: "days to go!", line: "" };
}

export function badgeText(cfg) {
  const m = mood(cfg);
  if (m.st.phase === "before") return m.st.daysToGo === 1 ? "1 day" : `${m.st.daysToGo} days`;
  if (m.st.phase === "during") return `Day ${m.st.dayIndex}`;
  return "Trip";
}

// A few Iznik-coloured tiles drifting down (more of them the closer it gets).
function confetti(level) {
  if (!level) return "";
  const count = [0, 8, 16, 28][level];
  const cols = ["--c-accent", "--c-primary", "--c-golden", "--c-ink-inverse"];
  let h = "";
  for (let i = 0; i < count; i++) {
    const x = (i * 37) % 100, delay = ((i * 0.53) % 6).toFixed(2), dur = (7 + (i % 5)).toFixed(1), s = 6 + (i % 4) * 2;
    h += `<i style="left:${x}%;width:${s}px;height:${s}px;background:var(${cols[i % cols.length]});animation-delay:-${delay}s;animation-duration:${dur}s"></i>`;
  }
  return `<div class="confetti" aria-hidden="true">${h}</div>`;
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
  return `<div class="sp-count" role="img" aria-label="${n} days to go, then ${cfg.trip.days.length} days in Istanbul">
    <div class="sc-line">${ticks}<b style="flex:${cfg.trip.days.length}"></b></div>
    <div class="sc-lbl"><span>Today</span><span>${fmtDay(cfg.trip.days[0].date)}</span></div></div>`;
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
    ${confetti(m.level)}
    <div class="sp-inner">
      <div class="sp-hero">
        <h1 class="sp-big">${esc(m.big)}</h1>
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
    setTimeout(() => { el.hidden = true; onGo?.(); }, 900);
  }, { once: true });
}
