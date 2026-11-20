import test from 'node:test';
import assert from 'node:assert/strict';
import {
  START, END, GOLD, fracToDeg, polar, leverModel, niceScale, fmtNumber, unitWord, percent, fmtDate, spring, dialSvg, wrap, esc,
} from '../../public/lib/lever.js';

const Q = { title: 'Will it?', kind: 'binary', close_date: '2027-03-31' };

test('the sweep runs 270 degrees, rest at the lowest mark', () => {
  assert.equal(fracToDeg(0), START);
  assert.equal(fracToDeg(1), END);
  assert.equal(fracToDeg(0.5), 0);
  assert.equal(fracToDeg(-3), START); // clamped
  assert.deepEqual(polar(100, 0), [200, 100]); // 0 degrees is straight up
  assert.deepEqual(polar(100, 90), [300, 200]);
});

test('a yes/no answer points where its chance is', () => {
  const m = leverModel(Q, { kind: 'binary', p: 0.5 });
  assert.equal(m.angle, 0);
  assert.equal(m.figure, '50%');
  assert.equal(m.caption, 'By 31 Mar 2027');
  assert.deepEqual(m.scale.map((s) => s.text), ['0', '25', '50', '75', '100']);
  assert.equal(leverModel(Q, { kind: 'binary', p: 0.004 }).figure, '<1%');
  assert.equal(leverModel(Q, { kind: 'binary', p: 0.996 }).figure, '>99%');
  assert.equal(leverModel(Q, { kind: 'binary', p: 1 }).angle, END);
});

test('a choice cuts the ring by chance, in the question order, without overlap', () => {
  const q = { ...Q, kind: 'categorical', options: ['A', 'B', 'C', 'D'] };
  const a = { kind: 'categorical', leading: 'C', options: [{ label: 'C', p: 0.5 }, { label: 'A', p: 0.3 }, { label: 'B', p: 0.19 }, { label: 'D', p: 0.01 }] };
  const m = leverModel(q, a);
  assert.deepEqual(m.arcs.map((x) => x.label), ['A', 'B', 'C', 'D']);
  for (let i = 0; i < m.arcs.length; i++) {
    const x = m.arcs[i];
    assert.ok(x.a0 >= START - 1e-9 && x.a1 <= END + 1e-9, 'inside the sweep');
    assert.ok(x.a1 > x.a0);
    if (i) assert.ok(x.a0 > m.arcs[i - 1].a1, 'a gap between arcs');
  }
  assert.equal(m.arcs[0].a0, START);
  assert.ok(Math.abs(m.arcs.at(-1).a1 - END) < 1e-6, 'the last arc ends the sweep');
  const lead = m.arcs.find((x) => x.leading);
  assert.equal(lead.label, 'C');
  assert.equal(m.angle, lead.mid);
  assert.equal(m.figure, '50%');
  assert.equal(m.sub, 'C');
  assert.deepEqual(m.arcs.map((x) => x.numeral), ['I', 'II', 'III', 'IV']);
});

test('a choice survives options the question did not list, and tiny chances stay visible', () => {
  const a = { kind: 'categorical', leading: 'X', options: [{ label: 'X', p: 0.999 }, { label: 'Y', p: 0.001 }] };
  const m = leverModel({ ...Q, kind: 'categorical', options: ['X'] }, a);
  assert.equal(m.arcs.length, 2);
  assert.ok(m.arcs.find((x) => x.label === 'Y').a1 - m.arcs.find((x) => x.label === 'Y').a0 >= 1.5);
});

test('niceScale gives four equal steps on round numbers that hold the range', () => {
  const s = niceScale(410, 910);
  assert.deepEqual(s, { min: 400, max: 1200, step: 200 });
  for (const [lo, hi] of [[0.12, 0.31], [62, 96], [1_200_000, 3_400_000], [-40, -5], [7, 7.5]]) {
    const n = niceScale(lo, hi);
    assert.ok(n.min <= lo + 1e-9 && n.max >= hi - 1e-9, `holds ${lo}..${hi}`);
    assert.ok(Math.abs(n.min + 4 * n.step - n.max) < 1e-6 * Math.max(1, Math.abs(n.max)), 'four equal steps');
  }
  assert.ok(niceScale(-3, 50, { nonneg: true }).min >= 0);
});

test('a number answer: median on the scale, 80% range as an arc, unit set small', () => {
  const q = { ...Q, kind: 'numerical', unit: 'seats' };
  const m = leverModel(q, { kind: 'numerical', median: 61, low: 52, high: 70, unit: 'seats' });
  assert.equal(m.figure, '61');
  assert.equal(m.unit, 'seats');
  assert.equal(m.sub, '80% likely between 52 and 70 seats');
  assert.ok(m.range.a0 < m.angle && m.angle < m.range.a1);
  assert.equal(m.scale.length, 5);
  const usd = leverModel(q, { kind: 'numerical', median: 78.4, low: 62, high: 96, unit: 'USD' });
  assert.equal(usd.figure, '$78.4');
  assert.equal(usd.unit, '');
  assert.equal(usd.sub, '80% likely between $62 and $96');
  const none = leverModel(q, { kind: 'numerical', median: 10, unit: null });
  assert.equal(none.range, null);
  assert.equal(none.sub, 'median');
});

test('numbers read well', () => {
  assert.equal(fmtNumber(1234567, null, { compact: true }), '1.23M');
  assert.equal(fmtNumber(45_000, null, { compact: true }), '45K');
  assert.equal(fmtNumber(1234.6), '1,235');
  assert.equal(fmtNumber(0.0456), '0.046');
  assert.equal(fmtNumber(45, '%'), '45%');
  assert.equal(fmtNumber(-3, 'USD'), '-$3');
  assert.equal(fmtNumber(12, 'GW'), '12 GW');
  assert.equal(fmtNumber(12, 'GW', { bare: true }), '12');
  assert.equal(unitWord('seats'), 'seats');
  assert.equal(unitWord('%'), '');
  assert.equal(unitWord('USD'), '');
  assert.equal(percent(0.4349), '43%');
  assert.equal(fmtDate('2027-12-31'), '31 Dec 2027');
  assert.equal(fmtDate('nope'), '');
});

test('the spring starts at rest, settles on 1, and overshoots only a little', () => {
  assert.equal(spring(0), 0);
  assert.ok(Math.abs(spring(1.9) - 1) < 0.01);
  let max = 0;
  for (let t = 0; t < 2; t += 0.005) max = Math.max(max, spring(t));
  assert.ok(max < 1.07, `overshoot ${max}`);
});

test('the dial has exactly one gold thing and nothing that glows', () => {
  for (const [q, a] of [
    [Q, { kind: 'binary', p: 0.3 }],
    [{ ...Q, kind: 'categorical', options: ['A', 'B'] }, { kind: 'categorical', leading: 'A', options: [{ label: 'A', p: 0.6 }, { label: 'B', p: 0.4 }] }],
    [{ ...Q, kind: 'numerical' }, { kind: 'numerical', median: 5, low: 3, high: 8, unit: null }],
  ]) {
    const svg = dialSvg(leverModel(q, a));
    assert.equal(svg.split(GOLD).length - 1, 1, 'one gold fill: the star');
    assert.doesNotMatch(svg, /gradient|filter|shadow|blur|000FA0/i);
    assert.match(svg, /aria-label="[^"]+"/);
  }
});

test('option names cannot break out of the drawing', () => {
  const a = { kind: 'categorical', leading: '<script>', options: [{ label: '<script>', p: 0.5 }, { label: '"x"', p: 0.5 }] };
  const svg = dialSvg(leverModel({ ...Q, kind: 'categorical', options: ['<script>', '"x"'] }, a));
  assert.doesNotMatch(svg, /<script>/);
  assert.equal(esc(`<&">'`), '&lt;&amp;&quot;&gt;&#39;');
});

test('wrap breaks at spaces and ends with an ellipsis when it must cut', () => {
  assert.deepEqual(wrap('one two three', 7, 5), ['one two', 'three']);
  const w = wrap('a b c d e f g h i j k l m n o p', 3, 2);
  assert.equal(w.length, 2);
  assert.ok(w[1].endsWith('…'));
});
