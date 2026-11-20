import { starPath } from './lib/lever.js';

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

export function starIcon({ spent = false, spending = false } = {}) {
  const s = svg('svg', { viewBox: '-14 -14 28 28', class: `star${spent ? ' spent' : ''}${spending ? ' spending' : ''}`, 'aria-hidden': 'true' });
  s.append(svg('path', { d: starPath(12) }));
  return s;
}

/** Three stars: the wishes. `left` are lit; the rest are outlines. `spending` makes the next one breathe. */
export function starsRow(left, total = 3, { spending = false } = {}) {
  const row = h('div', { class: 'stars', role: 'img', 'aria-label': `${left} of ${total} wishes left` });
  for (let i = 0; i < total; i++) {
    const lit = i < left;
    row.append(starIcon({ spent: !lit, spending: spending && i === left - 1 }));
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

/** A ring of ticks, for waiting. Static markup, no user text. */
export function tickRing() {
  const s = svg('svg', { viewBox: '0 0 120 120', class: 'ring', 'aria-hidden': 'true' });
  s.append(svg('circle', { cx: 60, cy: 60, r: 56, fill: 'none', stroke: '#F2E9E4', 'stroke-width': 1.25 }));
  let d = '';
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2;
    const len = i % 6 === 0 ? 9 : 4;
    d += `M${(60 + 56 * Math.sin(a)).toFixed(1)} ${(60 - 56 * Math.cos(a)).toFixed(1)}L${(60 + (56 - len) * Math.sin(a)).toFixed(1)} ${(60 - (56 - len) * Math.cos(a)).toFixed(1)}`;
  }
  s.append(svg('path', { d, stroke: '#F2E9E4', 'stroke-width': 0.8, fill: 'none', opacity: 0.8 }));
  s.append(svg('path', { d: starPath(7, 60, 60), fill: '#F2E9E4' }));
  return s;
}

export const KIND_LABEL = { binary: 'Yes or no', categorical: 'One of several', numerical: 'A number' };
