// Snapshot sharing with no backend: "Share my picks" builds a link carrying the sender's name, hearts and
// day assignments. Opening it stores that person's snapshot in this browser; it never touches your own picks.
import { store } from "./store.js";

const PEOPLE_KEY = "oit:v1:people";
const DAY_IDS = ["fri", "sat", "sun", "mon"]; // digit 1–4 in links; 0 = saved, no day

// Stable 5-char code per place id (FNV-1a → base36). Collisions are checked at load.
export function codeOf(id) {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36).padStart(7, "0").slice(-5);
}
let BYCODE = {};
export function indexCodes(ids) {
  BYCODE = {};
  const clashes = [];
  for (const id of ids) { const c = codeOf(id); if (BYCODE[c]) clashes.push([BYCODE[c], id]); BYCODE[c] = id; }
  if (clashes.length) console.warn("place code clashes", clashes);
}

function readPeople() { try { return JSON.parse(localStorage.getItem(PEOPLE_KEY) || "{}"); } catch { return {}; } }
function writePeople(p) { try { localStorage.setItem(PEOPLE_KEY, JSON.stringify(p)); } catch { /* ignore */ } }
export const people = { all: readPeople, get: (n) => readPeople()[n] };

export function buildLink() {
  const me = store.get();
  const codes = me.hearts.map((id) => codeOf(id) + (DAY_IDS.indexOf(store.dayOf(id)) + 1));
  const payload = `from=${encodeURIComponent(me.name || "Someone")}&t=${Date.now().toString(36)}&p=${codes.join(".")}`;
  const base = location.origin + location.pathname;
  if (payload.length > 1200 && window.LZString) return `${base}#z=${window.LZString.compressToEncodedURIComponent(payload)}`;
  return `${base}#${payload}`;
}

export async function shareMyPicks() {
  const me = store.get();
  const url = buildLink();
  const text = `${me.name || "My"} picks for Istanbul (${me.hearts.length} places)`;
  if (navigator.share) {
    try { await navigator.share({ title: text, text, url }); return "shared"; } catch (e) { if (e.name === "AbortError") return "cancelled"; }
  }
  try { await navigator.clipboard.writeText(url); return "copied"; } catch { prompt("Copy this link:", url); return "shown"; }
}

// Reads #from=…&p=… (or #z=…). Returns {status: "added"|"updated"|"same"|"self"|"older", name, count} or null.
export function importFromHash() {
  let h = location.hash.slice(1);
  if (h.startsWith("z=") && window.LZString) h = window.LZString.decompressFromEncodedURIComponent(h.slice(2)) || "";
  const q = new URLSearchParams(h);
  if (!q.has("from") || !q.has("p")) return null;
  const name = q.get("from").trim().slice(0, 30) || "Someone";
  const t = parseInt(q.get("t") || "0", 36) || Date.now();
  const hearts = [], days = {};
  for (const tok of (q.get("p") || "").split(".").filter(Boolean)) {
    const id = BYCODE[tok.slice(0, 5)];
    if (!id) continue;
    hearts.push(id);
    const d = DAY_IDS[parseInt(tok.slice(5), 10) - 1];
    if (d) days[id] = d;
  }
  history.replaceState(null, "", location.pathname + location.search);
  const me = store.get();
  if (me.name && name.toLowerCase() === me.name.toLowerCase()) return { status: "self", name, count: hearts.length };
  const all = readPeople();
  const prev = all[name];
  if (prev && prev.asOf > t) return { status: "older", name, count: hearts.length };
  const status = !prev ? "added" : prev.asOf === t ? "same" : "updated";
  all[name] = { hearts, days, asOf: t, receivedAt: Date.now() };
  writePeople(all);
  return { status, name, count: hearts.length };
}

export function removePerson(name) { const all = readPeople(); delete all[name]; writePeople(all); }

export function mergeIntoMine(name) {
  const p = readPeople()[name];
  if (!p) return 0;
  let n = 0;
  for (const id of p.hearts) if (!store.isHearted(id)) { store.toggleHeart(id); n++; }
  return n;
}

// Places saved by 2+ people (you + snapshots). Returns [{id, who: [names]}].
export function matches() {
  const me = store.get();
  const who = {};
  const add = (id, n) => (who[id] = who[id] || []).push(n);
  me.hearts.forEach((id) => add(id, me.name || "You"));
  for (const [n, p] of Object.entries(readPeople())) p.hearts.forEach((id) => add(id, n));
  return Object.entries(who).filter(([, w]) => w.length >= 2).map(([id, w]) => ({ id, who: w }));
}

export const fmtAsOf = (t) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(new Date(t));
