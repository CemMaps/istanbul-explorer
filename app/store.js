// Personal picks in this browser only (localStorage). Sharing is by snapshot links (share.js).
// Model: hearts (saved places) + routes. A route = the places you want to see on one day; the app orders them.
// A day can have alternative routes ("Route 2"); the place card adds to the day's active route.
const KEY = "oit:v1:me";
const blank = () => ({ name: null, hearts: [], routes: [], active: {}, addedAt: {} });

function read() {
  let s;
  try { s = { ...blank(), ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch { s = blank(); }
  // Migrate v1 "days" (one day per place) into one route per day.
  if (s.days && Object.keys(s.days).length && !s.routes.length) {
    const byDay = {};
    for (const [id, d] of Object.entries(s.days)) (byDay[d] ||= []).push(id);
    s.routes = Object.entries(byDay).map(([day, ids], i) => ({ id: `r${day}1`, day, name: "Route 1", ids, start: "home", onMap: false, ci: i % 5 }));
  }
  delete s.days;
  return s;
}
let state = read();
const listeners = new Set();
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* private mode: keep in memory */ }
  listeners.forEach((fn) => fn(state));
}
// Each route keeps its own colour (0-4), the first one not already used.
const nextCi = () => { const used = new Set(state.routes.map((r) => r.ci)); for (let i = 0; i < 5; i++) if (!used.has(i)) return i; return state.routes.length % 5; };
const uid = () => "r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

export const store = {
  get: () => state,
  setName(name) { state.name = name; save(); },
  on: (fn) => listeners.add(fn),
  isHearted: (id) => state.hearts.includes(id),
  toggleHeart(id) {
    state.hearts = state.hearts.includes(id) ? state.hearts.filter((x) => x !== id) : [...state.hearts, id];
    if (!state.hearts.includes(id)) state.routes.forEach((r) => (r.ids = r.ids.filter((x) => x !== id)));
    save();
    return state.hearts.includes(id);
  },

  // ----- routes -----
  routes: () => state.routes,
  routesOf: (day) => state.routes.filter((r) => r.day === day),
  route: (rid) => state.routes.find((r) => r.id === rid),
  activeRoute(day, create = false) {
    let r = state.routes.find((x) => x.id === state.active[day] && x.day === day) || state.routes.find((x) => x.day === day);
    if (!r && create) {
      r = { id: uid(), day, name: "Route 1", ids: [], start: "home", onMap: false, ci: nextCi() };
      state.routes.push(r); state.active[day] = r.id; save();
    }
    return r || null;
  },
  setActive(day, rid) { state.active[day] = rid; save(); },
  // The day's main route is simply its first one (shown first, and on the splash screen).
  makeMain(rid) {
    const r = store.route(rid);
    if (!r) return;
    state.routes = [r, ...state.routes.filter((x) => x !== r)];
    save();
  },
  mainRoute: (day) => state.routes.find((r) => r.day === day && r.ids.length) || null,
  newRoute(day) {
    const n = state.routes.filter((r) => r.day === day).length + 1;
    const r = { id: uid(), day, name: `Route ${n}`, ids: [], start: "home", onMap: false, ci: nextCi() };
    state.routes.push(r); state.active[day] = r.id; save();
    return r;
  },
  deleteRoute(rid) {
    const r = store.route(rid);
    state.routes = state.routes.filter((x) => x.id !== rid);
    if (r && state.active[r.day] === rid) delete state.active[r.day];
    save();
    return r;
  },
  restoreRoute(r) { state.routes.push(r); save(); },
  renameRoute(rid, name) { const r = store.route(rid); if (r) { r.name = name.slice(0, 30) || r.name; save(); } },
  setStart(rid, start) { const r = store.route(rid); if (r) { r.start = start; save(); } },
  setOnMap(rid, on) { const r = store.route(rid); if (r) { r.onMap = on; save(); } },
  inDay: (id, day) => state.routes.some((r) => r.day === day && r.ids.includes(id)),
  dayOf: (id) => state.routes.find((r) => r.ids.includes(id))?.day || null,
  // Card "Add to a day": toggles the place in that day's active route. Returns true if now added.
  toggleDay(id, day) {
    const r = store.activeRoute(day, true);
    const inAny = state.routes.filter((x) => x.day === day && x.ids.includes(id));
    if (inAny.length) { inAny.forEach((x) => (x.ids = x.ids.filter((y) => y !== id))); save(); return false; }
    // One day per place: adding it to this day takes it off any other day.
    state.routes.forEach((x) => { if (x.day !== day) x.ids = x.ids.filter((y) => y !== id); });
    r.ids.push(id);
    state.addedAt[id] = Date.now();
    if (!state.hearts.includes(id)) state.hearts.push(id);
    save();
    return true;
  },
  addTo(rid, id) {
    const r = store.route(rid);
    if (!r || r.ids.includes(id)) return;
    r.ids.push(id);
    if (!state.hearts.includes(id)) state.hearts.push(id);
    save();
  },
  removeFrom(rid, id) { const r = store.route(rid); if (r) { r.ids = r.ids.filter((x) => x !== id); save(); } },
};
