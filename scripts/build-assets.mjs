// Prepares the kit's files for the app: strips the SVGs' embedded provenance blobs and renders the
// Home Screen icons (the seal in chalk on night).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { NIGHT } from '../public/lib/lever.js';

const pub = resolve('public');
const brand = join(pub, 'brand');

for (const f of ['seal-chalk', 'seal-gold', 'wordmark-chalk', 'lockup-stacked-chalk']) {
  const p = join(brand, `${f}.svg`);
  let s = readFileSync(p, 'utf8');
  s = s.replace(/<metadata>[\s\S]*?<\/metadata>/g, '').replace(/\sxmlns:c2pa="[^"]*"/g, '');
  writeFileSync(p, s);
  console.log('cleaned', f, `${(s.length / 1024).toFixed(1)} KB`);
}

mkdirSync(join(pub, 'icons'), { recursive: true });
const seal = readFileSync(join(brand, 'seal-chalk.svg'));
async function icon(name, size, { pad }) {
  const inner = Math.round(size * (1 - pad * 2));
  const logo = await sharp(seal, { density: 300 }).resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: NIGHT } })
    .composite([{ input: logo, gravity: 'centre' }])
    .png()
    .toFile(join(pub, 'icons', name));
  console.log('icon', name);
}
await icon('apple-touch-icon.png', 180, { pad: 0.18 });
await icon('icon-192.png', 192, { pad: 0.18 });
await icon('icon-512.png', 512, { pad: 0.18 });
await icon('icon-maskable-512.png', 512, { pad: 0.28 }); // safe zone for round and squircle masks
await icon('favicon-32.png', 32, { pad: 0.08 });
