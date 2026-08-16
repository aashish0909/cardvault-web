// Zero-dependency PWA icon generator. Draws the CardVault mark (a rounded
// card with a keyhole) with 4x supersampled anti-aliasing and writes PNGs to
// public/icons. Run with: node scripts/gen-icons.mjs

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
const SS = 4;

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePNG(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    rgba.copy(raw, y * stride + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const BG_TOP = 0x1b2735;
const BG_BOTTOM = 0x0b0f14;
const CARD_TOP = 0x66a8ff;
const CARD_BOTTOM = 0x2f5cc4;
const CHIP = 0xf2cf7e;
const HOLE = 0x0b0f14;

function render(size, { radius, cardScale }) {
  const W = size * SS;
  const px = new Float64Array(W * W * 4);

  const c0 = [BG_TOP >> 16, (BG_TOP >> 8) & 0xff, BG_TOP & 0xff];
  const c1 = [BG_BOTTOM >> 16, (BG_BOTTOM >> 8) & 0xff, BG_BOTTOM & 0xff];
  const cc0 = [CARD_TOP >> 16, (CARD_TOP >> 8) & 0xff, CARD_TOP & 0xff];
  const cc1 = [CARD_BOTTOM >> 16, (CARD_BOTTOM >> 8) & 0xff, CARD_BOTTOM & 0xff];

  const u = size / 512;
  const inRR = (x, y, x0, y0, w, h, r) => {
    const cx = Math.min(Math.max(x, x0 + r), x0 + w - r);
    const cy = Math.min(Math.max(y, y0 + r), y0 + h - r);
    const dx = x - cx;
    const dy = y - cy;
    return dx * dx + dy * dy <= r * r;
  };

  const set = (x, y, rgb) => {
    const i = (y * W + x) * 4;
    px[i] = rgb[0];
    px[i + 1] = rgb[1];
    px[i + 2] = rgb[2];
    px[i + 3] = 255;
  };

  const fillRR = (x0, y0, w, h, r, top, bottom) => {
    for (let y = 0; y < W; y++) {
      for (let x = 0; x < W; x++) {
        if (!inRR(x, y, x0, y0, w, h, r)) continue;
        const t = (y - y0) / h;
        set(x, y, [
          top[0] + (bottom[0] - top[0]) * t,
          top[1] + (bottom[1] - top[1]) * t,
          top[2] + (bottom[2] - top[2]) * t,
        ]);
      }
    }
  };

  fillRR(0, 0, W, W, radius * W, c0, c1);

  const cardW = cardScale * W;
  const cardH = cardW * (0.36 / 0.54);
  const cardX = (W - cardW) / 2;
  const cardY = (W - cardH) / 2;
  fillRR(cardX, cardY, cardW, cardH, cardW * 0.075, cc0, cc1);

  const chipW = cardW * 0.22;
  const chipH = chipW * 0.72;
  const chipX = cardX + cardW * 0.1;
  const chipY = cardY + cardH * 0.16;
  fillRR(chipX, chipY, chipW, chipH, chipW * 0.12, [CHIP >> 16, (CHIP >> 8) & 0xff, CHIP & 0xff], [CHIP >> 16, (CHIP >> 8) & 0xff, CHIP & 0xff]);

  const cx = W / 2;
  const cy = cardY + cardH / 2;
  const R = cardW * 0.09;
  const hole = [HOLE >> 16, (HOLE >> 8) & 0xff, HOLE & 0xff];
  const slotTop = cardW * 0.115;
  const slotBottom = cardW * 0.095;
  const slotH = cardW * 0.14;
  for (let y = 0; y < W; y++) {
    const dy = y - cy;
    for (let x = 0; x < W; x++) {
      const dx = x - cx;
      if (dx * dx + dy * dy <= R * R) {
        set(x, y, hole);
      } else if (dy > 0) {
        const t = Math.min(1, dy / slotH);
        if (Math.abs(dx) <= slotTop + (slotBottom - slotTop) * t) set(x, y, hole);
      }
    }
  }

  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let sw = 0;
      let sr = 0;
      let sg = 0;
      let sb = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const i = ((y * SS + sy) * W + x * SS + sx) * 4;
          const w = px[i + 3] / 255;
          sw += w;
          sr += px[i] * w;
          sg += px[i + 1] * w;
          sb += px[i + 2] * w;
        }
      }
      const o = (y * size + x) * 4;
      out[o] = sw > 0 ? sr / sw : 0;
      out[o + 1] = sw > 0 ? sg / sw : 0;
      out[o + 2] = sw > 0 ? sb / sw : 0;
      out[o + 3] = Math.round((sw / (SS * SS)) * 255);
    }
  }
  return out;
}

const jobs = [
  ['icon-192.png', 192, { radius: 0.225, cardScale: 0.54 }],
  ['icon-512.png', 512, { radius: 0.225, cardScale: 0.54 }],
  ['icon-maskable-512.png', 512, { radius: 0, cardScale: 0.42 }],
  ['apple-touch-icon.png', 180, { radius: 0, cardScale: 0.54 }],
];

mkdirSync(OUT, { recursive: true });
for (const [name, size, opts] of jobs) {
  writeFileSync(join(OUT, name), encodePNG(size, render(size, opts)));
  console.log(`wrote public/icons/${name}`);
}
