// Countdown, sun times (SunCalc) and forecast (Open-Meteo, keyless). Never shows fake weather unless
// the sample toggle is on (?mockweather=1), and then it is always labelled "Sample forecast".
const TZ = "Europe/Istanbul";

// Today's date in Istanbul as YYYY-MM-DD (independent of the phone's own time zone).
export function istanbulToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
const dayDiff = (a, b) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);

export function tripStatus(days, now = new Date()) {
  const today = istanbulToday(now);
  const first = days[0].date, last = days[days.length - 1].date;
  if (today < first) return { phase: "before", daysToGo: dayDiff(today, first) };
  if (today > last) return { phase: "after" };
  return { phase: "during", dayIndex: dayDiff(first, today) + 1, of: days.length };
}

export function fmtTime(date) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(date);
}

// Sun times for a calendar date at a location. Uses Istanbul local noon so the date is unambiguous.
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

const SAMPLE = [
  { max: 14, min: 9, rain: 20, code: 2 }, { max: 12, min: 8, rain: 70, code: 61 },
  { max: 13, min: 9, rain: 40, code: 3 }, { max: 15, min: 10, rain: 10, code: 1 },
];

// Returns { status: "ok" | "too-early" | "error", sample: bool, days: [{date, max, min, rain, icon, text}] }
export async function forecast(days, [lon, lat], { sample = false } = {}) {
  if (sample) return { status: "ok", sample: true, days: days.map((d, i) => ({ date: d.date, ...SAMPLE[i % 4], ...WMO(SAMPLE[i % 4].code) })) };
  const horizon = dayDiff(istanbulToday(), days[days.length - 1].date);
  if (horizon > 15) return { status: "too-early", sample: false, days: [] };
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&timezone=${encodeURIComponent(TZ)}` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code&start_date=${days[0].date}&end_date=${days[days.length - 1].date}`;
  try {
    const d = await fetch(url).then((r) => r.json());
    return {
      status: "ok", sample: false,
      days: d.daily.time.map((date, i) => ({
        date, max: Math.round(d.daily.temperature_2m_max[i]), min: Math.round(d.daily.temperature_2m_min[i]),
        rain: d.daily.precipitation_probability_max[i], ...WMO(d.daily.weather_code[i]),
      })),
    };
  } catch {
    return { status: "error", sample: false, days: [] };
  }
}
