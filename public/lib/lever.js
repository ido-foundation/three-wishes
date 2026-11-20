// The lever: a dial with a lever arm. Pure functions, no DOM, so the phone and the server
// (share picture) draw the same thing. Angles are degrees, 0 = up, clockwise, sweep -135..135.
//
// Brand (kit v8): chalk lines on night, thin strokes, no gradients, glows or shadows, and one
// small gold four-point star: the tip of the arm. Nothing else on the dial is gold.

export const CX = 200;
export const CY = 200;
export const START = -135;
export const END = 135;
export const SWEEP = END - START;
export const CHALK = '#F2E9E4';
export const NIGHT = '#02031A';
export const GOLD = '#C9A865';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX'];

const r1 = (x) => Math.round(x * 10) / 10;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

export const fracToDeg = (f) => START + SWEEP * clamp(f, 0, 1);
export function polar(r, deg) {
  const a = (deg * Math.PI) / 180;
  return [r1(CX + r * Math.sin(a)), r1(CY - r * Math.cos(a))];
}
export function arcPath(r, a0, a1) {
  const [x0, y0] = polar(r, a0);
  const [x1, y1] = polar(r, a1);
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
  return `M${x0} ${y0}A${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
}

export function fmtDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '');
  if (!m) return '';
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

/** 1234567 → "1.23M"; keeps three significant figures, adds the unit sensibly. */
export function fmtNumber(x, unit = null, { compact = false, bare = false } = {}) {
  if (!Number.isFinite(x)) return '';
  const a = Math.abs(x);
  let body;
  if (compact && a >= 1e9) body = `${trim(x / 1e9)}B`;
  else if (compact && a >= 1e6) body = `${trim(x / 1e6)}M`;
  else if (compact && a >= 1e4) body = `${trim(x / 1e3)}K`;
  else if (a >= 1000) body = Math.round(x).toLocaleString('en-US');
  else if (a >= 100) body = String(Math.round(x * 10) / 10);
  else if (a >= 1) body = String(Math.round(x * 100) / 100);
  else body = String(Math.round(x * 1000) / 1000);
  const u = (unit ?? '').trim();
  if (u === '%' || /^percent/i.test(u)) return `${body}%`;
  if (u === 'USD' || u === '$') return x < 0 ? `-$${body.replace('-', '')}` : `$${body}`;
  if (!u || bare) return body;
  return `${body} ${u}`;
}
const trim = (x) => String(Math.round(x * 100) / 100);

/** The unit as a word to set small beside the figure ("seats"); '' when it is a symbol like $ or %. */
export function unitWord(unit) {
  const u = (unit ?? '').trim();
  return !u || u === '%' || /^percent/i.test(u) || u === 'USD' || u === '$' ? '' : u;
}

/**
 * A scale of four equal steps whose ends and labels are round numbers (400, 500, 600, 700, 800),
 * wide enough to hold [min, max]. nonneg keeps it from starting below zero.
 */
export function niceScale(min, max, { nonneg = false } = {}) {
  const span = Math.max(max - min, 1e-9);
  const base = 10 ** Math.floor(Math.log10(span / 4));
  const steps = [1, 2, 2.5, 5, 10, 20, 25, 50, 100].map((m) => m * base);
  const tidy = (x) => Math.round(x * 1e9) / 1e9;
  for (const step of steps) {
    let lo = Math.floor(tidy(min / step)) * step;
    if (nonneg && lo < 0) lo = 0;
    const hi = lo + step * 4;
    if (hi >= max - 1e-9) return { min: tidy(lo), max: tidy(hi), step: tidy(step) };
  }
  return { min, max, step: span / 4 };
}

export function percent(p) {
  const v = p * 100;
  if (v > 0 && v < 1) return '<1%';
  if (v > 99 && v < 100) return '>99%';
  return `${Math.round(v)}%`;
}

/**
 * Everything needed to draw and to read out one answer.
 * question: { title, kind, close_date, options?, unit? }   answer: from server/sanitize.mjs
 */
export function leverModel(question, answer) {
  const by = fmtDate(question?.close_date);
  const kind = answer.kind;

  if (kind === 'binary') {
    const p = answer.p;
    return {
      kind,
      f: p,
      angle: fracToDeg(p),
      figure: percent(p),
      sub: 'chance of yes',
      caption: by ? `Resolves on ${by}` : '',
      scale: [0, 0.25, 0.5, 0.75, 1].map((f) => ({ f, text: String(Math.round(f * 100)) })),
      aria: `${percent(p)} chance of yes${by ? `, by ${by}` : ''}.`,
    };
  }

  if (kind === 'categorical') {
    const order = (question?.options?.length ? question.options : answer.options.map((o) => o.label)).filter((l) =>
      answer.options.some((o) => o.label === l),
    );
    for (const o of answer.options) if (!order.includes(o.label)) order.push(o.label);
    const byLabel = new Map(answer.options.map((o) => [o.label, o.p]));
    const gap = 2.6;
    const usable = SWEEP - gap * (order.length - 1);
    const min = 1.6;
    let widths = order.map((l) => Math.max(min, usable * byLabel.get(l)));
    const scale = usable / widths.reduce((a, b) => a + b, 0);
    widths = widths.map((w) => w * scale);
    let at = START;
    const arcs = order.map((label, i) => {
      const a0 = at;
      const a1 = at + widths[i];
      at = a1 + gap;
      return { label, p: byLabel.get(label), a0, a1, mid: (a0 + a1) / 2, numeral: ROMAN[i] ?? String(i + 1), leading: label === answer.leading };
    });
    const lead = arcs.find((a) => a.leading) ?? arcs[0];
    return {
      kind,
      angle: lead.mid,
      arcs,
      figure: percent(lead.p),
      sub: lead.label,
      caption: by ? `Most likely · resolves on ${by}` : 'Most likely',
      rows: [...answer.options],
      aria: `Most likely: ${lead.label}, ${percent(lead.p)}${by ? `, by ${by}` : ''}.`,
    };
  }

  // numerical
  const { median, low, high, unit } = answer;
  const hasRange = Number.isFinite(low) && Number.isFinite(high) && high > low;
  const span = hasRange ? high - low : Math.max(Math.abs(median) * 0.2, 1);
  const lo = (hasRange ? low : median - span) - span * 0.75;
  const hi = (hasRange ? high : median + span) + span * 0.75;
  const nonneg = median >= 0 && (hasRange ? low : median) >= 0;
  const sc = niceScale(lo, hi, { nonneg });
  const f = (x) => clamp((x - sc.min) / (sc.max - sc.min), 0, 1);
  const bare = (x) => fmtNumber(x, unit, { compact: true, bare: true });
  const word = unitWord(unit);
  return {
    kind,
    f: f(median),
    angle: fracToDeg(f(median)),
    range: hasRange ? { a0: fracToDeg(f(low)), a1: fracToDeg(f(high)), low, high } : null,
    figure: bare(median),
    unit: word,
    sub: hasRange ? `80% likely between ${bare(low)} and ${bare(high)}${word ? ` ${word}` : ''}` : 'median',
    caption: by ? `Most likely value · resolves on ${by}` : 'Most likely value',
    scale: [0, 1, 2, 3, 4].map((i) => ({ f: i / 4, text: bare(sc.min + sc.step * i) })),
    aria: `Median ${fmtNumber(median, unit, { compact: true })}${hasRange ? `, 80% likely between ${fmtNumber(low, unit, { compact: true })} and ${fmtNumber(high, unit, { compact: true })}` : ''}${by ? `, by ${by}` : ''}.`,
  };
}

/** The four-point star: concave sides, flat fill, no outline. */
export function starPath(R, cx = 0, cy = 0) {
  const k = R * 0.12;
  const p = (x, y) => `${r1(cx + x)} ${r1(cy + y)}`;
  return `M${p(0, -R)}Q${p(k, -k)} ${p(R, 0)}Q${p(k, k)} ${p(0, R)}Q${p(-k, k)} ${p(-R, 0)}Q${p(-k, -k)} ${p(0, -R)}Z`;
}

const ARM_TIP = 86; // y of the star's centre when the arm points up
const STAR_R = 15;

/** The fixed face of the dial: rings, ticks, scale labels, arcs, hub. Returns SVG markup. */
export function dialFace(model, { rings = lockedRings(model), id = "dial" } = {}) {
  const parts = [];
  parts.push(`<circle cx="${CX}" cy="${CY}" r="160" fill="none" stroke="${CHALK}" stroke-width="1.25"/>`);
  parts.push(`<circle cx="${CX}" cy="${CY}" r="122" fill="none" stroke="${CHALK}" stroke-width="0.75" opacity="0.5"/>`);
  parts.push(`<path d="M${CX} ${CY - 122}V${CY + 122}M${CX - 122} ${CY}H${CX + 122}" stroke="${CHALK}" stroke-width="0.5" opacity="0.22" fill="none"/>`);

  if (model.kind !== 'categorical') {
    let d = '';
    for (let i = 0; i <= 100; i++) {
      const deg = fracToDeg(i / 100);
      const len = i % 10 === 0 ? 16 : i % 5 === 0 ? 11 : 6;
      const [x0, y0] = polar(160, deg);
      const [x1, y1] = polar(160 - len, deg);
      d += `M${x0} ${y0}L${x1} ${y1}`;
    }
    parts.push(`<path d="${d}" stroke="${CHALK}" stroke-width="0.8" fill="none" opacity="0.85"/>`);
    for (const { f, text } of model.scale) {
      const [x, y] = polar(180, fracToDeg(f));
      parts.push(label(x, y + 4, text));
    }
  }

  if (model.kind === 'numerical' && model.range) {
    parts.push(`<path d="${arcPath(141, model.range.a0, model.range.a1)}" stroke="${CHALK}" stroke-width="7" fill="none" opacity="0.4"/>`);
  }

  if (model.kind === 'categorical') {
    for (const a of model.arcs) {
      parts.push(
        `<path d="${arcPath(141, a.a0, a.a1)}" stroke="${CHALK}" stroke-width="14" fill="none" opacity="${a.leading ? 1 : 0.32}"/>`,
      );
      const [x, y] = polar(180, a.mid);
      parts.push(label(x, y + 4, a.numeral));
    }
  }

  parts.push(ringsMarkup(rings, { id }));
  parts.push(`<path id="${id}-charge" d="" fill="none" stroke="${CHALK}" stroke-width="2" stroke-linecap="round"/>`);
  parts.push(`<circle cx="${CX}" cy="${CY}" r="12" fill="none" stroke="${CHALK}" stroke-width="1"/>`);
  parts.push(`<circle cx="${CX}" cy="${CY}" r="4.5" fill="${CHALK}"/>`);
  return parts.join('');
}

const ROMAN12 = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

/** Where the three rings sit when the dial has locked on the answer: each one's mark on the arm. */
export const lockedRings = (model) => ({ B: model.angle, C: model.angle, D: model.angle });
/** Where they sit before: scrambled, so that turning the dial has something to resolve. */
export const restRings = (model) => ({ B: model.angle + 57, C: model.angle - 101, D: model.angle + 163 });

/**
 * Three rings inside the scale, in the style of the kit's dial studies: numerals, graduations, an
 * orbit with satellites. Each carries one index mark at its top; when the rings lock, the three
 * marks line up with the arm. The bottom sector (124 degrees) is left clear, where the figure is written.
 */
export function ringsMarkup(rot, { id = 'dial' } = {}) {
  const line = (r, w, o) => `<circle cx="${CX}" cy="${CY}" r="${r}" fill="none" stroke="${CHALK}" stroke-width="${w}" opacity="${o}"/>`;

  let numerals = '';
  for (let i = 0; i < 12; i++) {
    const a = i * 30;
    numerals += `<text transform="rotate(${a} ${CX} ${CY})" x="${CX}" y="${CY - 104 + 3}" text-anchor="middle" font-family="Hanken Grotesk, sans-serif" font-weight="500" font-size="8" letter-spacing="0.5" fill="${CHALK}" opacity="0.8">${ROMAN12[i]}</text>`;
  }
  const B = `${line(112, 0.6, 0.5)}${line(96, 0.6, 0.5)}${numerals}<path d="M${CX} ${CY - 92}l-4 -7h8z" fill="${CHALK}"/>`;

  let grad = '';
  for (let i = 0; i < 60; i++) {
    const [x0, y0] = polar(88, i * 6);
    const [x1, y1] = polar(88 - (i % 5 === 0 ? 12 : 6), i * 6);
    grad += `M${x0} ${y0}L${x1} ${y1}`;
  }
  const C = `${line(88, 0.6, 0.5)}${line(76, 0.6, 0.35)}<path d="${grad}" stroke="${CHALK}" stroke-width="0.7" fill="none" opacity="0.8"/><path d="M${CX} ${CY - 88}V${CY - 68}" stroke="${CHALK}" stroke-width="1.8"/>`;

  let sats = '';
  for (const a of [120, 240]) {
    const [x, y] = polar(66, a);
    sats += `<circle cx="${x}" cy="${y}" r="3" fill="${CHALK}"/><circle cx="${x}" cy="${y}" r="7" fill="none" stroke="${CHALK}" stroke-width="0.6" opacity="0.6"/>`;
  }
  const D = `${line(66, 0.7, 0.55)}${line(50, 0.5, 0.3)}${sats}<circle cx="${CX}" cy="${CY - 66}" r="4.2" fill="${CHALK}"/><circle cx="${CX}" cy="${CY - 66}" r="8" fill="none" stroke="${CHALK}" stroke-width="0.8"/>`;

  const g = (k, body) => `<g id="${id}-${k}" class="ring ring${k}" transform="rotate(${r1(rot[k])} ${CX} ${CY})">${body}</g>`;
  return (
    `<clipPath id="${id}-clip"><path d="M0 0H400V306L${CX} ${CY}L0 306Z"/></clipPath>` +
    `<g clip-path="url(#${id}-clip)">${g('B', B)}${g('C', C)}${g('D', D)}</g>`
  );
}

const label = (x, y, text) =>
  `<text x="${x}" y="${y}" text-anchor="middle" font-family="Hanken Grotesk, sans-serif" font-weight="500" font-size="11" letter-spacing="1.3" fill="${CHALK}" opacity="0.85">${esc(text)}</text>`;

/** The arm: a shaft, a small counterweight and the gold star, drawn pointing up and then rotated. */
export function arm(angle, { id = 'arm' } = {}) {
  return (
    `<g id="${id}" class="arm" transform="rotate(${r1(angle)} ${CX} ${CY})">` +
    `<path d="M${CX} ${CY + 30}V${ARM_TIP + STAR_R}" stroke="${CHALK}" stroke-width="2" fill="none" stroke-linecap="round"/>` +
    `<circle cx="${CX}" cy="${CY + 34}" r="4" fill="none" stroke="${CHALK}" stroke-width="1.25"/>` +
    `<path d="${starPath(STAR_R, CX, ARM_TIP)}" fill="${GOLD}"/>` +
    `<circle class="handle" cx="${CX}" cy="${ARM_TIP + 6}" r="30" fill="transparent"/>` +
    `</g>`
  );
}

/** A complete dial as an <svg> string. `angle` defaults to the answer's; pass START for the resting lever. */
export function dialSvg(model, { angle = model.angle, rings = lockedRings(model), size = null, id = 'dial', armId = 'arm', title = '' } = {}) {
  const dim = size ? ` width="${size}" height="${size}"` : '';
  const t = title ? `<title>${esc(title)}</title>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"${dim} role="img" aria-label="${esc(model.aria)}">${t}${dialFace(model, { rings, id })}${arm(angle, { id: armId })}</svg>`;
}

/** The dial's parts without the outer <svg>, to place inside a larger drawing (locked on the answer). */
export const dialInner = (model, angle = model.angle) => dialFace(model, { rings: lockedRings(model), id: 'card' }) + arm(angle);

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** A damped spring from 0 to 1 (t in seconds); used for the pull. Small, bounded overshoot. */
export function spring(t, { stiffness = 90, damping = 13 } = {}) {
  const w = Math.sqrt(stiffness);
  const z = damping / (2 * w);
  if (z >= 1) {
    return 1 - (1 + w * t) * Math.exp(-w * t);
  }
  const wd = w * Math.sqrt(1 - z * z);
  return 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + ((z * w) / wd) * Math.sin(wd * t));
}

/** Wraps text into lines of at most `max` characters, breaking at spaces; at most `lines` lines. */
export function wrap(text, max, lines = 5) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const out = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > max && cur) {
      out.push(cur);
      cur = w;
    } else cur = (cur + ' ' + w).trim();
  }
  if (cur) out.push(cur);
  if (out.length > lines) {
    const kept = out.slice(0, lines);
    kept[lines - 1] = kept[lines - 1].replace(/[\s.,;:!?]*$/, '') + '…';
    return kept;
  }
  return out;
}
