// The lever on screen: the dial, the pull (drag the star, tap the dial, or press the button),
// the spring, and the reading that appears as the arm settles.
import { START, END, CX, CY, dialSvg, leverModel, percent, spring } from './lib/lever.js';
import { h } from './ui.js';

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const REST = 'A lever at rest. Pull it to see your answer.';

export function mountLever({ question, answer, revealed = false, onReveal = () => {} }) {
  const model = leverModel(question, answer);
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let done = revealed;
  let busy = false;
  let moved = false;

  const box = h('div', { class: `dialbox${revealed ? '' : ' waiting'}` });
  box.innerHTML = dialSvg(model, { angle: revealed ? model.angle : START });
  const svg = box.querySelector('svg');
  const arm = svg.querySelector('#arm');
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
  const hint = h('p', { class: `label pulse hint${revealed ? ' hidden' : ''}` }, 'Pull the lever');
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

  const setAngle = (a) => arm.setAttribute('transform', `rotate(${a.toFixed(2)} ${CX} ${CY})`);

  function finish() {
    done = true;
    busy = false;
    setAngle(model.angle);
    setFigure(model.figure);
    figure.classList.remove('hidden');
    reading.classList.remove('hidden');
    hint.classList.add('hidden');
    rank?.classList.remove('hidden');
    box.classList.remove('waiting');
    svg.setAttribute('aria-label', model.aria);
    onReveal();
  }

  function swing(from) {
    if (done || busy) return;
    busy = true;
    if (reduce) return finish();
    figure.classList.remove('hidden');
    const to = model.angle;
    const t0 = performance.now();
    const step = (now) => {
      const t = (now - t0) / 1000;
      const s = spring(t);
      setAngle(from + (to - from) * s);
      if (model.kind === 'binary') {
        setFigure(percent(model.f * clamp(s, 0, 1)));
      }
      if (t < 1.9) requestAnimationFrame(step);
      else finish();
    };
    requestAnimationFrame(step);
  }

  function pull() {
    swing(START);
  }

  // Dragging the star: the arm follows the finger; past a quarter of the sweep it takes over.
  let dragging = false;
  const angleAt = (e) => {
    const r = svg.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    const deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
    return clamp(deg, START, END);
  };
  svg.addEventListener('pointerdown', (e) => {
    if (done || busy || !e.target.closest('.handle')) return;
    dragging = true;
    moved = false;
    svg.setPointerCapture(e.pointerId);
  });
  svg.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    moved = true;
    const a = angleAt(e);
    setAngle(a);
    if (a - START > SWEEP_TRIGGER) {
      dragging = false;
      swing(a);
    }
  });
  const release = () => {
    if (!dragging) return;
    dragging = false;
    if (!busy) setAngle(START); // let go early: it falls back to rest
  };
  svg.addEventListener('pointerup', release);
  svg.addEventListener('pointercancel', release);
  box.addEventListener('click', () => {
    if (moved) {
      moved = false;
      return;
    }
    pull();
  });

  return { box, slot, rank, pull, get revealed() { return done; }, model };
}

const SWEEP_TRIGGER = 62;
