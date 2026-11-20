// The iPhone app's icon and launch picture, from the kit's seal: the icon is the seal in chalk on
// night, flat and without transparency (the App Store refuses an icon with an alpha channel).
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { NIGHT } from '../public/lib/lever.js';

const seal = readFileSync(resolve('public/brand/seal-chalk.svg'));
const out = resolve('ios/III/Assets.xcassets');

const mark = await sharp(seal, { density: 400 })
  .resize(640, 640, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toBuffer();
await sharp({ create: { width: 1024, height: 1024, channels: 3, background: NIGHT } })
  .composite([{ input: mark, gravity: 'centre' }])
  .removeAlpha()
  .png()
  .toFile(join(out, 'AppIcon.appiconset/icon-1024.png'));

await sharp(seal, { density: 400 })
  .resize(480, 480, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toFile(join(out, 'LaunchSeal.imageset/launch-seal.png'));
console.log('ios icon and launch picture written');
