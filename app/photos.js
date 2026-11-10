// Photo URLs (Wikimedia Commons).
// 2026-11-10: thumbnails load straight from upload.wikimedia.org instead of going through Special:FilePath.
// FilePath answers with a redirect, so every photo cost two requests to two servers, and the image came back
// "opaque" (no CORS), which the offline cache can't check (a failed download would be kept as a broken photo).
// The direct address is worked out from the file name (Commons files live under the first hex digits of the MD5
// of their name). If a direct address ever fails (renamed file, odd format), the <img> falls back to FilePath.

// Wikimedia serves thumbnails at standard widths only; other sizes are slow or refused. Snap up to the next one.
const THUMB_W = [120, 250, 330, 500, 960, 1280];
const snap = (w) => THUMB_W.find((x) => x >= w) || 1280;
const plainFile = (f) => { try { return decodeURIComponent(f); } catch { return f; } }; // some names arrive URL-encoded

function md5(str) {
  const bytes = new TextEncoder().encode(str), n = bytes.length;
  const words = new Uint32Array((((n + 8) >> 6) + 1) * 16);
  for (let i = 0; i < n; i++) words[i >> 2] |= bytes[i] << ((i % 4) * 8);
  words[n >> 2] |= 0x80 << ((n % 4) * 8);
  words[words.length - 2] = n * 8;
  const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  for (let o = 0; o < words.length; o += 16) {
    let a = a0, b = b0, c = c0, d = d0;
    for (let i = 0; i < 64; i++) {
      let f, g;
      const r = i >> 4;
      if (r === 0) { f = (b & c) | (~b & d); g = i; }
      else if (r === 1) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16; }
      else if (r === 2) { f = b ^ c ^ d; g = (3 * i + 5) % 16; }
      else { f = c ^ (b | ~d); g = (7 * i) % 16; }
      const t = d; d = c; c = b;
      const x = (a + f + Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) + words[o + g]) | 0;
      const s = S[r * 4 + (i % 4)];
      b = (b + ((x << s) | (x >>> (32 - s)))) | 0;
      a = t;
    }
    a0 = (a0 + a) | 0; b0 = (b0 + b) | 0; c0 = (c0 + c) | 0; d0 = (d0 + d) | 0;
  }
  return [a0, b0, c0, d0].map((v) => [0, 8, 16, 24].map((s) => ((v >>> s) & 255).toString(16).padStart(2, "0")).join("")).join("");
}

const DIRECT = new Map(); // file -> "<h>/<hh>/<encoded name>" (the MD5 is worked out once per file)
function directPath(file) {
  let p = DIRECT.get(file);
  if (p === undefined) {
    let name = plainFile(file).replace(/ /g, "_");
    name = name.charAt(0).toUpperCase() + name.slice(1);
    // Only plain bitmap formats: SVG, TIFF, WebP… thumbnails are named differently, so those use FilePath.
    if (/\.(jpe?g|png)$/i.test(name)) { const h = md5(name), e = encodeURIComponent(name); p = `${h[0]}/${h.slice(0, 2)}/${e}`; } else p = null;
    DIRECT.set(file, p);
  }
  return p;
}

export const photoFallback = (file, w = 500) => `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(plainFile(file))}?width=${snap(w)}`;
export const isDirect = (file) => !!directPath(file);
export function photoUrl(file, w = 500) {
  const p = directPath(file);
  return p ? `https://upload.wikimedia.org/wikipedia/commons/thumb/${p}/${snap(w)}px-${p.slice(p.lastIndexOf("/") + 1)}` : photoFallback(file, w);
}

// <img> for a Commons photo: fades in once loaded; if the direct address fails it tries FilePath once, then removes itself
// (the coloured placeholder with the category icon stays).
export function photoImg(file, w, attrs = "") {
  const direct = isDirect(file);
  return `<img class="ph" ${direct ? 'crossorigin="anonymous" ' : ""}decoding="async" src="${photoUrl(file, w)}" ${direct ? `data-fb="${photoFallback(file, w).replace(/"/g, "&quot;")}" ` : ""}onload="this.classList.add('is-in')" onerror="oitImgErr(this)" ${attrs}>`;
}
window.oitImgErr = (el) => {
  const fb = el.dataset.fb;
  if (!fb) return el.remove();
  delete el.dataset.fb;
  el.removeAttribute("crossorigin");
  el.src = fb;
};
