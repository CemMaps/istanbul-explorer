// Personal picks in this browser only (localStorage). Sharing comes in Phase 4 via snapshot links.
const KEY = "oit:v1:me";
const blank = () => ({ name: null, hearts: [], days: {}, addedAt: {} });

function read() {
  try { return { ...blank(), ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch { return blank(); }
}
let state = read();
const listeners = new Set();
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* private mode: keep in memory */ }
  listeners.forEach((fn) => fn(state));
}

export const store = {
  get: () => state,
  setName(name) { state.name = name; save(); },
  on: (fn) => listeners.add(fn),
  isHearted: (id) => state.hearts.includes(id),
  toggleHeart(id) {
    state.hearts = state.hearts.includes(id) ? state.hearts.filter((x) => x !== id) : [...state.hearts, id];
    save();
    return state.hearts.includes(id);
  },
  dayOf: (id) => state.days[id] || null,
  // A place sits on one day at a time. Returns the previous day for Undo.
  setDay(id, day) {
    const prev = state.days[id] || null;
    if (day) {
      state.days[id] = day;
      state.addedAt[id] = Date.now();
      if (!state.hearts.includes(id)) state.hearts.push(id);
    } else {
      delete state.days[id];
    }
    save();
    return prev;
  },
};
