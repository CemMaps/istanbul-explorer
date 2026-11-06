// Hidden edit mode (?edit=1). Changes preview live on the real screens and save to THIS browser only.
// To give everyone the new look: Export theme.json → replace app/theme.json in the repo → redeploy.
import { applyTheme } from "./theme.js";
import { icon } from "./icons.js";
import { setPreviewDate, previewDate } from "./sky.js";

const LOCAL_KEY = "oit:theme-local";
const MOCK_KEY = "oit:mockweather";
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function lum(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return null;
  const v = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}
export function contrast(a, b) {
  const la = lum(a), lb = lum(b);
  if (la == null || lb == null) return null;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export const mockWeatherOn = () => { try { return localStorage.getItem(MOCK_KEY) === "1"; } catch { return false; } };

// Countdown preview: slide through the weeks before the trip (and the trip days) to see each mood.
const isoPlus = (iso, n) => new Date(Date.parse(iso + "T12:00:00Z") + n * 86400000).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 86400000);
function previewLabel(first, v) {
  const iso = isoPlus(first, v);
  const d = new Date(iso + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  return `${d} (${v < 0 ? `${-v} day${v === -1 ? "" : "s"} to go` : v < 4 ? `trip day ${v + 1}` : "after"})`;
}

export async function startEditMode(theme, cfg) {
  const index = await fetch("themes/index.json").then((r) => r.json());
  const presets = await Promise.all(index.presets.map((id) => fetch(`themes/${id}.json`).then((r) => r.json())));
  let local;
  try { local = JSON.parse(localStorage.getItem(LOCAL_KEY) || "null"); } catch { local = null; }
  const base = await fetch("theme.json").then((r) => r.json());
  let presetId = local?.preset || base.preset;
  let overrides = structuredClone(local?.overrides || base.overrides || {});
  const presetOf = (id) => presets.find((p) => p.id === id);
  const merged = () => {
    const p = structuredClone(presetOf(presetId));
    const o = overrides;
    Object.assign(p.colors, o.colors || {});
    Object.assign(p.app, o.app || {});
    if (o.fonts) p.fonts = { ...p.fonts, ...o.fonts };
    for (const k of ["radius", "shadow", "basemap", "pinStyle"]) if (o[k] != null) p[k] = o[k];
    return p;
  };
  let dirtyMap = false;
  const first = cfg.trip.days[0].date;
  const preview = (iso) => { setPreviewDate(iso); window.dispatchEvent(new CustomEvent("oit:preview-date")); };

  const panel = document.createElement("aside");
  panel.className = "editor is-collapsed";
  panel.setAttribute("aria-label", "Theme editor");
  document.getElementById("app").appendChild(panel);

  function render() {
    const t = merged();
    const fontIdx = index.fontPairings.findIndex((f) => f.heading === t.fonts.heading && f.body === t.fonts.body);
    const warn = index.contrastPairs.map(([fg, bg, label]) => {
      const r = contrast(t.colors[fg], t.colors[bg]);
      return r != null && r < 4.5 ? `<li>${esc(label)}: ${r.toFixed(1)}:1 (needs 4.5)</li>` : "";
    }).join("");
    panel.innerHTML = `
      <button class="ed-fab" data-ed="collapse" aria-label="Open the theme editor">${icon("palette", 22)}</button>
      <div class="ed-head"><b>Edit look</b><button class="icon-btn small" data-ed="collapse" aria-label="Close the editor">${icon("close", 20)}</button></div>
      <div class="ed-body">
        <p class="ed-note">Changes save in <b>this browser only</b>. To give everyone the new look: <b>Export theme.json</b>, replace <code>app/theme.json</code> in the repo, then redeploy.</p>
        <label class="ed-row ed-date">Preview date
          <input type="range" min="-45" max="4" step="1" value="${previewDate() ? daysBetween(first, previewDate()) : Math.max(-45, Math.min(4, daysBetween(first, new Date().toISOString().slice(0, 10))))}" data-ed="today">
          <span data-ed-lbl>${previewDate() ? previewLabel(first, daysBetween(first, previewDate())) : "Real today"}</span>
          ${previewDate() ? `<button class="link-btn" data-ed="realtoday">Back to real today</button>` : ""}</label>
        <label class="ed-row">Preset
          <select data-ed="preset">${presets.map((p) => `<option value="${p.id}" ${p.id === presetId ? "selected" : ""}>${esc(p.label)}</option>`).join("")}</select></label>
        <label class="ed-row">App name <input data-ed="name" value="${esc(t.app.name)}" maxlength="40"></label>
        <label class="ed-row">Logo <input type="file" accept="image/*" data-ed="logo">${t.app.logo ? `<button class="link-btn" data-ed="nologo">Remove</button>` : ""}</label>
        <label class="ed-row">Fonts
          <select data-ed="fonts">${index.fontPairings.map((f, i) => `<option value="${i}" ${i === fontIdx ? "selected" : ""}>${esc(f.label)}</option>`).join("")}${fontIdx < 0 ? `<option selected>Custom</option>` : ""}</select></label>
        <label class="ed-row">Corners <input type="range" min="4" max="28" step="1" value="${t.radius}" data-ed="radius"><span>${t.radius}px</span></label>
        <div class="ed-colors">${index.editableColors.map(([k, label]) =>
          `<label class="ed-color"><input type="color" value="${t.colors[k]}" data-color="${k}"><span>${esc(label)}</span></label>`).join("")}</div>
        ${warn ? `<ul class="ed-warn" role="alert">${warn}</ul>` : `<p class="ed-ok">${icon("check", 16)} All text passes 4.5:1 contrast</p>`}
        <label class="ed-row">Basemap
          <select data-ed="basemap">${["positron", "voyager", "dark"].map((b) => `<option ${b === t.basemap ? "selected" : ""}>${b}</option>`).join("")}</select></label>
        <label class="ed-row">Pins
          <select data-ed="pinStyle">${["outlined", "filled"].map((b) => `<option ${b === t.pinStyle ? "selected" : ""}>${b}</option>`).join("")}</select></label>
        <label class="ed-row ed-check"><input type="checkbox" data-ed="mock" ${mockWeatherOn() ? "checked" : ""}> Show sample forecast (for designing)</label>
        ${dirtyMap ? `<p class="ed-note">Map colours and pins update when you press Save.</p>` : ""}
        <div class="ed-actions">
          <button class="btn-primary" data-ed="save">Save in this browser</button>
          <button class="btn-secondary" data-ed="export">Export theme.json</button>
          <button class="btn-secondary" data-ed="reset">Reset to preset</button>
        </div>
      </div>`;
  }

  function live() { applyTheme(merged()); dirtyMap = true; render(); panel.classList.remove("is-collapsed"); }

  panel.addEventListener("input", (e) => {
    const c = e.target.dataset.color;
    if (c) { overrides.colors = { ...(overrides.colors || {}), [c]: e.target.value }; applyTheme(merged()); dirtyMap = true; return; }
    const k = e.target.dataset.ed;
    if (k === "name") { overrides.app = { ...(overrides.app || {}), name: e.target.value }; applyTheme(merged()); }
    if (k === "today") { const v = +e.target.value; preview(isoPlus(first, v)); panel.querySelector("[data-ed-lbl]").textContent = previewLabel(first, v); return; }
    if (k === "radius") { overrides.radius = +e.target.value; e.target.nextElementSibling.textContent = `${e.target.value}px`; applyTheme(merged()); }
  });
  panel.addEventListener("change", (e) => {
    const k = e.target.dataset.ed;
    if (e.target.dataset.color) return render();
    if (k === "preset") { presetId = e.target.value; overrides = {}; live(); }
    if (k === "fonts") { const f = index.fontPairings[+e.target.value]; if (f) { overrides.fonts = { heading: f.heading, body: f.body, googleFonts: f.googleFonts }; live(); } }
    if (k === "basemap" || k === "pinStyle") { overrides[k] = e.target.value; live(); }
    if (k === "mock") { try { localStorage.setItem(MOCK_KEY, e.target.checked ? "1" : "0"); } catch { /* ignore */ } }
    if (k === "logo" && e.target.files[0]) {
      const file = e.target.files[0];
      if (file.size > 300_000) { alert("Please use a logo under 300 KB."); return; }
      const rd = new FileReader();
      rd.onload = () => { overrides.app = { ...(overrides.app || {}), logo: rd.result }; live(); };
      rd.readAsDataURL(file);
    }
  });
  panel.addEventListener("click", (e) => {
    if (e.target.closest('[data-ed="realtoday"]')) { preview(null); render(); return; }
    const k = e.target.closest("[data-ed]")?.dataset.ed;
    if (k === "collapse") panel.classList.toggle("is-collapsed");
    if (k === "nologo") { overrides.app = { ...(overrides.app || {}), logo: null }; live(); }
    if (k === "save") {
      try { localStorage.setItem(LOCAL_KEY, JSON.stringify({ preset: presetId, overrides })); } catch { alert("Couldn't save in this browser."); return; }
      location.reload();
    }
    if (k === "export") {
      const blob = new Blob([JSON.stringify({ preset: presetId, overrides }, null, 2)], { type: "application/json" });
      const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: "theme.json" });
      a.click(); URL.revokeObjectURL(a.href);
    }
    if (k === "reset") {
      if (!confirm("Reset to the preset and clear your local edits?")) return;
      try { localStorage.removeItem(LOCAL_KEY); } catch { /* ignore */ }
      location.reload();
    }
  });
  render();
}
