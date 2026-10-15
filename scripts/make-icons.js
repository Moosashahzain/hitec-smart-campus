// Generates proposed-branding app icons (navy rounded square + gold block "H").
// These are PLACEHOLDER marks for the student demo — not the official HITEC logo.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function png(w, h, px) {
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 4)] = 0;
    for (let x = 0; x < w; x++) {
      const o = y * (1 + w * 4) + 1 + x * 4;
      const p = px(x, y);
      raw[o] = p[0]; raw[o + 1] = p[1]; raw[o + 2] = p[2]; raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32 ? crc32(td) : 0, 0);
    return Buffer.concat([len, td, crc]);
  };
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0)),
  ]);
}
// tiny crc32 (zlib has no public crc32 in older node)
function crc32(buf) {
  let t = crc32.t;
  if (!t) { t = crc32.t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } }
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

const NAVY = [20, 44, 78], GOLD = [199, 166, 90];
function draw(size) {
  const r = size * 0.22; // corner radius
  const bar = size * 0.16, gap = size * 0.18; // H proportions
  return png(size, size, (x, y) => {
    // rounded-rect mask
    const cx = Math.min(Math.max(x, r), size - r), cy = Math.min(Math.max(y, r), size - r);
    const dx = x - cx, dy = y - cy;
    if (dx * dx + dy * dy > r * r) return [0, 0, 0]; // transparent corner
    // gold border ring
    const b = size * 0.045;
    const inBorder = x < b || y < b || x > size - b || y > size - b;
    // block "H": two vertical bars + crossbar
    const x0 = (size - 2 * bar - gap) / 2;
    const y0 = size * 0.28, y1 = size * 0.72, mid0 = size * 0.46, mid1 = size * 0.54;
    const inH = (x >= x0 && x < x0 + bar && y >= y0 && y < y1) ||
                (x >= x0 + bar + gap && x < x0 + 2 * bar + gap && y >= y0 && y < y1) ||
                (x >= x0 && x < x0 + 2 * bar + gap && y >= mid0 && y < mid1);
    if (inH) return GOLD;
    if (inBorder) return GOLD;
    return NAVY;
  });
}

const out = path.join(__dirname, '..', 'src', 'public');
for (const s of [192, 512]) {
  fs.writeFileSync(path.join(out, `icon-${s}.png`), draw(s));
  console.log('wrote icon-' + s + '.png');
}
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="#142C4E"/><rect x="23" y="23" width="466" height="466" rx="95" fill="none" stroke="#C7A65A" stroke-width="18"/><g fill="#C7A65A"><rect x="176" y="143" width="82" height="226"/><rect x="254" y="143" width="82" height="226"/><rect x="176" y="235" width="160" height="42"/></g></svg>`;
fs.writeFileSync(path.join(out, 'icon.svg'), svg);
console.log('wrote icon.svg');
