import { ringsMarkup, arm, polar, fracToDeg } from './lib/lever.js';

/** Tiny element builder. Children may be nodes or strings (always set as text, never as HTML). */
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

const SVG = 'http://www.w3.org/2000/svg';
export function svg(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const kid of kids) el.append(kid);
  return el;
}

export function dotIcon({ spent = false, spending = false } = {}) {
  const d = svg('svg', { viewBox: '-14 -14 28 28', class: `dot${spent ? ' spent' : ''}${spending ? ' spending' : ''}`, 'aria-hidden': 'true' });
  d.append(svg('circle', { r: 11, class: 'ring' }), svg('circle', { r: 6.5, class: 'core' }));
  return d;
}

/** Three markers: the questions. `left` are lit; the rest are rings only. `spending` makes the next one breathe. */
export function dotsRow(left, total = 3, { spending = false } = {}) {
  if (left === null) return null;
  const row = h('div', { class: 'dots', role: 'img', 'aria-label': `${left} of ${total} questions left` });
  for (let i = 0; i < total; i++) {
    const lit = i < left;
    row.append(dotIcon({ spent: !lit, spending: spending && i === left - 1 }));
  }
  return row;
}

export const logo = (cls, src, alt = 'Foundation') => h('img', { class: cls, src, alt, decoding: 'async' });
export const lockup = () => logo('lockup', '/brand/lockup-stacked-chalk.svg');
export const seal = () => logo('seal', '/brand/seal-chalk.svg');
export const wordmark = () => logo('footer-mark', '/brand/wordmark-chalk.svg');

export function backButton(onclick) {
  const b = h('button', { class: 'back', type: 'button', 'aria-label': 'Back', onclick });
  b.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';
  return b;
}

// The names for the three kinds of question.
export const KIND_LABEL = { binary: 'Yes / No', categorical: 'One of several', numerical: 'A number' };

/** The three questions as markers on an orbit round the seal. Lit ones are questions left. */
export function wishOrbit(left, total = 3) {
  const s = svg('svg', { viewBox: '0 0 200 200', class: 'orbit', role: 'img', 'aria-label': left === null ? 'Foundation' : `${left} of ${total} questions left` });
  const at = (r, deg) => [100 + r * Math.sin((deg * Math.PI) / 180), 100 - r * Math.cos((deg * Math.PI) / 180)];
  let ticks = '';
  for (let i = 0; i < 72; i++) {
    const [x0, y0] = at(90, i * 5);
    const [x1, y1] = at(i % 6 === 0 ? 83 : 86, i * 5);
    ticks += `M${x0.toFixed(1)} ${y0.toFixed(1)}L${x1.toFixed(1)} ${y1.toFixed(1)}`;
  }
  s.innerHTML =
    `<circle cx="100" cy="100" r="90" fill="none" stroke="#F2E9E4" stroke-width="0.9"/>` +
    `<circle cx="100" cy="100" r="74" fill="none" stroke="#F2E9E4" stroke-width="0.5" opacity="0.35"/>` +
    `<path d="${ticks}" stroke="#F2E9E4" stroke-width="0.6" fill="none" opacity="0.7"/>`;
  const spin = svg('g', { class: 'orbit-spin' });
  for (let i = 0; i < total; i++) {
    const [x, y] = at(74, i * (360 / total));
    const g = svg('g', { class: i < left ? 'on' : 'off' });
    g.append(svg('circle', { cx: x.toFixed(1), cy: y.toFixed(1), r: 8.5, class: 'ring' }), svg('circle', { cx: x.toFixed(1), cy: y.toFixed(1), r: 4.8, class: 'core' }));
    spin.append(g);
  }
  s.append(spin);
  s.append(svg('image', { href: '/brand/seal-chalk.svg', x: 70, y: 70, width: 60, height: 58 }));
  return s;
}

/**
 * The instrument thinking: the three rings turning, the gold star searching round the dial, and
 * rings of light going out from the middle like a sounding. No words, nothing about how.
 */
export function thinkingDial(small = false) {
  const s = svg('svg', { viewBox: '0 0 400 400', class: `think-dial${small ? ' small' : ''}`, 'aria-hidden': 'true' });
  let ticks = '';
  for (let i = 0; i <= 100; i++) {
    const deg = fracToDeg(i / 100);
    const [x0, y0] = polar(160, deg);
    const [x1, y1] = polar(160 - (i % 10 === 0 ? 16 : i % 5 === 0 ? 11 : 6), deg);
    ticks += `M${x0} ${y0}L${x1} ${y1}`;
  }
  s.innerHTML =
    `<circle cx="200" cy="200" r="160" fill="none" stroke="#F2E9E4" stroke-width="1.25"/>` +
    `<path d="${ticks}" stroke="#F2E9E4" stroke-width="0.8" fill="none" opacity="0.85"/>` +
    `<circle cx="200" cy="200" r="122" fill="none" stroke="#F2E9E4" stroke-width="0.75" opacity="0.5"/>` +
    ringsMarkup({ B: 0, C: 0, D: 0 }, { id: 'think' }) +
    `<circle class="ping p0" cx="200" cy="200" r="14"/><circle class="ping p1" cx="200" cy="200" r="14"/><circle class="ping p2" cx="200" cy="200" r="14"/>` +
    arm(0, { id: 'think-arm' }) +
    `<circle cx="200" cy="200" r="12" fill="none" stroke="#F2E9E4" stroke-width="1"/><circle cx="200" cy="200" r="4.5" fill="#F2E9E4"/>`;
  return s;
}

/** A vast, faint instrument behind the page: rings and graduations, turning once in twelve minutes. */
export function watermark() {
  const s = svg('svg', { class: 'watermark', viewBox: '0 0 400 400', 'aria-hidden': 'true' });
  let ticks = '';
  for (let i = 0; i < 120; i++) {
    const a = (i * 3 * Math.PI) / 180;
    const len = i % 10 === 0 ? 14 : i % 5 === 0 ? 9 : 5;
    ticks += `M${(200 + 196 * Math.sin(a)).toFixed(1)} ${(200 - 196 * Math.cos(a)).toFixed(1)}L${(200 + (196 - len) * Math.sin(a)).toFixed(1)} ${(200 - (196 - len) * Math.cos(a)).toFixed(1)}`;
  }
  const ring = (r, o) => `<circle cx="200" cy="200" r="${r}" fill="none" stroke="#F2E9E4" stroke-width="1" opacity="${o}"/>`;
  s.innerHTML =
    ring(196, 1) + ring(172, 0.7) + ring(140, 0.5) + ring(104, 0.5) + ring(64, 0.4) +
    `<path d="${ticks}" stroke="#F2E9E4" stroke-width="1" fill="none"/>` +
    `<path d="M200 4V396M4 200H396" stroke="#F2E9E4" stroke-width="1" fill="none" opacity="0.5"/>`;
  return s;
}
