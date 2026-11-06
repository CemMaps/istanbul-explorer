// MapLibre setup: themed basemap, study-area mask, ferries, stops, fixed points and place pins by tier.
import { cssVar, catVar } from "./theme.js";
import { pinImage } from "./icons.js";

const BASEMAPS = {
  positron: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
  voyager: "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json",
  dark: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
};
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

// Frosted veil outside the study area. `rings` = the study area's outer ring(s) in [lng, lat].
// The mask is drawn on a quarter-size canvas (soft anyway) each frame the map moves: opaque everywhere,
// with the study area cut out through a shadow blur, so the cut-out has a feathered edge that starts
// at the outline and reaches full blur ~1.6 km further out. The shadow trick works on iOS Safari too
// (canvas `filter` doesn't).
function frostOutside(map, rings) {
  const veil = document.createElement("div");
  veil.className = "map-veil";
  map.getCanvasContainer().after(veil);
  const cv = document.createElement("canvas");
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  const Q = 4, FEATHER_M = 1600, OFF = 4000;
  let raf = 0;
  const draw = () => {
    raf = 0;
    const { clientWidth: w, clientHeight: h } = map.getContainer();
    if (!w || !h) return; // map hidden (another tab is showing)
    cv.width = Math.ceil(w / Q); cv.height = Math.ceil(h / Q);
    const c = map.getCenter();
    const mPerPx = (40075016 * Math.cos((c.lat * Math.PI) / 180)) / (512 * 2 ** map.getZoom());
    const f = Math.min(Math.max(FEATHER_M / mPerPx, 14), 120) / Q; // feather in small-canvas px
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "black"; // mask alpha only, never shown
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath();
    for (const ring of rings) ring.forEach((ll, i) => {
      const p = map.project(ll);
      ctx[i ? "lineTo" : "moveTo"](p.x / Q + OFF, p.y / Q);
    });
    ctx.closePath();
    // Draw the shape far off-canvas and let only its blurred shadow land on the canvas; a stroke of
    // width f grows it by f/2 first, so the fade sits outside the outline, not across it.
    ctx.shadowColor = "black"; ctx.shadowBlur = f; ctx.shadowOffsetX = -OFF;
    ctx.lineWidth = f; ctx.lineJoin = "round";
    ctx.fill(); ctx.stroke();
    ctx.shadowBlur = 0; ctx.shadowOffsetX = 0;
    const px = ctx.getImageData(0, 0, cv.width, cv.height).data;
    let any = false;
    for (let i = 3; i < px.length; i += 16) if (px[i] > 8) { any = true; break; }
    veil.hidden = !any; // zoomed in well inside the area: no veil, no blur cost
    if (any) veil.style.webkitMaskImage = veil.style.maskImage = `url(${cv.toDataURL()})`;
  };
  const queue = () => { if (!raf) raf = requestAnimationFrame(draw); };
  map.on("move", draw); map.on("resize", queue); // same frame as the map, so the veil never lags
  draw();
}

export async function createMap({ container, theme, config, data, onPlace }) {
  const map = new maplibregl.Map({
    container,
    style: BASEMAPS[theme.basemap] || BASEMAPS.positron,
    center: config.map.center, zoom: config.map.zoom,
    minZoom: config.map.minZoom, maxZoom: config.map.maxZoom,
    attributionControl: false, // credit shown as a small line on the map + full credits screen (see app.js)
    pitchWithRotate: false, dragRotate: false,
    fadeDuration: 0, // no symbol fade: pins hidden by a collision used to blink back in after closing a card
  });
  map.touchZoomRotate.disableRotation();
  await new Promise((r) => map.on("load", r));

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
  for (const c of config.categories) {
    const col = cssVar(catVar(c.id));
    map.addImage(`pin-${slug(c.id)}`, await pinImage(c.icon, col, bg, { filled: pinFilled }), { pixelRatio: 2 });
    map.addImage(`pin-${slug(c.id)}-sel`, await pinImage(c.icon, col, bg, { filled: !pinFilled }), { pixelRatio: 2 });
  }
  const navy = cssVar("--c-navy");
  // On the dark basemap the navy home pin disappears: white icon + light outline there.
  const dark = theme.basemap === "dark";
  map.addImage("pin-home", await pinImage("home", navy, bg, dark ? { filled: true, inkColor: cssVar("--c-ink-inverse"), ring: cssVar("--c-ink-inverse") } : { filled: true }), { pixelRatio: 2 });
  map.addImage("pin-airport", await pinImage("plane", navy, bg, { filled: true }), { pixelRatio: 2 });

  // Outside the study area: frosted glass that fades in (2026-11-06, Cem: "a gradient of blurriness, no outline").
  // A DOM layer over the map canvas blurs what is behind it (backdrop-filter); its mask is the study area,
  // feathered, so the blur and the milky tint grow gradually past the edge. Browsers without backdrop-filter
  // fall back to the plain milky fill below.
  map.addSource("mask", { type: "geojson", data: data.mask });
  const frosted = CSS.supports("backdrop-filter", "blur(2px)") || CSS.supports("-webkit-backdrop-filter", "blur(2px)");
  map.addLayer({ id: "mask", type: "fill", source: "mask",
    paint: { "fill-color": cssVar("--c-surface"), "fill-opacity": frosted ? 0.18 : Math.max(theme.maskOpacity ?? 0.7, 0.78) } });
  if (frosted) frostOutside(map, data.mask.features[0].geometry.coordinates.slice(1));

  // Vibe map: soft translucent fill under everything, off by default (character or lifestyle colouring).
  map.addSource("areas", { type: "geojson", data: data.areas || { type: "FeatureCollection", features: [] } });
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
             "line-dasharray": [2, 2.5], "line-opacity": ["interpolate", ["linear"], ["zoom"], 10, 0.3, 14, 0.55] } });

  // Stations and piers (close zoom only)
  map.addSource("stops", { type: "geojson", data: data.stops });
  const modeColor = ["match", ["get", "mode"], ...["metro", "tram", "funicular", "ferry", "rail"].flatMap((m) => [m, cssVar(`--transit-${m}`)]), cssVar("--c-ink-2")];
  map.addLayer({ id: "stops", type: "circle", source: "stops", minzoom: 14.5,
    paint: { "circle-radius": 4, "circle-color": modeColor, "circle-stroke-color": bg, "circle-stroke-width": 1.5 } });
  map.addLayer({ id: "stops-lbl", type: "symbol", source: "stops", minzoom: 15.5,
    layout: { "text-field": ["get", "name"], "text-size": 11, "text-font": FONT_REG, "text-offset": [0, 0.9], "text-anchor": "top", "text-optional": true },
    paint: { "text-color": cssVar("--c-ink-2"), "text-halo-color": bg, "text-halo-width": 1.2 } });

  // Places
  map.addSource("places", { type: "geojson", data: data.places, promoteId: "id" });
  const dimOp = ["case", ["get", "dim"], config.dimOpacity, 1];
  const tiers = Object.entries(config.tiers).reverse(); // draw bonus first, must-see on top
  const placeLayers = [];
  const dotLayers = [];
  // Discovery dots: every place is always at least a small coloured dot, so nothing is invisible.
  // They show a few zoom levels before the tier's icons, then sit underneath them; if an icon is
  // hidden by a collision, its dot still shows.
  const catColor = ["match", ["get", "category"], ...config.categories.flatMap((c) => [c.id, cssVar(catVar(c.id))]), cssVar("--c-ink-2")];
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
        "icon-image": ["concat", "pin-", ["get", "catslug"]],
        // Small at city zoom so more icons fit; collisions on, so the most famous win instead of piling up
        // (a hidden icon still shows as its dot underneath).
        "icon-size": ["interpolate", ["linear"], ["zoom"], 10, t.size * 0.48, 12, t.size * 0.6, 14, t.size * 0.8, 17, t.size],
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

  // Selected place: filled, bigger, always labelled.
  map.addLayer({ id: "selected", type: "symbol", source: "places", filter: ["==", ["get", "id"], ""],
    layout: { "icon-image": ["concat", "pin-", ["get", "catslug"], "-sel"], "icon-size": 1.15, "icon-allow-overlap": true, "icon-ignore-placement": true, "text-ignore-placement": true,
              "text-field": ["get", "name"], "text-font": FONT_BOLD, "text-size": 13, "text-offset": [0, 1.7], "text-anchor": "top",
              "text-allow-overlap": true },
    paint: { "text-color": cssVar("--c-ink-inverse"), "text-halo-color": navy, "text-halo-width": 6 } });

  // Fixed points: the flat + airport
  map.addSource("fixed", { type: "geojson", data: data.fixed });
  map.addLayer({ id: "fixed", type: "symbol", source: "fixed",
    layout: { "icon-image": ["match", ["get", "kind"], "home", "pin-home", "pin-airport"], "icon-allow-overlap": true,
              // same size as a must-see pin
              "icon-size": ["interpolate", ["linear"], ["zoom"], 10, config.tiers["must-see"].size * 0.62, 14, config.tiers["must-see"].size * 0.82, 17, config.tiers["must-see"].size],
              "text-field": ["step", ["zoom"], "", 13, ["get", "name"]], "text-font": FONT_BOLD, "text-size": 11.5,
              "text-offset": [0, 1.4], "text-anchor": "top", "text-optional": true },
    paint: { "text-color": navy, "text-halo-color": bg, "text-halo-width": 1.4 } });

  addRouteLayers(map, bg);

  // "What's here" marker + radius ring
  map.addSource("here", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  map.addLayer({ id: "here-ring", type: "fill", source: "here", filter: ["==", ["geometry-type"], "Polygon"],
    paint: { "fill-color": cssVar("--c-primary"), "fill-opacity": 0.12 } });
  map.addLayer({ id: "here-ring-line", type: "line", source: "here", filter: ["==", ["geometry-type"], "Polygon"],
    paint: { "line-color": cssVar("--c-primary"), "line-width": 2.5, "line-dasharray": [2, 1.5], "line-opacity": 0.9 } });
  map.addLayer({ id: "here-pt", type: "circle", source: "here", filter: ["==", ["geometry-type"], "Point"],
    paint: { "circle-radius": 8, "circle-color": navy, "circle-stroke-color": bg, "circle-stroke-width": 3 } });

  // You-are-here
  map.addSource("me", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  map.addLayer({ id: "me-halo", type: "circle", source: "me", paint: { "circle-radius": 16, "circle-color": cssVar("--c-primary"), "circle-opacity": 0.18 } });
  map.addLayer({ id: "me", type: "circle", source: "me", paint: { "circle-radius": 7, "circle-color": cssVar("--c-primary"), "circle-stroke-color": bg, "circle-stroke-width": 2.5 } });

  for (const id of dotLayers) {
    // A tap on a dot zooms in to where its icon shows (or opens it if we're already close).
    map.on("click", id, (e) => {
      if (map.queryRenderedFeatures(e.point, { layers: [...placeLayers, "selected"] }).length) return; // icon handles it
      const f = e.features[0];
      const target = config.tiers[f.properties.tier].minzoom + 0.4;
      if (map.getZoom() >= target - 0.2) onPlace(f.properties.id);
      else map.easeTo({ center: f.geometry.coordinates, zoom: Math.max(target, map.getZoom() + 1.5), duration: 600 });
    });
    map.on("mouseenter", id, () => (map.getCanvas().style.cursor = "pointer"));
    map.on("mouseleave", id, () => (map.getCanvas().style.cursor = ""));
  }
  for (const id of [...placeLayers, "selected"]) {
    map.on("click", id, (e) => onPlace(e.features[0].properties.id));
    map.on("mouseenter", id, () => (map.getCanvas().style.cursor = "pointer"));
    map.on("mouseleave", id, () => (map.getCanvas().style.cursor = ""));
  }

  const tierZoom = Object.fromEntries(placeLayers.map((id) => [id, map.getLayer(id).minzoom || 0]));
  const baseFilter = Object.fromEntries(placeLayers.map((id) => [id, map.getFilter(id)]));
  const dotZoom = Object.fromEntries(dotLayers.map((id) => [id, map.getLayer(id).minzoom || 0]));
  const dotFilter = Object.fromEntries(dotLayers.map((id) => [id, map.getFilter(id)]));
  return {
    map,
    // While a filter/search is active, matching places show at every zoom (so "zoom to results" works);
    // non-matching lesser places are hidden rather than dimmed, so the zoomed-out map stays readable.
    // Non-matching places disappear completely (Cem, 2026-11-05: hide, don't dim).
    showAllTiers(on) {
      for (const [id, z] of Object.entries(tierZoom)) {
        map.setLayerZoomRange(id, on ? 0 : z, 24);
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
    setHere(c, radiusM) {
      const feats = [];
      if (c) {
        const ring = [];
        for (let i = 0; i <= 48; i++) {
          const a = (i / 48) * 2 * Math.PI;
          ring.push([c[0] + (radiusM / 84000) * Math.cos(a), c[1] + (radiusM / 111100) * Math.sin(a)]);
        }
        feats.push({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } },
                   { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: c } });
      }
      map.getSource("here").setData({ type: "FeatureCollection", features: feats });
    },
    setPlaces: (fc) => map.getSource("places").setData(fc),
    select: (id) => map.setFilter("selected", ["==", ["get", "id"], id || ""]),
    setMe: (lngLat) => map.getSource("me").setData({ type: "FeatureCollection",
      features: lngLat ? [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: lngLat } }] : [] }),
  };
}
