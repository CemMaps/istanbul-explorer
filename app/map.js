// MapLibre setup: themed basemap, study-area mask, ferries, stops, fixed points and place pins by tier.
import { cssVar, catVar } from "./theme.js";
import { pinImage, stopImage } from "./icons.js";

const BASEMAPS = {
  positron: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
  voyager: "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json",
  dark: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
};
// Extra basemaps (2026-11-06, Cem: satellite with labels, topographic; no 3D). Raster tiles, keyless, credited.
// "default" is the theme's own CARTO vector map. The others are raster layers under our layers; the vector
// basemap is hidden while one is on.
// CARTO's raster tiles now need an API key (2026-11-06: "API key required" placeholder), so the street and label
// tiles come from Esri's keyless services.
export const EXTRA_BASEMAPS = {
  streets: { tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}"], max: 19,
    credit: "Map © Esri, HERE, Garmin, © OpenStreetMap" },
  satellite: { tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"], max: 19,
    labels: ["https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"],
    credit: "Imagery © Esri, Maxar, Earthstar Geographics" },
  // Hills (2026-11-06): OpenTopoMap was far too busy at street zoom. Now the theme's own map plus soft hill shading
  // drawn by MapLibre from keyless Terrarium elevation tiles (Mapzen/Tilezen on AWS Open Data, CORS *).
  hills: { hillshade: "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png", max: 15,
    credit: "© OpenStreetMap · © CARTO · Elevation: Mapzen, AWS Open Data" },
};
const SMALL_PX = 17;
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const FONT_REG = ["Montserrat Regular", "Open Sans Regular"];
const FONT_BOLD = ["Montserrat Medium", "Open Sans Semibold"];

// ----- route lines + numbered stops  -----
function addRouteLayers(map, bg) {
  const empty = { type: "FeatureCollection", features: [] };
  map.addSource("route-lines", { type: "geojson", data: empty });
  map.addSource("route-stops", { type: "geojson", data: empty });
  map.addLayer({ id: "route-casing", type: "line", source: "route-lines", layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": bg, "line-width": ["interpolate", ["linear"], ["zoom"], 11, 5, 16, 9], "line-opacity": 0.9 } });
  map.addLayer({ id: "route-line", type: "line", source: "route-lines", filter: ["in", ["get", "mode"], ["literal", ["walk", "taxi"]]],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": ["get", "color"], "line-width": ["interpolate", ["linear"], ["zoom"], 11, 2.5, 16, 5] } });
  map.addLayer({ id: "route-line-dash", type: "line", source: "route-lines", filter: ["!", ["in", ["get", "mode"], ["literal", ["walk", "taxi"]]]],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": ["get", "color"], "line-width": ["interpolate", ["linear"], ["zoom"], 11, 2.5, 16, 5], "line-dasharray": [1.2, 1.6] } });
  map.addLayer({ id: "route-stop", type: "circle", source: "route-stops",
    paint: { "circle-radius": ["case", ["get", "start"], 9, 11], "circle-color": ["case", ["get", "start"], bg, ["get", "color"]],
             "circle-stroke-color": ["case", ["get", "start"], ["get", "color"], bg], "circle-stroke-width": ["case", ["get", "start"], 3, 2.5] } });
  map.addLayer({ id: "route-stop-num", type: "symbol", source: "route-stops",
    layout: { "text-field": ["get", "label"], "text-font": FONT_BOLD, "text-size": 12, "text-allow-overlap": true, "text-ignore-placement": true },
    paint: { "text-color": ["case", ["get", "start"], ["get", "color"], bg] } });
}
function setRouteData(map, lines, stops) {
  map.getSource("route-lines").setData(lines);
  map.getSource("route-stops").setData(stops);
}

export async function createMap({ container, theme, config, data, onPlace, onStop }) {
  const map = new maplibregl.Map({
    container,
    style: BASEMAPS[theme.basemap] || BASEMAPS.positron,
    center: config.map.center, zoom: config.map.zoom,
    minZoom: config.map.minZoom, maxZoom: config.map.maxZoom,
    attributionControl: false, // credit shown as a small line on the map + full credits screen (see app.js)
    // 2026-11-06 (Cem): no 3D tilt (glitchy, and it kept the edge blur redrawing); rotation is allowed,
    // with a north button that shows only while the map is turned (app.js).
    maxPitch: 0, pitchWithRotate: false, touchPitch: false, dragRotate: true,
    // Performance (2026-11-08): draw at most 2x (iPhones are 3x: the GL canvas was ~2.25x the pixels and memory,
    // a common reason iOS freezes or reloads a web app), and don't re-download cached tiles when they expire.
    pixelRatio: Math.min(window.devicePixelRatio || 1, 2), refreshExpiredTiles: false,
    maxTileCacheSize: 80, maxTileCacheZoomLevels: 3, // fewer tiles (GPU textures) kept around: satellite tiles add up fast
    fadeDuration: 120, // short fade so collisions don't pop while zooming (selected pin ignores placement, so no blink)
    // 2026-11-10: the map stays around Istanbul (it could be dragged anywhere, onto empty grey map).
    maxBounds: config.map.maxBounds,
  });
  map.keyboard.disableRotation?.();
  // 2026-11-10: wait for the style only (not "load", which also waits for every basemap tile to arrive), and for
  // the data, which downloads at the same time. Our layers go on a second or more sooner on a phone connection.
  [, data] = await Promise.all([new Promise((r) => map.once("style.load", r)), data]);
  const baseLayerIds = map.getStyle().layers.map((l) => l.id); // the vector basemap, hidden under a raster basemap

  // Recolour the basemap from theme tokens (only for the light basemaps).
  if (theme.basemap !== "dark") {
    for (const l of map.getStyle().layers) {
      if (l.type === "background") map.setPaintProperty(l.id, "background-color", cssVar("--c-map-land"));
      else if (l.type === "fill" && /water/.test(l.id)) map.setPaintProperty(l.id, "fill-color", cssVar("--c-map-water"));
      else if (l.type === "fill" && /park|landcover|wood|grass/.test(l.id)) map.setPaintProperty(l.id, "fill-color", cssVar("--c-map-park"));
    }
  }

  // Pin images per category: outlined (normal) and filled (selected).
  const bg = cssVar("--c-surface");
  const pinFilled = theme.pinStyle === "filled";
  // All pin and stop images are drawn at the same time (2026-11-10: they were made one after another).
  const images = [];
  const addImg = (name, promise, pixelRatio) => images.push(promise.then((img) => map.addImage(name, img, { pixelRatio })));
  for (const c of config.categories) {
    const col = cssVar(catVar(c.id));
    addImg(`pin-${slug(c.id)}`, pinImage(c.icon, col, bg, { filled: pinFilled }), 2);
    addImg(`pin-${slug(c.id)}-sel`, pinImage(c.icon, col, bg, { filled: !pinFilled }), 2);
    // Food ("local" tier) icons are drawn at their real size with thicker lines: scaling the big pin down blurred them.
    addImg(`pin-${slug(c.id)}-sm`, pinImage(c.icon, col, bg, { filled: pinFilled, px: SMALL_PX, ratio: 3, ringW: 3.4, strokeW: 3.2 }), 3);
    // Kinds with their own icon (churches, synagogues): same colour, own glyph; places get catslug "<cat>-<kind>".
    for (const [kind, ic] of Object.entries(c.kindIcons || {})) {
      const col = c.kindColors?.[kind] ? cssVar(catVar(c.kindColors[kind])) : cssVar(catVar(c.id)); // churches: own colour
      addImg(`pin-${slug(c.id)}-${kind}`, pinImage(ic, col, bg, { filled: pinFilled }), 2);
      addImg(`pin-${slug(c.id)}-${kind}-sel`, pinImage(ic, col, bg, { filled: !pinFilled }), 2);
    }
  }
  const navy = cssVar("--c-navy");
  // On the dark basemap the navy home pin disappears: white icon + light outline there.
  const dark = theme.basemap === "dark";
  addImg("pin-home", pinImage("home", navy, bg, dark ? { filled: true, inkColor: cssVar("--c-ink-inverse"), ring: cssVar("--c-ink-inverse") } : { filled: true }), 2);
  addImg("pin-airport", pinImage("plane", navy, bg, { filled: true }), 2);
  for (const m of ["metro", "tram", "funicular", "ferry", "rail"]) addImg(`stop-${m}`, stopImage(m, cssVar(`--transit-${m}`) || cssVar("--c-ink-2")), 3);
  await Promise.all(images);

  // Outside the study area (2026-11-08): a static, feathered milky tint drawn by the map itself.
  // data/study_mask.geojson (scripts/11_mask_feather.py) holds a clear strip just outside the line, rings that get
  // milkier out to ~1.6 km, then a solid tint; each feature's `a` is its share of the full tint. It replaced a
  // per-frame DOM blur (canvas -> PNG -> CSS mask on every move) that flickered and froze iPhones after a while.
  map.addSource("mask", { type: "geojson", data: data.mask, tolerance: 0.6 });
  const full = Math.max(theme.maskOpacity ?? 0.7, 0.7);
  map.addLayer({ id: "mask", type: "fill", source: "mask", filter: ["has", "a"],
    paint: { "fill-color": cssVar("--c-surface"), "fill-opacity": ["*", full, ["get", "a"]], "fill-antialias": false } });
  // A very light outline, so the eye has an edge to rest on (2026-11-06).
  map.addLayer({ id: "mask-edge", type: "line", source: "mask", filter: ["has", "edge"],
    paint: { "line-color": cssVar("--c-ink-2"), "line-width": 1, "line-opacity": 0.18 } });

  // Vibe map: soft translucent fill under everything, off by default (character or lifestyle colouring).
  map.addSource("areas", { type: "geojson", maxzoom: 13, data: data.areas || { type: "FeatureCollection", features: [] } });
  const vibeColor = ["match", ["get", "primary"], ...config.vibe.classes.flatMap((c) => [c.id, cssVar(`--vibe-${c.id}`)]), cssVar("--c-ink-2")];
  const lifeColor = ["match", ["get", "lifestyle"], ...config.vibe.lifestyles.flatMap((l) => [l.id, cssVar(`--life-${l.id}`)]), cssVar("--c-ink-2")];
  map.addLayer({ id: "vibe-fill", type: "fill", source: "areas", layout: { visibility: "none" },
    paint: { "fill-color": vibeColor, "fill-opacity": ["interpolate", ["linear"], ["zoom"], 10, 0.42, 15, 0.26] } });
  map.addLayer({ id: "vibe-line", type: "line", source: "areas", layout: { visibility: "none" },
    paint: { "line-color": bg, "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.4, 15, 1.4], "line-opacity": 0.8 } });

  // Ferries
  map.addSource("ferries", { type: "geojson", data: data.ferries });
  map.addLayer({ id: "ferries", type: "line", source: "ferries",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": cssVar("--route-ferry"), "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.8, 15, 2],
             "line-dasharray": [2, 2.5], "line-opacity": ["interpolate", ["linear"], ["zoom"], 10, 0.18, 14, 0.32] } }); // quieter (2026-11-06)

  // Stations and piers (close zoom only)
  map.addSource("stops", { type: "geojson", data: data.stops });
  const modeColor = ["match", ["get", "mode"], ...["metro", "tram", "funicular", "ferry", "rail"].flatMap((m) => [m, cssVar(`--transit-${m}`)]), cssVar("--c-ink-2")];
  // Stations and piers: a small badge with the mode letter (or a boat), never a plain dot that looks like a place.
  map.addLayer({ id: "stops", type: "symbol", source: "stops", minzoom: 14.5,
    layout: { "icon-image": ["concat", "stop-", ["coalesce", ["get", "mode"], "rail"]], "icon-size": ["interpolate", ["linear"], ["zoom"], 14.5, 0.8, 17, 1],
              "icon-allow-overlap": true, "icon-ignore-placement": true,
              "text-field": ["step", ["zoom"], "", 15.5, ["get", "name"]], "text-size": 11, "text-font": FONT_REG, "text-offset": [0, 1.0], "text-anchor": "top", "text-optional": true },
    paint: { "text-color": cssVar("--c-ink-2"), "text-halo-color": bg, "text-halo-width": 1.2 } });
  map.on("click", "stops", (e) => {
    if (map.queryRenderedFeatures(e.point, { layers: ["selected"] }).length) return;
    const pins = map.getStyle().layers.filter((l) => /^pins-|^dots-/.test(l.id)).map((l) => l.id);
    if (map.queryRenderedFeatures(e.point, { layers: pins }).length) return; // a place on top wins
    onStop?.(e.features[0].properties);
  });

  // Places
  // The map gets a slim copy of the places (2026-11-10): only what the layers draw with. The full file (2.8 MB with
  // descriptions, photo credits, sources) used to be copied to the map's worker at start-up and again on every
  // filter or search; the slim copy is about a tenth of that. maxzoom 14: closer views reuse the z14 tiles.
  const slim = (fc) => ({ type: "FeatureCollection", features: fc.features.map((f) => { const p = f.properties;
    return { type: "Feature", geometry: f.geometry, properties: { id: p.id, name: p.name, tier: p.tier, score: p.score, catslug: p.catslug, colkey: p.colkey, asLabel: p.asLabel, dim: p.dim } }; }) });
  map.addSource("places", { type: "geojson", data: slim(data.places), promoteId: "id", maxzoom: 14 });
  const dimOp = ["case", ["get", "dim"], config.dimOpacity, 1];
  const tiers = Object.entries(config.tiers).reverse(); // draw bonus first, must-see on top
  const placeLayers = [];
  const dotLayers = [];
  // Discovery dots: every place is always at least a small coloured dot, so nothing is invisible.
  // They show a few zoom levels before the tier's icons, then sit underneath them; if an icon is
  // hidden by a collision, its dot still shows.
  // Colour key per place: its category, or a kind's own colour (churches & synagogues), set as "colkey" in app.js.
  const colKeys = [...new Set(config.categories.flatMap((c) => [c.id, ...Object.values(c.kindColors || {})]))];
  const catColor = ["match", ["get", "colkey"], ...colKeys.flatMap((k) => [k, cssVar(catVar(k)) || cssVar("--c-ink-2")]), cssVar("--c-ink-2")];
  for (const [tier, t] of tiers) {
    // Food ("local") dots only appear about one zoom level before their icons, so the city view stays calm.
    const from = Math.max(config.map.minZoom ?? 9, (t.minzoom || 10) - (tier === "local" ? 1.2 : tier === "bonus" ? 2.6 : 3));
    const to = Math.max(t.minzoom || 0, from + 1);
    map.addLayer({ id: `dots-${tier}`, type: "circle", source: "places", minzoom: from,
      filter: ["all", ["==", ["get", "tier"], tier], ["!=", ["get", "asLabel"], true]],
      paint: {
        "circle-color": catColor,
        // Three clear sizes: must-see dots biggest, bonus smallest; they grow gently as you zoom in.
        "circle-radius": ["interpolate", ["linear"], ["zoom"], from, { "must-see": 4, "worth-it": 2.6, bonus: 1.8, local: 1.6 }[tier], to + 1, { "must-see": 5, "worth-it": 3.8, bonus: 3, local: 2.6 }[tier]],
        "circle-stroke-color": bg, "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], from, 0.6, to, 1.2],
        "circle-opacity": tier === "bonus" || tier === "local" ? 0.7 : 0.95,
        "circle-stroke-opacity": 1,
      } });
    dotLayers.push(`dots-${tier}`);
  }
  for (const [tier, t] of tiers) {
    const isTier = ["==", ["get", "tier"], tier];
    const notLabelCat = ["!=", ["get", "asLabel"], true];
    const labelFrom = tier === "must-see" ? 13 : tier === "worth-it" ? 15 : tier === "local" ? 17 : 16.2;
    map.addLayer({
      id: `pins-${tier}`, type: "symbol", source: "places", minzoom: t.minzoom,
      filter: ["all", isTier, notLabelCat],
      layout: {
        "icon-image": tier === "local" ? ["concat", "pin-", ["get", "catslug"], "-sm"] : ["concat", "pin-", ["get", "catslug"]],
        // Small at city zoom so more icons fit; collisions on, so the most famous win instead of piling up
        // (a hidden icon still shows as its dot underneath).
        // Food icons keep one size (17 px) at every zoom: a growing icon re-runs collisions every frame (flicker).
        "icon-size": tier === "local" ? 1 : ["interpolate", ["linear"], ["zoom"], 10, t.size * 0.48, 12, t.size * 0.6, 14, t.size * 0.8, 17, t.size],
        "icon-allow-overlap": false, "icon-padding": tier === "local" ? 3 : 0, // food: smaller and spaced, the rest stay dots
        "symbol-sort-key": ["-", 0, ["get", "score"]],
        "text-field": ["step", ["zoom"], "", labelFrom, ["get", "name"]],
        "text-font": tier === "must-see" ? FONT_BOLD : FONT_REG, "text-size": tier === "must-see" ? 12.5 : 11.5,
        "text-offset": [0, 1.35], "text-anchor": "top", "text-optional": true, "text-max-width": 9,
      },
      paint: { "icon-opacity": tier === "local" ? ["*", 0.9, dimOp] : dimOp, "text-opacity": dimOp, "text-color": cssVar("--c-ink"),
               "text-halo-color": bg, "text-halo-width": 1.4 },
    });
    // Neighbourhoods read as area names, not pins.
    map.addLayer({
      id: `areas-${tier}`, type: "symbol", source: "places",
      minzoom: tier === "must-see" ? 11.5 : tier === "worth-it" ? 13.2 : 14.8,
      filter: ["all", isTier, ["==", ["get", "asLabel"], true]],
      layout: { "text-field": ["upcase", ["get", "name"]], "text-font": FONT_BOLD,
                "text-size": tier === "must-see" ? 12 : 10.5, "text-letter-spacing": 0.12, "text-max-width": 8, "text-padding": 4 },
      paint: { "text-color": cssVar(catVar("Neighbourhoods")), "text-opacity": ["case", ["get", "dim"], config.dimOpacity, 0.9],
               "text-halo-color": bg, "text-halo-width": 1.6 },
    });
    placeLayers.push(`pins-${tier}`, `areas-${tier}`);
  }

  // Planned places (2026-11-08): every place added to a day shows as a round badge in its category colour with the
  // day inside ("Fri"), whatever filter or search is on. Its own source, fed from the saved routes (app.js).
  map.addSource("planned", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  map.addLayer({ id: "planned-dot", type: "circle", source: "planned",
    paint: { "circle-color": catColor, "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 10, 14, 13, 17, 15],
             "circle-stroke-color": bg, "circle-stroke-width": 2.2 } });
  map.addLayer({ id: "planned-txt", type: "symbol", source: "planned",
    layout: { "text-field": ["get", "day"], "text-font": FONT_BOLD, "text-size": ["interpolate", ["linear"], ["zoom"], 10, 8.5, 14, 10.5, 17, 12],
              "text-allow-overlap": true, "text-ignore-placement": true, "text-letter-spacing": 0.02 },
    paint: { "text-color": cssVar("--c-ink-inverse") } });
  map.on("click", "planned-dot", (e) => onPlace(e.features[0].properties.id));
  map.on("mouseenter", "planned-dot", () => (map.getCanvas().style.cursor = "pointer"));
  map.on("mouseleave", "planned-dot", () => (map.getCanvas().style.cursor = ""));

  // Selected place: filled, bigger, always labelled.
  map.addLayer({ id: "selected", type: "symbol", source: "places", filter: ["==", ["get", "id"], ""],
    layout: { "icon-image": ["concat", "pin-", ["get", "catslug"], "-sel"], "icon-size": 1.15, "icon-allow-overlap": true, "icon-ignore-placement": true, "text-ignore-placement": true,
              "text-field": ["get", "name"], "text-font": FONT_BOLD, "text-size": 13, "text-offset": [0, 1.7], "text-anchor": "top",
              "text-allow-overlap": true },
    paint: { "text-color": cssVar("--c-ink-inverse"), "text-halo-color": navy, "text-halo-width": 6, "icon-opacity": 1, "text-opacity": 1 } });

  // Fixed points: the flat + airport
  map.addSource("fixed", { type: "geojson", data: data.fixed });
  map.addLayer({ id: "fixed", type: "symbol", source: "fixed",
    layout: { "icon-image": ["match", ["get", "kind"], "home", "pin-home", "pin-airport"], "icon-allow-overlap": true,
              // same size as a must-see pin
              "icon-size": ["interpolate", ["linear"], ["zoom"], 10, config.tiers["must-see"].size * 0.62, 14, config.tiers["must-see"].size * 0.82, 17, config.tiers["must-see"].size],
              "text-field": ["step", ["zoom"], "", 13, ["match", ["get", "kind"], "home", "", ["get", "name"]]], "text-font": FONT_BOLD, "text-size": 11.5, // no "Our flat" label (2026-11-06)
              "text-offset": [0, 1.4], "text-anchor": "top", "text-optional": true },
    paint: { "text-color": navy, "text-halo-color": bg, "text-halo-width": 1.4 } });

  addRouteLayers(map, bg);

  // "What's here" marker + radius ring
  map.addSource("here", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  map.addLayer({ id: "here-ring", type: "fill", source: "here", filter: ["==", ["geometry-type"], "Polygon"],
    paint: { "fill-color": cssVar("--c-primary"), "fill-opacity": 0.12 } });
  map.addLayer({ id: "here-ring-line", type: "line", source: "here", filter: ["==", ["geometry-type"], "Polygon"],
    paint: { "line-color": cssVar("--c-primary"), "line-width": 2.5, "line-dasharray": [2, 1.5], "line-opacity": 0.9 } });
  map.addLayer({ id: "here-pt", type: "circle", source: "here", filter: ["all", ["==", ["geometry-type"], "Point"], ["!", ["has", "n"]]],
    paint: { "circle-radius": 8, "circle-color": navy, "circle-stroke-color": bg, "circle-stroke-width": 3 } });
  // Numbered markers for the places listed in the What's here panel (2026-11-08); the picked one is bigger, in the accent.
  const isSel = ["==", ["get", "sel"], true];
  map.addLayer({ id: "here-num", type: "circle", source: "here", filter: ["has", "n"],
    paint: { "circle-radius": ["case", isSel, 15, 11], "circle-color": ["case", isSel, cssVar("--c-accent"), navy],
             "circle-stroke-color": bg, "circle-stroke-width": 2.5 } });
  map.addLayer({ id: "here-num-txt", type: "symbol", source: "here", filter: ["has", "n"],
    layout: { "text-field": ["to-string", ["get", "n"]], "text-font": FONT_BOLD, "text-size": ["case", isSel, 14, 12],
              "text-allow-overlap": true, "text-ignore-placement": true, "symbol-sort-key": ["case", isSel, 1, 0] },
    paint: { "text-color": cssVar("--c-ink-inverse") } });

  // You-are-here
  map.addSource("me", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  map.addLayer({ id: "me-halo", type: "circle", source: "me", paint: { "circle-radius": 16, "circle-color": cssVar("--c-primary"), "circle-opacity": 0.18 } });
  map.addLayer({ id: "me", type: "circle", source: "me", paint: { "circle-radius": 7, "circle-color": cssVar("--c-primary"), "circle-stroke-color": bg, "circle-stroke-width": 2.5 } });

  for (const id of dotLayers) {
    // A tap on a dot zooms in to where its icon shows (or opens it if we're already close).
    map.on("click", id, (e) => {
      if (map.queryRenderedFeatures(e.point, { layers: [...placeLayers, "selected", "planned-dot"] }).length) return; // icon or day badge handles it
      const f = e.features[0];
      const target = config.tiers[f.properties.tier].minzoom + 0.4;
      if (map.getZoom() >= target - 0.2) onPlace(f.properties.id);
      else map.easeTo({ center: f.geometry.coordinates, zoom: Math.max(target, map.getZoom() + 1.5), duration: 600 });
    });
    map.on("mouseenter", id, () => (map.getCanvas().style.cursor = "pointer"));
    map.on("mouseleave", id, () => (map.getCanvas().style.cursor = ""));
  }
  for (const id of [...placeLayers, "selected"]) {
    map.on("click", id, (e) => {
      if (id !== "selected" && map.queryRenderedFeatures(e.point, { layers: ["planned-dot"] }).length) return; // the day badge on top wins
      onPlace(e.features[0].properties.id);
    });
    map.on("mouseenter", id, () => (map.getCanvas().style.cursor = "pointer"));
    map.on("mouseleave", id, () => (map.getCanvas().style.cursor = ""));
  }

  const tierZoom = Object.fromEntries(placeLayers.map((id) => [id, map.getLayer(id).minzoom || 0]));
  const baseFilter = Object.fromEntries(placeLayers.map((id) => [id, map.getFilter(id)]));
  const dotZoom = Object.fromEntries(dotLayers.map((id) => [id, map.getLayer(id).minzoom || 0]));
  const dotFilter = Object.fromEntries(dotLayers.map((id) => [id, map.getFilter(id)]));
  let selT;
  return {
    map,
    // While a filter/search is active, matching places show at every zoom (so "zoom to results" works);
    // non-matching lesser places are hidden rather than dimmed, so the zoomed-out map stays readable.
    // Non-matching places disappear completely (Cem, 2026-11-05: hide, don't dim).
    showAllTiers(on) {
      for (const [id, z] of Object.entries(tierZoom)) {
        // Food icons stay off below z14 even when filtering: thousands of collided icons at city zoom form an even
        // lattice that looks like gridded data (2026-11-06). The dots show the real pattern there.
        map.setLayerZoomRange(id, on ? (id === "pins-local" ? Math.min(14, z) : 0) : z, 24);
        map.setFilter(id, on ? ["all", baseFilter[id], ["!", ["get", "dim"]]] : baseFilter[id]);
      }
      for (const id of dotLayers) {
        map.setLayerZoomRange(id, on ? 0 : dotZoom[id], 24);
        map.setFilter(id, on ? ["all", dotFilter[id], ["!", ["get", "dim"]]] : dotFilter[id]);
      }
    },
    setVibe(mode, only = []) { // mode: null | "character" | "lifestyle"; only: class/lifestyle ids to show (empty = all)
      const f = only.length ? ["in", ["get", mode === "lifestyle" ? "lifestyle" : "primary"], ["literal", only]] : null;
      for (const id of ["vibe-fill", "vibe-line"]) { map.setLayoutProperty(id, "visibility", mode ? "visible" : "none"); map.setFilter(id, f); }
      if (mode) map.setPaintProperty("vibe-fill", "fill-color", mode === "lifestyle" ? lifeColor : vibeColor);
    },
    vibeAt: (pt) => map.queryRenderedFeatures(pt, { layers: ["vibe-fill"] })[0]?.properties,
    setRoutes: (lines, stops) => setRouteData(map, lines, stops),
    setHere(c, radiusM, items = [], sel = -1) {
      const feats = [];
      if (c) {
        const ring = [];
        for (let i = 0; i <= 48; i++) {
          const a = (i / 48) * 2 * Math.PI;
          ring.push([c[0] + (radiusM / 84000) * Math.cos(a), c[1] + (radiusM / 111100) * Math.sin(a)]);
        }
        feats.push({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } },
                   { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: c } });
        // picked one last, so it draws on top
        items.map((xy, i) => ({ type: "Feature", properties: { n: i + 1, sel: i === sel }, geometry: { type: "Point", coordinates: xy } }))
          .sort((a, b) => a.properties.sel - b.properties.sel).forEach((f) => feats.push(f));
      }
      map.getSource("here").setData({ type: "FeatureCollection", features: feats });
    },
    setPlaces: (fc) => map.getSource("places").setData(slim(fc)),
    setPlanned: (fc) => map.getSource("planned").setData(fc),
    // Selecting shows the filled pin at once; deselecting fades it out (no flash when a card closes).
    select(id) {
      clearTimeout(selT);
      if (id) {
        map.setPaintProperty("selected", "icon-opacity-transition", { duration: 0, delay: 0 });
        map.setPaintProperty("selected", "text-opacity-transition", { duration: 0, delay: 0 });
        map.setPaintProperty("selected", "icon-opacity", 1); map.setPaintProperty("selected", "text-opacity", 1);
        map.setFilter("selected", ["==", ["get", "id"], id]);
      } else {
        map.setPaintProperty("selected", "icon-opacity-transition", { duration: 220, delay: 0 });
        map.setPaintProperty("selected", "text-opacity-transition", { duration: 220, delay: 0 });
        map.setPaintProperty("selected", "icon-opacity", 0); map.setPaintProperty("selected", "text-opacity", 0);
        selT = setTimeout(() => map.setFilter("selected", ["==", ["get", "id"], ""]), 240);
      }
    },
    setBasemap(id) {
      for (const k of ["extra-base", "extra-labels", "hills"]) { if (map.getLayer(k)) map.removeLayer(k); if (map.getSource(k)) map.removeSource(k); }
      const b = EXTRA_BASEMAPS[id];
      for (const l of baseLayerIds) if (map.getLayer(l)) map.setLayoutProperty(l, "visibility", b && !b.hillshade ? "none" : "visible");
      if (!b) return;
      if (b.hillshade) {
        // Shade sits under roads, buildings and labels (above land, parks and water), in theme colours.
        const above = baseLayerIds.find((l) => /road|tunnel|bridge|building|boundary|label|place|poi/.test(l)) || (map.getLayer("mask") ? "mask" : undefined);
        const dark = theme.basemap === "dark";
        map.addSource("hills", { type: "raster-dem", tiles: [b.hillshade], tileSize: 256, maxzoom: Math.min(b.max, 12), encoding: "terrarium" }); // z12 DEM, over-zoomed: same look, far less memory
        map.addLayer({ id: "hills", type: "hillshade", source: "hills", paint: {
          "hillshade-exaggeration": 0.75, "hillshade-illumination-direction": 315,
          "hillshade-shadow-color": dark ? "black" : cssVar("--c-ink-2"),
          "hillshade-highlight-color": dark ? cssVar("--c-ink-2") : cssVar("--c-surface"),
          "hillshade-accent-color": dark ? "black" : cssVar("--c-ink-2") } }, above);
        return;
      }
      const before = map.getLayer("mask") ? "mask" : undefined; // under the edge veil, lines and pins
      map.addSource("extra-base", { type: "raster", tiles: b.tiles, tileSize: 256, maxzoom: b.max });
      map.addLayer({ id: "extra-base", type: "raster", source: "extra-base" }, before);
      if (b.labels) {
        map.addSource("extra-labels", { type: "raster", tiles: b.labels, tileSize: 256, maxzoom: b.max });
        map.addLayer({ id: "extra-labels", type: "raster", source: "extra-labels" }, before);
      }
    },
    setMe: (lngLat) => map.getSource("me").setData({ type: "FeatureCollection",
      features: lngLat ? [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: lngLat } }] : [] }),
  };
}
