import test from 'node:test';
import assert from 'node:assert/strict';
import { makeForecaster } from '../../server/adapters/forecaster.mjs';

const config = { wishMaxUsd: 2, wishTimeoutMin: 45, forecaster: { baseUrl: 'https://dash.test', token: 't0k', org: 'foundation', depth: 'light', draftWaitMs: 5000 } };
const q = { title: 'Will it?', description: 'd', resolution_criteria: 'c', kind: 'binary', close_date: '2027-01-01', options: [], unit: null, lower_bound: null, upper_bound: null };

function fakeFetch(handler) {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined });
    const out = await handler(url, init);
    return { ok: out.status < 400, status: out.status, json: async () => out.json };
  };
  return { f, calls };
}

test('a launch sends the question and the caps, and never a time limit', async () => {
  const { f, calls } = fakeFetch(async () => ({ status: 201, json: { id: 'abc' } }));
  const id = await makeForecaster(config, f).forecast(q);
  assert.equal(id, 'abc');
  const body = calls[0].body;
  assert.equal(calls[0].url, 'https://dash.test/v1/questions');
  assert.equal(body.max_seconds, undefined, 'the forecaster refuses a time limit it did not choose');
  assert.equal(body.max_usd, 2);
  assert.equal(body.depth, 'light');
  assert.equal(body.launch, true);
  assert.equal(body.runs, 'single');
  assert.equal(body.cadence, 'once');
  assert.equal(calls[0].headers['X-Forecasting-Org'], 'foundation');
  assert.ok(calls[0].headers.Authorization.startsWith('Bearer '));
});

test('a choice sends its options; a number sends its bounds and unit', async () => {
  const { f, calls } = fakeFetch(async () => ({ status: 201, json: { id: 'x' } }));
  const fc = makeForecaster(config, f);
  await fc.forecast({ ...q, kind: 'categorical', options: ['A', 'B'] });
  assert.deepEqual(calls[0].body.options, ['A', 'B']);
  await fc.forecast({ ...q, kind: 'numerical', lower_bound: 0, upper_bound: 10, unit: 'USD' });
  assert.deepEqual([calls[1].body.lower_bound, calls[1].body.upper_bound, calls[1].body.unit], [0, 10, 'USD']);
});

test('the draft request is the text alone (as_of is refused for ordinary users)', async () => {
  const { f, calls } = fakeFetch(async (url, init) => {
    if (init.method === 'POST') return { status: 202, json: { id: 'd1', state: 'drafting' } };
    if (init.method === 'GET') return { status: 200, json: [{ id: 'd1', state: 'ready', draft: { title: 'T' } }] };
    return { status: 204 };
  });
  const draft = await makeForecaster({ ...config, forecaster: { ...config.forecaster, draftWaitMs: 8000 } }, f).sharpen('will it?');
  assert.equal(draft.title, 'T');
  assert.deepEqual(calls[0].body, { text: 'will it?' });
});

test('status: running, failed and ready are told apart, and only the answer fields come out', async () => {
  const run = (state) => ({ status: 200, json: { runs: [{ state, created_at: '2026-11-20T10:00:00Z' }], value: 0.4, low: null, high: null, option_chances: [], unit: null, cost_usd: 9, model: 'secret' } });
  const st = async (state) => makeForecaster(config, fakeFetch(async () => run(state)).f).status('id');
  assert.equal((await st('running')).state, 'running');
  assert.equal((await st('queued')).state, 'running');
  const failed = await st('failed');
  assert.deepEqual([failed.state, failed.reason], ['failed', 'failed']);
  assert.equal((await st('stopped')).state, 'failed');
  const ready = await st('succeeded');
  assert.equal(ready.state, 'ready');
  assert.deepEqual(Object.keys(ready.raw).sort(), ['high', 'low', 'option_chances', 'unit', 'value']);
  const none = await makeForecaster(config, fakeFetch(async () => ({ status: 200, json: { runs: [] } })).f).status('id');
  assert.equal(none.state, 'running', 'just launched: no run yet');
  const blocked = await makeForecaster(config, fakeFetch(async () => ({ status: 200, json: { blocked: 'x', runs: [] } })).f).status('id');
  assert.equal(blocked.state, 'failed');
});

test('errors carry the status, never the token or the body', async () => {
  const { f } = fakeFetch(async () => ({ status: 422, json: { detail: 'secret detail t0k' } }));
  await assert.rejects(() => makeForecaster(config, f).forecast(q), (e) => e.code === 'http_422' && !/t0k|secret/.test(e.message));
});
