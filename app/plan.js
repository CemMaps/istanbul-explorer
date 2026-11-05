// "Suggested" day order: a local, rule-based heuristic (no AI calls).
//  1. respect the day window (landing on Friday, leaving for the airport on Monday)
//  2. put each stop in its best day part (best_time), viewpoints/golden-hour stops near sunset
//  3. push outdoor stops out of rainy parts and indoor stops into them
//  4. inside each part, order by nearest-neighbour from the previous stop (groups by area, cuts back-and-forth)
import { dayParts, istMinutes, sunTimes, fmtTime } from "./sky.js";

const toMin = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
const NEXT = { morning: ["midday"], midday: ["morning", "afternoon"], afternoon: ["midday", "golden-hour"],
               "golden-hour": ["afternoon", "evening"], evening: ["golden-hour"] };
const CAP = { morning: 3, midday: 2, afternoon: 3, "golden-hour": 1, evening: 3 };
const RAINY = 50;

function km([a, b], [c, d]) {
  const x = (c - a) * Math.cos(((b + d) / 2) * Math.PI / 180), y = d - b;
  return Math.sqrt(x * x + y * y) * 111.2;
}

export function suggest({ day, stops, home, weather }) {
  const sunset = sunTimes(day.date, home).sunset;
  const sunMin = istMinutes(sunset);
  // Friday: land at SAW, ~1h45 to reach the flat and drop bags. Monday: leave at the configured time.
  const from = day.start ? toMin(day.start) + 105 : 0;
  const to = day.end ? toMin(day.end) : 24 * 60;
  const parts = dayParts(sunMin).filter((p) => p.to > from + 30 && p.from < to - 30);
  if (!parts.length) return { parts: [], order: stops.map((s) => ({ ...s, part: null, reason: "No free time this day" })) };
  const wx = (pid) => weather?.parts?.[pid] || null;
  const avail = new Set(parts.map((p) => p.id));
  const load = Object.fromEntries(parts.map((p) => [p.id, 0]));

  function cost(s, pid) {
    const best = s.p.best_time || "any";
    let c = best === "any" || best === pid ? 0 : (NEXT[best] || []).includes(pid) ? 1.2 : 3;
    const w = wx(pid);
    if (w && w.rain >= RAINY) c += s.p.indoor ? -1 : 3;
    if (load[pid] >= CAP[pid]) c += 2 * (load[pid] - CAP[pid] + 1);
    return c;
  }
  // Most constrained first: golden hour, then fixed best times, then "any".
  const rank = (s) => (s.p.best_time === "golden-hour" ? 0 : s.p.best_time && s.p.best_time !== "any" ? 1 : 2);
  const placed = [];
  for (const s of [...stops].sort((a, b) => rank(a) - rank(b))) {
    const pid = [...avail].sort((a, b) => cost(s, a) - cost(s, b))[0];
    load[pid]++;
    placed.push({ ...s, part: pid });
  }
  // Order within parts by nearest neighbour, chaining from the flat through the day.
  const order = [];
  let here = home;
  for (const p of parts) {
    let pool = placed.filter((s) => s.part === p.id);
    while (pool.length) {
      pool.sort((a, b) => km(here, a.c) - km(here, b.c));
      const s = pool.shift();
      s.hop = km(here, s.c);
      here = s.c;
      order.push(s);
    }
  }
  for (const s of order) s.reason = reasonFor(s, wx(s.part), sunset, order);
  return { parts, order, sunset };
}

function reasonFor(s, w, sunset, order) {
  const p = s.p;
  if (s.part === "golden-hour") return `Best light of the day · sunset ${fmtTime(sunset)}`;
  if (w && w.rain >= RAINY && p.indoor) return `Indoors while showers are likely (${w.rain}%)`;
  if (w && w.rain < RAINY && !p.indoor && p.best_time !== s.part && p.best_time !== "any") return `Outdoors while it's drier (${w.rain}% rain)`;
  if (w && w.rain < 30 && !p.indoor && (s.part === "afternoon" || s.part === "midday")) return "Outdoors in the drier hours";
  if (p.best_time === "morning" && s.part === "morning") return p.category === "Mosques & churches" ? "Early, before the queues" : "Quieter in the morning";
  if (s.part === "evening") return p.category === "Neighbourhoods" ? "Lively after dark" : "Good for the evening";
  const i = order.indexOf(s);
  if (i > 0 && s.hop < 0.8) return `Right next to ${order[i - 1].p.name}`;
  if (i > 0 && s.hop < 2) return `Short walk from ${order[i - 1].p.name}`;
  return p.indoor ? "Rain-proof" : "Fits this part of the day";
}
