// Routes: put a day's places in a sensible order from a start point, say how you get between them
// (Walk · 8 min / Tram / Metro / Ferry / Taxi — no directions), and draw the line on a map.
// Walking legs follow streets via the free OSM foot router (FOSSGIS); ferry legs follow the ferry line.

const R = 6371008.8;
export function distM([lon1, lat1], [lon2, lat2]) {
  const p1 = lat1 * Math.PI / 180, p2 = lat2 * Math.PI / 180;
  const a = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(((lon2 - lon1) * Math.PI / 180) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const WALK_MAX = 1500;   // further than this on the same shore → transport
const NEAR_STOP = 700;   // a station/pier counts as "near" within this
const DETOUR = 1.25;     // streets are longer than straight lines
const M_PER_MIN = 80;

// pts: [{id, c:[lon,lat], shore}] ; start: {c, shore}
// Nearest-first, with crossing the water costed like an extra 3 km so each shore is done in one go; then 2-opt.
export function order(start, pts) {
  const cost = (a, b) => distM(a.c, b.c) + (a.shore && b.shore && a.shore !== b.shore ? 3000 : 0);
  const left = [...pts], out = [];
  let cur = start;
  while (left.length) {
    let bi = 0;
    for (let i = 1; i < left.length; i++) if (cost(cur, left[i]) < cost(cur, left[bi])) bi = i;
    cur = left.splice(bi, 1)[0];
    out.push(cur);
  }
  const path = [start, ...out];
  const total = (p) => p.slice(1).reduce((s, x, i) => s + cost(p[i], x), 0);
  for (let improved = true, guard = 0; improved && guard < 50; guard++) {
    improved = false;
    for (let i = 1; i < path.length - 1; i++) for (let k = i + 1; k < path.length; k++) {
      const cand = [...path.slice(0, i), ...path.slice(i, k + 1).reverse(), ...path.slice(k + 1)];
      if (total(cand) < total(path) - 1) { path.splice(0, path.length, ...cand); improved = true; }
    }
  }
  return path.slice(1);
}

function nearestStop(stops, c, modes) {
  let best = null, bd = Infinity;
  for (const s of stops) {
    if (!modes.includes(s.properties.mode)) continue;
    const d = distM(c, s.geometry.coordinates);
    if (d < bd) { bd = d; best = s; }
  }
  return best ? { s: best, d: bd } : null;
}

// How to get from a to b, in one word (plus minutes for walking).
export function legMode(a, b, stops) {
  const d = distM(a.c, b.c);
  if (a.shore && b.shore && a.shore !== b.shore) return { mode: "ferry", label: "Ferry", d };
  if (d <= WALK_MAX) return { mode: "walk", label: `Walk · ${Math.max(1, Math.round(d * DETOUR / M_PER_MIN))} min`, d };
  for (const [mode, label] of [["tram", "Tram"], ["metro", "Metro"], ["rail", "Train"], ["funicular", "Funicular"]]) {
    const na = nearestStop(stops, a.c, [mode]), nb = nearestStop(stops, b.c, [mode]);
    if (na && nb && na.d < NEAR_STOP && nb.d < NEAR_STOP && na.s !== nb.s) return { mode, label, d };
  }
  return { mode: "taxi", label: "Taxi", d };
}

// ----- geometry (cached in localStorage) -----
const CACHE = "oit:routecache";
let cache = {};
try { cache = JSON.parse(localStorage.getItem(CACHE) || "{}"); } catch { /* ignore */ }
const key = (a, b) => `${a.map((v) => v.toFixed(5)).join(",")};${b.map((v) => v.toFixed(5)).join(",")}`;

async function streetPath(router, a, b) {
  const k = key(a, b);
  if (cache[k]) return cache[k];
  try {
    const r = await fetch(`${router}${a.join(",")};${b.join(",")}?overview=simplified&geometries=geojson`).then((x) => x.json());
    const g = r.routes?.[0]?.geometry?.coordinates;
    if (!g) throw new Error("no route");
    cache[k] = g.map(([x, y]) => [+x.toFixed(5), +y.toFixed(5)]);
    try { localStorage.setItem(CACHE, JSON.stringify(cache)); } catch { /* full: fine */ }
    return cache[k];
  } catch {
    return null; // offline or router down → straight line
  }
}

function ferryPath(ferries, pa, pb) {
  // A ferry line that passes both piers: take the stretch between them.
  for (const f of ferries.features) {
    const lines = f.geometry.type === "LineString" ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const line of lines) {
      let ia = -1, ib = -1, da = 400, db = 400;
      line.forEach((p, i) => { const x = distM(p, pa), y = distM(p, pb); if (x < da) { da = x; ia = i; } if (y < db) { db = y; ib = i; } });
      if (ia >= 0 && ib >= 0 && ia !== ib) return ia < ib ? line.slice(ia, ib + 1) : line.slice(ib, ia + 1).reverse();
    }
  }
  return [pa, pb];
}

// Build the drawable legs for an ordered route: [{mode, coords, approx}]
export async function legsGeometry({ start, ordered, stops, ferries, router }) {
  const legs = [];
  const seq = [start, ...ordered];
  for (let i = 1; i < seq.length; i++) {
    const a = seq[i - 1], b = seq[i];
    const m = legMode(a, b, stops.features);
    if (m.mode === "ferry") {
      const pa = nearestStop(stops.features, a.c, ["ferry"]), pb = nearestStop(stops.features, b.c, ["ferry"]);
      if (pa && pb) {
        const A = pa.s.geometry.coordinates, B = pb.s.geometry.coordinates;
        legs.push({ mode: "walk", coords: (await streetPath(router, a.c, A)) || [a.c, A] });
        legs.push({ mode: "ferry", coords: ferryPath(ferries, A, B) });
        legs.push({ mode: "walk", coords: (await streetPath(router, B, b.c)) || [B, b.c] });
        continue;
      }
    }
    if (m.mode === "walk" || m.mode === "taxi") {
      const g = await streetPath(router, a.c, b.c);
      legs.push({ mode: m.mode, coords: g || [a.c, b.c], approx: !g });
    } else {
      legs.push({ mode: m.mode, coords: [a.c, b.c], approx: true }); // tram/metro: no track geometry, straight line
    }
  }
  return legs;
}
