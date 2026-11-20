// Rule R6: the kit's rules, checked so a later edit cannot quietly break them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Comments may name the rules ("no glows"); only code is checked.
const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const css = code(readFileSync('public/styles.css', 'utf8'));
const js = ['public/app.js', 'public/ui.js', 'public/lever-view.js', 'public/lib/lever.js'].map((f) => code(readFileSync(f, 'utf8'))).join('\n');

test('flat: no gradients, glows, blurs or shadows anywhere', () => {
  const all = css + js;
  assert.doesNotMatch(all.replace(/background: var\(--night\) url\([^)]+\)/, ''), /gradient\(/i);
  for (const word of ['box-shadow', 'text-shadow', 'drop-shadow', 'blur(', 'glow']) assert.equal(all.toLowerCase().includes(word), false, word);
});

test('the palette is night, chalk and one gold; ultramarine and black never appear on screen', () => {
  const hexes = new Set((css.match(/#[0-9a-f]{6}\b/gi) ?? []).map((h) => h.toUpperCase()));
  assert.deepEqual([...hexes].sort(), ['#06082F', '#C9A865', '#F2E9E4']);
  assert.equal(/#000FA0/i.test(css + js), false, 'ultramarine is never on night');
  assert.equal(/#03050C/i.test(css), false, 'black is for text on chalk and stone, not on night');
});

test('gold is used for the lever star and nothing else', () => {
  assert.equal([...css.matchAll(/var\(--gold\)/g)].length, 0, 'no gold in the stylesheet');
  const uses = [...js.matchAll(/GOLD/g)].length;
  assert.equal(uses, 2, 'declared once, used once, in the arm');
});

test('the type is the kit stand-in, in the kit weights, sentence case', () => {
  assert.match(css, /font-family: "Hanken Grotesk"; font-weight: 300/);
  assert.match(css, /font-family: "Hanken Grotesk"; font-weight: 400/);
  assert.match(css, /font-family: "Hanken Grotesk"; font-weight: 500/);
  for (const f of ['Light', 'Regular', 'Medium', 'SemiBold']) assert.ok(statSync(`public/brand/fonts/HankenGrotesk-${f}.ttf`).size > 50_000);
  assert.ok(statSync('public/brand/fonts/OFL.txt').size > 1000, 'the font licence ships with it');
  assert.doesNotMatch(css, /Univers/i, 'the licensed face is not referenced until it is bought');
  const labels = css.match(/\.label\s*\{[^}]*\}/s)[0];
  assert.match(labels, /text-transform: uppercase/);
  assert.match(labels, /letter-spacing/);
  assert.match(labels, /font-weight: 500/);
  const title = css.match(/\.title\s*\{[^}]*\}/s)[0];
  assert.match(title, /font-weight: 300/);
  assert.doesNotMatch(title, /uppercase|capitalize/);
});

test('only the kit logo files are used, never a typed name', () => {
  const brand = readdirSync('public/brand').filter((n) => n.endsWith('.svg')).sort();
  assert.deepEqual(brand, ['lockup-stacked-chalk.svg', 'seal-chalk.svg', 'seal-gold.svg', 'wordmark-chalk.svg']);
  assert.doesNotMatch(js, /FOUNDATION/, 'the wordmark is a drawing, not text');
  const html = readFileSync('public/index.html', 'utf8');
  assert.doesNotMatch(html, /FOUNDATION/);
  const manifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8'));
  assert.equal(manifest.theme_color, '#06082F');
  assert.equal(manifest.background_color, '#06082F');
  assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.icons.some((i) => i.purpose === 'maskable'));
});

test('no inline styles or scripts: the page can run under a strict policy', () => {
  const html = readFileSync('public/index.html', 'utf8');
  assert.doesNotMatch(html, /<script(?![^>]*src=)[^>]*>/);
  assert.doesNotMatch(html, /\sstyle=/);
  assert.doesNotMatch(js, /setAttribute\(\s*['"]style['"]|style:\s*['"]/);
  function walk(d, o = []) { for (const n of readdirSync(d)) { const p = join(d, n); statSync(p).isDirectory() ? walk(p, o) : o.push(p); } return o; }
  for (const f of walk('public').filter((p) => p.endsWith('.js'))) assert.doesNotMatch(readFileSync(f, 'utf8'), /\beval\(|new Function\(/, f);
});

test('text a person sees is set as text, never as HTML', () => {
  const app = readFileSync('public/app.js', 'utf8') + readFileSync('public/ui.js', 'utf8');
  const uses = [...app.matchAll(/innerHTML\s*=/g)].length;
  // The back arrow and the install hint: fixed markup, no user text.
  assert.ok(uses <= 2, `${uses} innerHTML uses`);
  const view = readFileSync('public/lever-view.js', 'utf8');
  assert.equal([...view.matchAll(/innerHTML\s*=/g)].length, 1, 'only the dial, whose text is escaped');
});
