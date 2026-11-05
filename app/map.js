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

export async function createMap({ container, theme, config, data, onPlace }) {
  const map = new maplibregl.Map({
    container,
    style: BASEMAPS[theme.basemap] || BASEMAPS.positron,
    center: config.map.center, zoom: config.map.zoom,
    minZoom: config.map.minZoom, maxZoom: config.map.maxZoom,
    attributionControl: { compact: true },
    pitchWithRotate: false, dragRotate: false,
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
  map.addImage("pin-home", await pinImage("home", navy, bg, { filled: true }), { pixelRatio: 2 });
  map.addImage("pin-airport", await pinImage("plane", navy, bg, { filled: true }), { pixelRatio: 2 });

  // Mask outside the study area.
  map.addSource("mask", { type: "geojson", data: data.mask });
  map.addLayer({ id: "mask", type: "fill", source: "mask",
    paint: { "fill-color": cssVar("--c-mask"), "fill-opacity": theme.maskOpacity ?? 0.7 } });

  // Ferries
  map.addSource("ferries", { type: "geojson", data: data.ferries });
  map.addLayer({ id: "ferries", type: "line", source: "ferries",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": cssVar("--route-ferry"), "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1.2, 15, 2.6],
             "line-dasharray": [2, 2], "line-opacity": 0.75 } });

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
  for (const [tier, t] of tiers) {
    const isTier = ["==", ["get", "tier"], tier];
    const notLabelCat = ["!=", ["get", "asLabel"], true];
    const labelFrom = tier === "must-see" ? 13 : tier === "worth-it" ? 15 : 16.2;
    map.addLayer({
      id: `pins-${tier}`, type: "symbol", source: "places", minzoom: t.minzoom,
      filter: ["all", isTier, notLabelCat],
      layout: {
        "icon-image": ["concat", "pin-", ["get", "catslug"]],
        "icon-size": ["interpolate", ["linear"], ["zoom"], 10, t.size * 0.62, 14, t.size * 0.82, 17, t.size],
        "icon-allow-overlap": tier === "must-see", "icon-padding": 1,
        "symbol-sort-key": ["-", 0, ["get", "score"]],
        "text-field": ["step", ["zoom"], "", labelFrom, ["get", "name"]],
        "text-font": tier === "must-see" ? FONT_BOLD : FONT_REG, "text-size": tier === "must-see" ? 12.5 : 11.5,
        "text-offset": [0, 1.35], "text-anchor": "top", "text-optional": true, "text-max-width": 9,
      },
      paint: { "icon-opacity": dimOp, "text-opacity": dimOp, "text-color": cssVar("--c-ink"),
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
    layout: { "icon-image": ["concat", "pin-", ["get", "catslug"], "-sel"], "icon-size": 1.15, "icon-allow-overlap": true,
              "text-field": ["get", "name"], "text-font": FONT_BOLD, "text-size": 13, "text-offset": [0, 1.7], "text-anchor": "top",
              "text-allow-overlap": true },
    paint: { "text-color": cssVar("--c-ink-inverse"), "text-halo-color": navy, "text-halo-width": 6 } });

  // Fixed points: the flat + airport
  map.addSource("fixed", { type: "geojson", data: data.fixed });
  map.addLayer({ id: "fixed", type: "symbol", source: "fixed",
    layout: { "icon-image": ["match", ["get", "kind"], "home", "pin-home", "pin-airport"], "icon-size": 0.85, "icon-allow-overlap": true,
              "text-field": ["step", ["zoom"], "", 13, ["get", "name"]], "text-font": FONT_BOLD, "text-size": 11.5,
              "text-offset": [0, 1.4], "text-anchor": "top", "text-optional": true },
    paint: { "text-color": navy, "text-halo-color": bg, "text-halo-width": 1.4 } });

  // You-are-here
  map.addSource("me", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  map.addLayer({ id: "me-halo", type: "circle", source: "me", paint: { "circle-radius": 16, "circle-color": cssVar("--c-primary"), "circle-opacity": 0.18 } });
  map.addLayer({ id: "me", type: "circle", source: "me", paint: { "circle-radius": 7, "circle-color": cssVar("--c-primary"), "circle-stroke-color": bg, "circle-stroke-width": 2.5 } });

  for (const id of [...placeLayers, "selected"]) {
    map.on("click", id, (e) => onPlace(e.features[0].properties.id));
    map.on("mouseenter", id, () => (map.getCanvas().style.cursor = "pointer"));
    map.on("mouseleave", id, () => (map.getCanvas().style.cursor = ""));
  }

  return {
    map,
    setPlaces: (fc) => map.getSource("places").setData(fc),
    select: (id) => map.setFilter("selected", ["==", ["get", "id"], id || ""]),
    setMe: (lngLat) => map.getSource("me").setData({ type: "FeatureCollection",
      features: lngLat ? [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: lngLat } }] : [] }),
  };
}
