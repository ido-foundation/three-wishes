import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeAnswer, sanitizeQuestion, ownWish, publicWish } from '../../server/sanitize.mjs';

// What a forecaster might return alongside the answer: all of it must stay on the server.
const LEAKY = {
  value: 0.62, low: 0.5, high: 0.7, unit: null,
  option_chances: [{ option: 'A', probability: 0.6, reasoning: 'secret reasoning' }, { option: 'B', probability: 0.4 }],
  model: 'a-model', cost_usd: 1.23, deus_run_id: 'run-1', trace: ['step'], ran_with: { effort: 'x' }, report: { text: 'long' }, run_id: 'r',
};

test('the answer is built field by field: extra fields upstream never reach a person', () => {
  for (const kind of ['binary', 'categorical', 'numerical']) {
    const out = JSON.stringify(sanitizeAnswer(kind, LEAKY));
    for (const bad of ['secret', 'a-model', '1.23', 'run-1', 'trace', 'ran_with', 'report', 'cost', 'reasoning']) {
      assert.ok(!out.includes(bad), `${kind} leaked ${bad}`);
    }
  }
});

test('yes/no: a chance between 0 and 1', () => {
  assert.deepEqual(sanitizeAnswer('binary', { value: 0.1265 }), { kind: 'binary', p: 0.1265 });
  assert.equal(sanitizeAnswer('binary', { value: 62 }).p, 0.62, 'a percentage is read as one');
  assert.equal(sanitizeAnswer('binary', { value: -1 }).p, 0);
  assert.equal(sanitizeAnswer('binary', { value: null }), null);
  assert.equal(sanitizeAnswer('binary', {}), null);
  assert.equal(sanitizeAnswer('binary', { value: 'high' }), null);
});

test('choice: normalised, ranked, capped at twelve', () => {
  const a = sanitizeAnswer('categorical', { option_chances: [{ option: 'B', probability: 2 }, { option: 'A', probability: 6 }, { option: 'C', probability: 2 }] });
  assert.deepEqual(a.options, [{ label: 'A', p: 0.6 }, { label: 'B', p: 0.2 }, { label: 'C', p: 0.2 }]);
  assert.equal(a.leading, 'A');
  const many = sanitizeAnswer('categorical', { option_chances: Array.from({ length: 20 }, (_, i) => ({ option: `O${i}`, probability: 1 })) });
  assert.equal(many.options.length, 12);
  assert.equal(many.options.at(-1).label, 'Other');
  assert.ok(Math.abs(many.options.reduce((s, o) => s + o.p, 0) - 1) < 0.002);
  assert.equal(sanitizeAnswer('categorical', { option_chances: [] }), null);
  assert.equal(sanitizeAnswer('categorical', { option_chances: [{ option: 'A', probability: 0 }] }), null);
  assert.equal(sanitizeAnswer('categorical', { option_chances: [{ option: 7, probability: 1 }] }), null);
});

test('number: the median, and the range only when it is in order', () => {
  assert.deepEqual(sanitizeAnswer('numerical', { value: 5, low: 3, high: 9, unit: 'seats' }), { kind: 'numerical', median: 5, low: 3, high: 9, unit: 'seats' });
  assert.equal(sanitizeAnswer('numerical', { value: 5, low: 6, high: 9 }).low, undefined);
  assert.equal(sanitizeAnswer('numerical', { value: 5, low: 5, high: 5 }).low, undefined);
  assert.equal(sanitizeAnswer('numerical', {}), null);
  assert.equal(sanitizeAnswer('date', { value: 1 }), null, 'a kind we do not offer');
});

test('the question shows its title, kind, date, options and unit and nothing else', () => {
  const q = sanitizeQuestion({
    title: '  Will   it\nhappen? ', kind: 'categorical', close_date: '2027-01-01', options: ['A', ' B '], unit: 'x',
    description: 'long background', resolution_criteria: 'criteria text', lower_bound: 0,
  });
  assert.deepEqual(q, { title: 'Will it happen?', kind: 'categorical', close_date: '2027-01-01', options: ['A', 'B'] });
  assert.equal(sanitizeQuestion({ kind: 'date', title: 'x' }), null);
  assert.equal(sanitizeQuestion({ kind: 'binary', title: 'x', close_date: 'soon' }).close_date, null);
});

const row = (extra = {}) => ({
  id: 'w1', user_id: 7, text: 'my private wording', forecast_id: 'f-9', error: 'launch', status: 'ready',
  question_json: JSON.stringify({ title: 'Will it?', kind: 'binary', close_date: '2027-01-01', description: 'd', resolution_criteria: 'c' }),
  result_json: JSON.stringify({ kind: 'binary', p: 0.4 }), share_token: 'tok123456', created_at: 1, done_at: 2, revealed_at: null, refunded: 0, ...extra,
});

test("the owner's view hides ids, wording, errors and the forecaster's reference", () => {
  const out = JSON.stringify(ownWish(row(), { baseUrl: 'https://x.test' }));
  for (const bad of ['user_id', 'my private wording', 'f-9', 'launch', '"description"', 'resolution_criteria']) assert.ok(!out.includes(bad), bad);
  assert.match(out, /https:\/\/x\.test\/w\/tok123456/);
});

test('a running wish has no answer and a failed one is marked returned', () => {
  const run = ownWish(row({ status: 'sealed', result_json: null }));
  assert.equal(run.status, 'running');
  assert.equal(run.answer, undefined);
  assert.equal(run.share_url, undefined);
  assert.equal(ownWish(row({ status: 'failed', refunded: 1, result_json: null })).refunded, true);
});

test('the public view is the question and the answer: no person, no wording, no id', () => {
  const pub = publicWish(row());
  assert.deepEqual(Object.keys(pub).sort(), ['answer', 'done_at', 'question']);
  const out = JSON.stringify(pub);
  for (const bad of ['user', 'private', 'w1', 'f-9', 'tok123456', 'description']) assert.ok(!out.includes(bad), bad);
  assert.equal(publicWish(row({ status: 'running', result_json: null })), null);
  assert.equal(publicWish(undefined), null);
});
