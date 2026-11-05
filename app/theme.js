// Theme loader: theme.json → preset in themes/ → repo overrides → local edit-mode overrides.
// Every visual token becomes a CSS custom property; nothing visual is hard-coded elsewhere.
const LOCAL_KEY = "oit:theme-local";

function deepMerge(a, b) {
  const out = Array.isArray(a) ? [...a] : { ...a };
  for (const [k, v] of Object.entries(b || {})) {
    out[k] = v && typeof v === "object" && !Array.isArray(v) && a && typeof a[k] === "object" ? deepMerge(a[k], v) : v;
  }
  return out;
}

function readLocal() {
  try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || "null"); } catch { return null; }
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

export async function loadTheme() {
  const base = await fetch("theme.json").then((r) => r.json());
  const local = readLocal();
  const presetId = (local && local.preset) || base.preset;
  const preset = await fetch(`themes/${presetId}.json`).then((r) => r.json());
  const theme = deepMerge(deepMerge(preset, base.overrides), (local && local.overrides) || {});
  applyTheme(theme);
  return theme;
}

export function applyTheme(t) {
  const root = document.documentElement.style;
  for (const [k, v] of Object.entries(t.colors)) root.setProperty(`--c-${k}`, v);
  for (const [k, v] of Object.entries(t.categories)) root.setProperty(`--cat-${slug(k)}`, v);
  for (const [k, v] of Object.entries(t.routes)) root.setProperty(`--route-${k}`, v);
  for (const [k, v] of Object.entries(t.transit)) root.setProperty(`--transit-${k}`, v);
  for (const [k, v] of Object.entries(t.vibe || {})) root.setProperty(`--vibe-${k}`, v);
  for (const [k, v] of Object.entries(t.lifestyle || {})) root.setProperty(`--life-${k}`, v);
  (t.routeColors || []).forEach((v, i) => root.setProperty(`--rc-${i}`, v));
  root.setProperty("--font-heading", `"${t.fonts.heading}", system-ui, sans-serif`);
  root.setProperty("--font-body", `"${t.fonts.body}", system-ui, sans-serif`);
  root.setProperty("--radius", `${t.radius}px`);
  root.setProperty("--radius-sm", `${Math.round(t.radius * 0.6)}px`);
  root.setProperty("--shadow-a", String(t.shadow));

  let link = document.getElementById("theme-fonts");
  if (!link) {
    link = document.createElement("link");
    link.id = "theme-fonts";
    link.rel = "stylesheet";
    document.head.appendChild(link);
  }
  link.href = `https://fonts.googleapis.com/css2?${t.fonts.googleFonts}&display=swap`;
  document.title = t.app.name;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = t.colors.navy;
}

export const catVar = (cat) => `--cat-${slug(cat)}`;
export const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
