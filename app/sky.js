// Countdown, sun times (SunCalc) and forecast (Open-Meteo, keyless). Never shows fake weather unless
// the sample toggle is on (?mockweather=1 or edit mode), and then it is always labelled "Sample forecast".
const TZ = "Europe/Istanbul";

export function istanbulToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
const dayDiff = (a, b) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);

export function tripStatus(days, now = new Date()) {
  const today = istanbulToday(now);
  const first = days[0].date, last = days[days.length - 1].date;
  if (today < first) return { phase: "before", daysToGo: dayDiff(today, first) };
  if (today > last) return { phase: "after" };
  return { phase: "during", dayIndex: dayDiff(first, today) + 1, of: days.length, today };
}

export function fmtTime(date) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(date);
}
// Minutes after local midnight in Istanbul
export function istMinutes(date) {
  const [h, m] = fmtTime(date).split(":").map(Number);
  return h * 60 + m;
}

export function sunTimes(dateStr, [lon, lat]) {
  const noon = new Date(dateStr + "T12:00:00+03:00");
  const t = window.SunCalc.getTimes(noon, lat, lon);
  return { sunrise: t.sunrise, sunset: t.sunset, goldenHour: t.goldenHour };
}

const WMO = (c) =>
  c === 0 ? { icon: "sun", text: "Clear" } :
  c <= 2 ? { icon: "cloudSun", text: "Partly cloudy" } :
  c <= 48 ? { icon: "cloud", text: "Cloudy" } :
  { icon: "rain", text: "Rain" };

// Day parts used by the Plan (minutes after midnight). Golden hour = last 50 min before sunset.
export function dayParts(sunsetMin) {
  return [
    { id: "morning", label: "Morning", from: 540, to: 720 },
    { id: "midday", label: "Midday", from: 720, to: 840 },
    { id: "afternoon", label: "Afternoon", from: 840, to: sunsetMin - 50 },
    { id: "golden-hour", label: "Golden hour", from: sunsetMin - 50, to: sunsetMin },
    { id: "evening", label: "Evening", from: sunsetMin, to: 1320 },
  ];
}

function summarise(hours) {
  if (!hours.length) return null;
  const temp = Math.round(hours.reduce((a, h) => a + h.t, 0) / hours.length);
  const rain = Math.max(...hours.map((h) => h.p ?? 0));
  const code = Math.max(...hours.map((h) => h.c ?? 0));
  return { temp, rain, ...WMO(code) };
}

const SAMPLE_DAILY = [
  { max: 14, min: 9, code: 2 }, { max: 12, min: 8, code: 61 }, { max: 13, min: 9, code: 3 }, { max: 15, min: 10, code: 1 },
];
const SAMPLE_RAIN = [[10, 10, 20, 30, 40], [30, 60, 80, 70, 40], [20, 30, 40, 30, 20], [0, 10, 10, 10, 10]];

// → { status: "ok"|"too-early"|"error", sample, days: {date: {max,min,rain,icon,text, parts: {partId: {temp,rain,icon}}}} }
export async function forecast(days, home, { sample = false } = {}) {
  const [lon, lat] = home;
  const partsFor = (d) => dayParts(istMinutes(sunTimes(d, home).sunset));
  if (sample) {
    const out = {};
    days.forEach((d, i) => {
      const s = SAMPLE_DAILY[i % 4];
      const parts = {};
      partsFor(d.date).forEach((p, j) => {
        const r = SAMPLE_RAIN[i % 4][j];
        parts[p.id] = { temp: Math.round(s.min + (s.max - s.min) * [0.4, 0.9, 1, 0.8, 0.5][j]), rain: r, ...WMO(r >= 50 ? 61 : r >= 30 ? 3 : 1) };
      });
      out[d.date] = { max: s.max, min: s.min, rain: Math.max(...SAMPLE_RAIN[i % 4]), ...WMO(s.code), parts };
    });
    return { status: "ok", sample: true, days: out };
  }
  if (dayDiff(istanbulToday(), days[days.length - 1].date) > 15) return { status: "too-early", sample: false, days: {} };
  const start = days[0].date, end = days[days.length - 1].date;
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&timezone=${encodeURIComponent(TZ)}` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code` +
    `&hourly=temperature_2m,precipitation_probability,weather_code&start_date=${start}&end_date=${end}`;
  try {
    const d = await fetch(url).then((r) => r.json());
    const out = {};
    d.daily.time.forEach((date, i) => {
      const hours = d.hourly.time.map((t, k) => ({ t: d.hourly.temperature_2m[k], p: d.hourly.precipitation_probability[k], c: d.hourly.weather_code[k], date: t.slice(0, 10), min: +t.slice(11, 13) * 60 }))
        .filter((h) => h.date === date);
      const parts = {};
      partsFor(date).forEach((p) => { parts[p.id] = summarise(hours.filter((h) => h.min >= p.from - 59 && h.min < p.to)); });
      out[date] = { max: Math.round(d.daily.temperature_2m_max[i]), min: Math.round(d.daily.temperature_2m_min[i]),
                    rain: d.daily.precipitation_probability_max[i], ...WMO(d.daily.weather_code[i]), parts };
    });
    return { status: "ok", sample: false, days: out };
  } catch {
    return { status: "error", sample: false, days: {} };
  }
}
