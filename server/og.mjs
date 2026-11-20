// The share picture (4:5): the question, the lever, the answer, the seal. The same picture is the
// preview for links and what the share sheet sends. Drawn from the same code as the phone's dial.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { CHALK, NIGHT, dialInner, esc, leverModel, wrap } from '../public/lib/lever.js';

const W = 1080;
const H = 1350;

let sharpPromise;
function loadSharp(fontDir) {
  // librsvg finds fonts through fontconfig: point it at the kit's Hanken Grotesk before first use.
  sharpPromise ??= (async () => {
    const dir = join(tmpdir(), 'three-wishes-fonts');
    mkdirSync(dir, { recursive: true });
    const conf = join(dir, 'fonts.conf');
    writeFileSync(
      conf,
      `<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig><dir>${fontDir}</dir><cachedir>${join(dir, 'cache')}</cachedir></fontconfig>`,
    );
    process.env.FONTCONFIG_FILE = conf;
    return (await import('sharp')).default;
  })();
  return sharpPromise;
}

const dataUri = (file, mime) => `data:${mime};base64,${readFileSync(file).toString('base64')}`;

export function makeCards({ publicDir = resolve('public') } = {}) {
  const brand = join(publicDir, 'brand');
  const seal = dataUri(join(brand, 'seal-chalk.svg'), 'image/svg+xml');
  const wordmark = dataUri(join(brand, 'wordmark-chalk.svg'), 'image/svg+xml');
  let stars = null;
  try {
    stars = dataUri(join(brand, 'night-stars.jpg'), 'image/jpeg');
  } catch {
    /* the picture still works on flat night */
  }
  const cache = new Map();

  function svg(question, answer) {
    const model = leverModel(question, answer);
    const lines = wrap(question.title, 34, 4);
    const q = lines
      .map((l, i) => `<text x="540" y="${236 + i * 64}" text-anchor="middle" font-size="52" font-weight="300" fill="${CHALK}">${esc(l)}</text>`)
      .join('');
    const sub = wrap(model.sub, 42, 1)[0] ?? '';
    const dial = 1.6;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Hanken Grotesk, sans-serif">
<rect width="${W}" height="${H}" fill="${NIGHT}"/>
${stars ? `<image href="${stars}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"/>` : ''}
<image href="${seal}" x="508" y="72" width="64" height="62"/>
${q}
<g transform="translate(${540 - 200 * dial} ${800 - 200 * dial}) scale(${dial})">${dialInner(model)}</g>
<text x="540" y="962" text-anchor="middle" font-size="${model.figure.length > 9 ? 64 : model.figure.length > 6 ? 90 : 120}" font-weight="300" fill="${CHALK}">${esc(model.figure)}</text>
${model.unit ? `<text x="540" y="1012" text-anchor="middle" font-size="24" font-weight="500" letter-spacing="3.6" fill="${CHALK}" opacity="0.8">${esc(model.unit.toUpperCase())}</text>` : ''}
<text x="540" y="1090" text-anchor="middle" font-size="30" font-weight="400" fill="${CHALK}" opacity="0.88">${esc(sub)}</text>
<text x="540" y="1138" text-anchor="middle" font-size="22" font-weight="500" letter-spacing="3.2" fill="${CHALK}" opacity="0.8">${esc(model.caption.toUpperCase())}</text>
<image href="${wordmark}" x="410" y="1240" width="260" height="32"/>
</svg>`;
  }

  return {
    svg,
    async png(key, question, answer) {
      if (cache.has(key)) return cache.get(key);
      const sharp = await loadSharp(join(brand, 'fonts'));
      const buf = await sharp(Buffer.from(svg(question, answer)), { density: 72 }).png({ compressionLevel: 9 }).toBuffer();
      cache.set(key, buf);
      if (cache.size > 200) cache.delete(cache.keys().next().value);
      return buf;
    },
  };
}
