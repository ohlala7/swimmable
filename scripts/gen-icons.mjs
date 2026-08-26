import { deflateSync } from 'zlib';
import { writeFileSync, mkdirSync } from 'fs';

function crc32(buf) {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c;
  }
  let crc = 0xFFFFFFFF;
  for (const byte of buf) crc = table[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBytes = Buffer.from(type);
  const combined = Buffer.concat([typeBytes, data]);
  const crcVal = Buffer.alloc(4);
  crcVal.writeUInt32BE(crc32(combined));
  return Buffer.concat([len, typeBytes, data, crcVal]);
}

// Smooth step for antialiased edges
function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// iOS-style rounded rectangle: returns 0..1 alpha
function roundedRectAlpha(x, y, size, radius) {
  const r = size * radius;
  const cx = size / 2, cy = size / 2;
  const hw = size / 2 - r;
  const hh = size / 2 - r;
  const dx = Math.max(0, Math.abs(x - cx) - hw);
  const dy = Math.max(0, Math.abs(y - cy) - hh);
  const dist = Math.sqrt(dx * dx + dy * dy);
  return 1 - smoothstep(r - 1, r + 1, dist);
}

function createIcon(size) {
  // Palette
  const bgTop    = [14, 32, 58];    // #0E203A  deep ocean navy
  const bgBottom = [6,  14, 28];    // #060E1C  near black
  const waveMain = [0,  212, 142];  // #00D48E  Go teal
  const waveBack = [0,  160, 110];  // dimmer teal for back wave

  const CORNER = 0.225;   // iOS squircle corner %
  const strokeMain = size * 0.068;
  const strokeBack = size * 0.048;

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2;  // 8-bit RGB

  const rows = [];

  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 3);
    row[0] = 0;

    for (let x = 0; x < size; x++) {
      const rrA = roundedRectAlpha(x, y, size, CORNER);

      if (rrA < 0.01) {
        // Outside icon shape: transparent (black for RGB PNG, masked by OS)
        row[1 + x * 3] = 0;
        row[2 + x * 3] = 0;
        row[3 + x * 3] = 0;
        continue;
      }

      // Background gradient top → bottom
      const t = y / (size - 1);
      let R = bgTop[0] + (bgBottom[0] - bgTop[0]) * t;
      let G = bgTop[1] + (bgBottom[1] - bgTop[1]) * t;
      let B = bgTop[2] + (bgBottom[2] - bgTop[2]) * t;

      const nx = x / size;  // 0..1

      // Back wave: upper, offset phase, dimmer
      const backY = size * 0.38 + Math.sin(nx * Math.PI * 2 - Math.PI * 0.1) * size * 0.10;
      const backDist = Math.abs(y - backY);
      const backAlpha = Math.max(0, 1 - backDist / (strokeBack * 0.5)) * 0.45;

      if (backAlpha > 0.005) {
        R = R * (1 - backAlpha) + waveBack[0] * backAlpha;
        G = G * (1 - backAlpha) + waveBack[1] * backAlpha;
        B = B * (1 - backAlpha) + waveBack[2] * backAlpha;
      }

      // Main wave: lower, full opacity
      const mainY = size * 0.60 + Math.sin(nx * Math.PI * 2 - Math.PI * 0.5) * size * 0.13;
      const mainDist = Math.abs(y - mainY);
      // Soft edge via smoothstep: full opacity within half stroke, fade out over 2px
      const mainAlpha = mainDist < strokeMain / 2
        ? 1.0
        : Math.max(0, 1 - (mainDist - strokeMain / 2) / 2.5);

      if (mainAlpha > 0.005) {
        R = R * (1 - mainAlpha) + waveMain[0] * mainAlpha;
        G = G * (1 - mainAlpha) + waveMain[1] * mainAlpha;
        B = B * (1 - mainAlpha) + waveMain[2] * mainAlpha;
      }

      // Apply rounded-rect edge antialiasing
      row[1 + x * 3] = Math.round(Math.min(255, Math.max(0, R * rrA)));
      row[2 + x * 3] = Math.round(Math.min(255, Math.max(0, G * rrA)));
      row[3 + x * 3] = Math.round(Math.min(255, Math.max(0, B * rrA)));
    }

    rows.push(row);
  }

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const compressed = deflateSync(Buffer.concat(rows));
  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', compressed), pngChunk('IEND', Buffer.alloc(0))]);
}

mkdirSync('public/icons', { recursive: true });
writeFileSync('public/icons/icon-192.png', createIcon(192));
writeFileSync('public/icons/icon-512.png', createIcon(512));
writeFileSync('public/icons/apple-touch-icon.png', createIcon(180));
console.log('Icons generated: 192px, 512px, 180px');
