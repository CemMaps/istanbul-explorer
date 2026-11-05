// Splash: countdown that gets more excited as the trip approaches, plus the trip-days forecast.
import { icon } from "./icons.js";
import { tripStatus, sunTimes, fmtTime } from "./sky.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtDay = (iso) => { const d = new Date(iso + "T12:00:00+03:00"); return `${d.getUTCDate()} ${MON[d.getUTCMonth()]}`; };

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
  if (d === 1) return { st, level: 3, big: "Tomorrow!", unit: "", line: "Passports, chargers, comfy shoes. İyi yolculuklar!" };
  if (d <= 7) return { st, level: 3, big: String(d), unit: "days to go", line: "This week! Pack a warm layer for the ferries." };
  if (d <= 14) return { st, level: 2, big: String(d), unit: "days to go", line: "Two weeks out. The real forecast is arriving." };
  if (d <= 30) return { st, level: 1, big: String(d), unit: "days to go", line: "Not long now. Start hearting places you like." };
  return { st, level: 0, big: String(d), unit: "days to go", line: "Simit, ferries and sunsets over the Bosphorus." };
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

export function renderSplash(el, { cfg, theme, fc, people, onGo }) {
  const m = mood(cfg);
  const days = cfg.trip.days;
  const cells = days.map((d) => {
    const w = fc?.days?.[d.date];
    const sun = sunTimes(d.date, cfg.map.home);
    const today = m.st.phase === "during" && m.st.today === d.date;
    return `<li class="sp-day ${today ? "is-today" : ""}">
      <span class="sp-dow">${d.label}</span><span class="sp-date">${fmtDay(d.date)}</span>
      ${w ? `${icon(w.icon, 30)}<span class="sp-temp">${w.max}°<small>${w.min}°</small></span><span class="sp-rain">${w.rain}% rain</span>
             <span class="sp-sun">${icon("sunset", 14)}${fmtTime(sun.sunset)}</span>`
          : `${icon("sunset", 30)}<span class="sp-temp">${fmtTime(sun.sunset)}</span><span class="sp-rain">sunset</span>`}</li>`;
  }).join("");
  const note = fc?.sample ? `<span class="tag-sample">Sample forecast</span>`
    : fc?.status === "too-early" ? "The forecast appears about two weeks before. Sunsets are already known."
    : fc?.status === "error" ? "Couldn't load the forecast just now." : "Forecast: Open-Meteo";
  el.dataset.level = m.level;
  el.innerHTML = `
    <div class="sp-bg" aria-hidden="true"></div>
    ${confetti(m.level)}
    <div class="sp-inner">
      <div class="sp-top">
        ${theme.app.logo ? `<img class="sp-logo" src="${esc(theme.app.logo)}" alt="">` : ""}
        <span class="sp-eyebrow">${esc(theme.app.name)}</span>
      </div>
      <div class="sp-hero">
        <h1 class="sp-big">${esc(m.big)}</h1>
        ${m.unit ? `<div class="sp-unit">${esc(m.unit)}</div>` : ""}
        <p class="sp-line">${esc(m.line)}</p>
        <p class="sp-who">${esc(people.join(" · "))} · ${fmtDay(days[0].date)} to ${fmtDay(days[days.length - 1].date)}</p>
      </div>
      <div class="sp-fc">
        <ul class="sp-days">${cells}</ul>
        <p class="sp-note">${note}</p>
      </div>
      <button class="sp-go" id="sp-go">Explore Istanbul ${icon("chevronRight", 20)}</button>
    </div>`;
  el.hidden = false;
  el.classList.remove("is-leaving");
  const go = el.querySelector("#sp-go");
  go.focus({ preventScroll: true });
  go.addEventListener("click", () => {
    el.classList.add("is-leaving");
    setTimeout(() => { el.hidden = true; onGo?.(); }, 280);
  }, { once: true });
}
