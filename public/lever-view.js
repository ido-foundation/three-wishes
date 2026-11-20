// The lever on screen. The dial starts scrambled; the person turns it (drag a finger round it, tap
// it, or press Reveal). Three rings spin and lock one after another, each ring's mark lining up
// with the arm; the gold star swings in and settles on the answer; the figure is written.
import { START, CX, CY, arcPath, dialSvg, leverModel, lockedRings, percent, restRings, spring } from './lib/lever.js';
import { h } from './ui.js';

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const NS = 'http://www.w3.org/2000/svg';
const REST = 'A dial, scrambled. Turn it, or press Reveal, to see your answer.';

const CHARGE = 300; // degrees of finger travel round the dial that make it let go
const RING_DIR = { B: 1, C: -1, D: 1 }; // the rings turn against each other
const RING_TURNS = { B: 2, C: 2, D: 3 }; // whole extra turns in the finale
const RING_SECS = { B: 1.5, C: 2.0, D: 2.5 }; // when each one locks
const ARM_DELAY = 0.45;
const END_SECS = 2.7;

const easeOut = (x) => 1 - (1 - clamp(x, 0, 1)) ** 3;
const wrap360 = (d) => ((d % 360) + 360) % 360;
const wrap180 = (d) => ((d + 540) % 360) - 180;

export function mountLever({ question, answer, revealed = false, onReveal = () => {} }) {
  const model = leverModel(question, answer);
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const locked = lockedRings(model);
  const rest = restRings(model);
  let done = revealed;
  let busy = false;

  const box = h('div', { class: `dialbox${revealed ? '' : ' waiting'}` });
  box.innerHTML = dialSvg(model, { angle: revealed ? model.angle : START, rings: revealed ? locked : rest });
  const svg = box.querySelector('svg');
  const arm = svg.querySelector('#arm');
  const ringEl = { B: svg.querySelector('#dial-B'), C: svg.querySelector('#dial-C'), D: svg.querySelector('#dial-D') };
  const chargeEl = svg.querySelector('#dial-charge');
  svg.setAttribute('aria-label', revealed ? model.aria : REST);

  const figure = h('div', { class: `figure${revealed ? '' : ' hidden'}` });
  const setFigure = (text) => {
    figure.replaceChildren(text, model.unit ? h('span', { class: 'unit' }, model.unit) : '');
    figure.dataset.size = text.length > 9 ? 'xs' : text.length > 6 ? 's' : 'm';
  };
  setFigure(model.figure);
  box.append(figure);

  const reading = h(
    'div',
    { class: `reading${revealed ? '' : ' hidden'}` },
    h('p', { class: 'sub' }, model.sub),
    h('p', { class: 'label' }, model.caption),
  );
  const hint = h('p', { class: `label pulse hint${revealed ? ' hidden' : ''}` }, 'Turn the dial');
  // One slot holds both, one over the other, so nothing jumps when the answer appears.
  const slot = h('div', { class: 'slot' }, hint, reading);

  let rank = null;
  if (model.kind === 'categorical') {
    const numeral = new Map(model.arcs.map((a) => [a.label, a.numeral]));
    rank = h(
      'ol',
      { class: `rank${revealed ? '' : ' hidden'}`, 'aria-label': 'Every option, most likely first' },
      model.rows.map((o) =>
        h(
          'li',
          { class: o.label === answer.leading ? 'lead' : '' },
          h('span', { class: 'n' }, numeral.get(o.label)),
          h('span', { class: 'name' }, o.label),
          h('span', { class: 'p' }, percent(o.p)),
        ),
      ),
    );
  }

  // Current state of the moving parts.
  const rings = revealed ? { ...locked } : { ...rest };
  let armAngle = revealed ? model.angle : START;
  const paint = () => {
    for (const k of ['B', 'C', 'D']) ringEl[k].setAttribute('transform', `rotate(${rings[k].toFixed(2)} ${CX} ${CY})`);
    arm.setAttribute('transform', `rotate(${armAngle.toFixed(2)} ${CX} ${CY})`);
  };
  const setCharge = (c) => chargeEl.setAttribute('d', c > 0.004 ? arcPath(167, START, START + clamp(c, 0, 1) * 270) : '');

  function ripple(r) {
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('cx', CX);
    c.setAttribute('cy', CY);
    c.setAttribute('r', r);
    c.setAttribute('class', 'ripple');
    svg.append(c);
    setTimeout(() => c.remove(), 900);
  }

  function finish() {
    done = true;
    busy = false;
    Object.assign(rings, locked);
    armAngle = model.angle;
    paint();
    setCharge(0);
    setFigure(model.figure);
    figure.classList.remove('hidden');
    reading.classList.remove('hidden');
    hint.classList.add('hidden');
    rank?.classList.remove('hidden');
    box.classList.remove('waiting');
    svg.setAttribute('aria-label', model.aria);
    onReveal();
  }

  /** From wherever the rings and the arm are now: spin, lock one by one, swing the star in. */
  function finale() {
    if (done || busy) return;
    busy = true;
    if (reduce) return finish();
    setCharge(0);
    const from = { ...rings };
    const armFrom = armAngle;
    const travel = {};
    for (const k of ['B', 'C', 'D']) {
      const need = wrap360((locked[k] - from[k]) * RING_DIR[k]); // forward to the lock, in its direction
      travel[k] = RING_TURNS[k] * 360 + need;
    }
    const lockedAt = { B: false, C: false, D: false };
    const t0 = performance.now();
    let figureShown = false;
    const step = (now) => {
      const t = (now - t0) / 1000;
      for (const k of ['B', 'C', 'D']) {
        rings[k] = from[k] + RING_DIR[k] * travel[k] * easeOut(t / RING_SECS[k]);
        if (!lockedAt[k] && t >= RING_SECS[k]) {
          lockedAt[k] = true;
          ripple({ B: 112, C: 88, D: 66 }[k]);
          if (k === 'D') {
            box.classList.add('thunk');
            setTimeout(() => box.classList.remove('thunk'), 220);
          }
        }
      }
      const s = spring(Math.max(0, t - ARM_DELAY));
      armAngle = armFrom + (model.angle - armFrom) * s;
      if (t >= ARM_DELAY && !figureShown) {
        figureShown = true;
        figure.classList.remove('hidden');
      }
      if (figureShown && model.kind === 'binary') setFigure(percent(model.f * clamp(s, 0, 1)));
      paint();
      if (t < END_SECS) requestAnimationFrame(step);
      else finish();
    };
    requestAnimationFrame(step);
  }

  // Turning the dial: a finger going round it turns the rings (against each other) and charges the
  // outer scale; a full charge lets go. A tap lets go at once. Let go early and it falls back.
  let drag = null;
  const angleAt = (e) => {
    const r = svg.getBoundingClientRect();
    return (Math.atan2(e.clientX - (r.left + r.width / 2), -(e.clientY - (r.top + r.height / 2))) * 180) / Math.PI;
  };
  svg.addEventListener('pointerdown', (e) => {
    if (done || busy) return;
    drag = { last: angleAt(e), total: 0, at: performance.now(), base: { ...rings } };
    svg.setPointerCapture(e.pointerId);
  });
  svg.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const a = angleAt(e);
    const d = wrap180(a - drag.last);
    drag.last = a;
    drag.total += Math.abs(d);
    rings.B += d * 1;
    rings.C -= d * 0.7;
    rings.D += d * 1.4;
    const c = clamp(drag.total / CHARGE, 0, 1);
    armAngle = START + c * 30; // the arm leans as it charges
    setCharge(c);
    paint();
    if (c >= 1) {
      drag = null;
      finale();
    }
  });
  const release = () => {
    if (!drag) return;
    const { total, at, base } = drag;
    drag = null;
    if (busy || done) return;
    if (total < 14 && performance.now() - at < 400) return finale(); // a tap
    // let go early: everything eases back to where it was
    const from = { ...rings, arm: armAngle };
    const t0 = performance.now();
    const back = (now) => {
      const x = easeOut((now - t0) / 450);
      for (const k of ['B', 'C', 'D']) rings[k] = from[k] + (base[k] - from[k]) * x;
      armAngle = from.arm + (START - from.arm) * x;
      setCharge((1 - x) * clamp(total / CHARGE, 0, 1));
      paint();
      if (x < 1 && !busy && !done) requestAnimationFrame(back);
    };
    requestAnimationFrame(back);
  };
  svg.addEventListener('pointerup', release);
  svg.addEventListener('pointercancel', release);

  return { box, slot, rank, pull: finale, get revealed() { return done; }, model };
}
