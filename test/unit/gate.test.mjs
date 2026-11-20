import test from 'node:test';
import assert from 'node:assert/strict';
import { rulesPrecheck, readJev, buildJevRequest, validateDraft, normalizeText, REASONS } from '../../server/gate.mjs';
import { makeCode, normalizeCode, daysBetween, isoDay, DAY } from '../../server/util.mjs';

const NOW = Date.parse('2026-11-20T12:00:00Z');
const opts = { now: NOW, minDays: 7, maxDays: 1095 };
const good = () => ({
  title: 'Will the Federal Reserve cut rates before 31 December 2027?',
  description: 'Background.',
  resolution_criteria: 'Resolves Yes if the FOMC announces a cut, per federalreserve.gov.',
  kind: 'binary', close_date: '2027-12-31', options: [], lower_bound: null, upper_bound: null, unit: null, condition: null, unresolved: [],
});

test('the pre-check turns away the obvious without a model', () => {
  assert.equal(rulesPrecheck('hi'), 'length');
  assert.equal(rulesPrecheck('x'.repeat(301)), 'length');
  assert.equal(rulesPrecheck('Will someone murder the mayor next year?'), 'harmful');
  assert.equal(rulesPrecheck('Will my girlfriend text me back tonight?'), 'private');
  assert.equal(rulesPrecheck('Should I move to Berlin next year?'), 'opinion');
  assert.equal(rulesPrecheck('Who was the president in 1990?'), 'past');
  assert.equal(rulesPrecheck('12345 67890 !!!!!'), 'other');
  assert.equal(rulesPrecheck('Will the Fed cut rates in 2027?'), null);
  assert.equal(rulesPrecheck('Will Bitcoin close above 150k on 31 December 2027?'), null);
  for (const r of ['past', 'opinion', 'private', 'harmful', 'vague', 'other', 'length']) assert.ok(REASONS[r]);
});

test('the decision answer is read into a reason and a kind', () => {
  const r = readJev({ answers: { form: { probabilities: { fine: 0.2, past: 0.7, opinion: 0.1 } }, kind: { probabilities: { binary: 0.9, numerical: 0.1 } } } });
  assert.deepEqual(r, { fine: 0.2, reason: 'past', kind: 'binary' });
  assert.equal(readJev({ data: { answers: { form: { probabilities: { fine: 0.9 } } } } }).fine, 0.9);
  assert.throws(() => readJev({}), /unexpected/);
  assert.throws(() => readJev({ answers: { form: { probabilities: { past: 1 } } } }), /unexpected/);
});

test('the decision request asks two typed choice questions', () => {
  const req = buildJevRequest('Will it rain?', 'typesafe/jev-1.14');
  assert.equal(req.model, 'typesafe/jev-1.14');
  assert.equal(req.state.question, 'Will it rain?');
  assert.equal(req.questions.form.type, 'choice');
  assert.ok('fine' in req.questions.form.criteria && 'past' in req.questions.form.criteria);
  assert.deepEqual(Object.keys(req.questions.kind.criteria), ['binary', 'categorical', 'numerical', 'date']);
});

test('a well-formed draft passes, and only the fields we use come through', () => {
  const r = validateDraft({ ...good(), extra: 'x', cutpoints: [1] }, opts);
  assert.ok(r.ok);
  assert.deepEqual(Object.keys(r.question).sort(), ['close_date', 'description', 'kind', 'lower_bound', 'options', 'resolution_criteria', 'title', 'unit', 'upper_bound']);
});

test('a guess the sharpening step flagged passes with a note; a field it could not fill does not', () => {
  const note = { field: 'close_date', reason: '  No date given;   I used 2027-12-31, so please check it. ' };
  const guessed = validateDraft({ ...good(), unresolved: [note] }, opts);
  assert.ok(guessed.ok);
  assert.deepEqual(guessed.notes, ['No date given; I used 2027-12-31, so please check it.']);
  assert.deepEqual(validateDraft(good(), opts).notes, []);

  const missing = validateDraft({ ...good(), close_date: null, unresolved: [{ field: 'close_date', reason: 'Say by when.' }, { field: 'title', reason: ' Which   bank? ' }] }, opts);
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, 'vague');
  assert.deepEqual(missing.hints, ['Say by when.', 'Which bank?']);

  assert.equal(validateDraft(null, opts).ok, false);
  assert.equal(validateDraft({ ...good(), resolution_criteria: ' ' }, opts).ok, false);
  assert.equal(validateDraft({ ...good(), title: 'Will?' }, opts).ok, false);
  assert.equal(validateDraft({ ...good(), close_date: 'next spring' }, opts).ok, false);
  assert.equal(validateDraft({ ...good(), kind: 'categorical', options: [], unresolved: [{ field: 'options', reason: 'Which options?' }] }, opts).ok, false);
});

test('kinds we do not offer, and conditions, are turned back', () => {
  assert.equal(validateDraft({ ...good(), kind: 'date' }, opts).reason, 'date');
  assert.equal(validateDraft({ ...good(), condition: 'if X wins' }, opts).reason, 'conditional');
  assert.equal(validateDraft({ ...good(), kind: 'poem' }, opts).ok, false);
});

test('the date window: not too soon, not past, not too far', () => {
  const day = (n) => isoDay(NOW + n * DAY);
  assert.equal(validateDraft({ ...good(), close_date: day(3) }, opts).reason, 'soon');
  assert.equal(validateDraft({ ...good(), close_date: day(-30) }, opts).reason, 'soon');
  assert.ok(validateDraft({ ...good(), close_date: day(7) }, opts).ok);
  assert.ok(validateDraft({ ...good(), close_date: day(1095) }, opts).ok);
  assert.equal(validateDraft({ ...good(), close_date: day(1096) }, opts).reason, 'far');
});

test('a choice needs two to twenty distinct options; a number needs ordered bounds', () => {
  const cat = (options) => validateDraft({ ...good(), kind: 'categorical', options }, opts);
  assert.equal(cat(['Only']).ok, false);
  assert.equal(cat(['A', 'A']).ok, false, 'duplicates collapse to one');
  assert.ok(cat(['A', 'B']).ok);
  assert.equal(cat(Array.from({ length: 21 }, (_, i) => `O${i}`)).ok, false);
  const num = (lo, hi, unit = 'USD') => validateDraft({ ...good(), kind: 'numerical', lower_bound: lo, upper_bound: hi, unit }, opts);
  assert.ok(num(0, 100).ok);
  assert.equal(num(100, 0).ok, false);
  assert.equal(num(null, 5).ok, false);
  assert.equal(num(0, 100, 'a very long unit name that goes on').question.unit.length, 24);
});

test('text is tidied before it is checked', () => {
  assert.equal(normalizeText('  will   it\n\nrain?  '), 'will it rain?');
  assert.equal(normalizeText(null), '');
});

test('invitation codes: readable, normalised, 8 characters', () => {
  for (let i = 0; i < 200; i++) assert.match(makeCode(), /^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{4}$/);
  assert.equal(normalizeCode(' ab12-cd34 '), 'AB12-CD34');
  assert.equal(normalizeCode('ab12cd34'), 'AB12-CD34');
  assert.equal(normalizeCode('short'), null);
  assert.equal(normalizeCode(null), null);
  assert.equal(daysBetween(NOW, '2026-11-27'), 7);
  assert.ok(Number.isNaN(daysBetween(NOW, 'nope')));
});
