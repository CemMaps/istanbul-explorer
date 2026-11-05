// Line icons, 24×24, stroke = currentColor. Drawn for this app (simple geometric shapes).
const P = {
  dome: '<path d="M4 20h16"/><path d="M6 20v-6a6 6 0 0 1 12 0v6"/><path d="M12 8V5"/><path d="M12 5c1.2 0 1.8-.6 1.8-1.5"/><path d="M2.5 20V9.5l1-1.5 1 1.5V20"/><path d="M19.5 20V9.5l1-1.5 1 1.5V20"/>',
  columns: '<path d="M3 9l9-5 9 5"/><path d="M4 9h16"/><path d="M6 9v9M10 9v9M14 9v9M18 9v9"/><path d="M3 20h18"/>',
  eye: '<path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  bag: '<path d="M5 8h14l-1 12H6L5 8z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
  utensils: '<path d="M7 3v8"/><path d="M4.5 3v5a2.5 2.5 0 0 0 5 0V3"/><path d="M7 11v10"/><path d="M17 21V3c-2 1.5-3 4-3 7v3h3"/>',
  tree: '<path d="M12 22v-6"/><path d="M12 16c-4.5 0-7-2.5-7-5.5C5 7 8 4 12 2c4 2 7 5 7 8.5 0 3-2.5 5.5-7 5.5z"/>',
  label: '<path d="M4 7h16M4 12h10M4 17h13"/>',
  home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-5h4v5"/>',
  plane: '<path d="M10.5 3.5c.8-.8 2.2-.8 3 0 .4.4.6 1 .5 1.6L13 10l7 4v2l-7-2-.5 4 2 1.5V21L12 20l-2.5 1v-1.5l2-1.5-.5-4-7 2v-2l7-4-1-4.9c-.1-.6.1-1.2.5-1.6z"/>',
  locate: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  heart: '<path d="M12 20s-7.5-4.6-9.3-9.4C1.5 7.2 3.6 4 7 4c2 0 3.6 1.1 5 3 1.4-1.9 3-3 5-3 3.4 0 5.5 3.2 4.3 6.6C19.5 15.4 12 20 12 20z"/>',
  chevronDown: '<path d="M6 9l6 6 6-6"/>',
  chevronRight: '<path d="M9 6l6 6-6 6"/>',
  back: '<path d="M15 6l-6 6 6 6"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5 5-2z"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  cloud: '<path d="M7 18h10a4 4 0 0 0 .5-8 5.5 5.5 0 0 0-10.6 1.4A3.3 3.3 0 0 0 7 18z"/>',
  cloudSun: '<path d="M8 6.5a3.5 3.5 0 0 1 6.3.9"/><path d="M8 3v1M3.8 4.8l.7.7M2.5 9h1"/><path d="M8 20h9a3.5 3.5 0 0 0 .4-7 5 5 0 0 0-9.6 1.2A2.9 2.9 0 0 0 8 20z"/>',
  rain: '<path d="M7 15h10a4 4 0 0 0 .5-8 5.5 5.5 0 0 0-10.6 1.4A3.3 3.3 0 0 0 7 15z"/><path d="M8 18l-1 2.5M12 18l-1 2.5M16 18l-1 2.5"/>',
  sunset: '<path d="M3 18h18M6 21h12"/><path d="M7 18a5 5 0 0 1 10 0"/><path d="M12 4v5M9.5 7L12 9.5 14.5 7"/><path d="M4 12l1.3.8M20 12l-1.3.8"/>',
  pin: '<path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
  train: '<rect x="5" y="3" width="14" height="14" rx="3"/><path d="M5 11h14M9 21l1.5-4M15 21l-1.5-4"/><circle cx="8.5" cy="14" r=".8"/><circle cx="15.5" cy="14" r=".8"/>',
  tram: '<rect x="6" y="6" width="12" height="11" rx="2.5"/><path d="M8 3h8M12 3v3M6 12h12M8 21l2-4M16 21l-2-4"/>',
  ship: '<path d="M3 15l2 5h14l2-5H3z"/><path d="M6 15V9h12v6"/><path d="M10 9V5h4v4"/>',
  walk: '<circle cx="13" cy="4.5" r="1.8"/><path d="M10 21l2-6-2.5-2.5 1-5L14 9l2.5 3"/><path d="M9.5 7.5L7 10v3"/><path d="M12 15l3 6"/>',
  car: '<path d="M4 16V12l2-5h12l2 5v4"/><path d="M3 16h18v3H3z"/><circle cx="7.5" cy="16" r="1.5"/><circle cx="16.5" cy="16" r="1.5"/>',
  share: '<path d="M12 15V3M7.5 7.5L12 3l4.5 4.5"/><path d="M5 12v7h14v-7"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z"/>',
};

export function icon(name, size = 22, extra = "") {
  return `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${P[name] || ""}</svg>`;
}

// Map pin image: round badge with a category icon. Outlined = white fill + coloured ring/icon; filled = inverse.
export function pinImage(name, color, bg, { filled = false, px = 44, ratio = 2 } = {}) {
  const s = px * ratio;
  const ringW = 2.4;
  const fill = filled ? color : bg;
  const ink = filled ? bg : color;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 44 44">
    <circle cx="22" cy="22" r="${20 - ringW / 2}" fill="${fill}" stroke="${color}" stroke-width="${ringW}"/>
    <g transform="translate(11 11) scale(0.9167)" fill="none" stroke="${ink}" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">${P[name] || ""}</g>
  </svg>`;
  return new Promise((resolve) => {
    const img = new Image(s, s);
    img.onload = () => resolve(img);
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  });
}
