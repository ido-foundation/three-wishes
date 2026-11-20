// Rule R5: nothing a person can see says who is behind the answers or how they were made.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { start, Q_YES } from '../helpers.mjs';

const FORBIDDEN = /\b(deus|jev|claude|anthropic|openai|openrouter|typesafe|sonnet|opus|haiku|gpt|gemini|llm|dashboard|forecasting model|machine learning|prompt|token budget|usd per|cost_usd|max_usd)\b/i;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

test('no file the phone downloads names a method, a model or a provider', () => {
  const files = walk('public').filter((p) => ['.html', '.js', '.css', '.webmanifest'].includes(extname(p)));
  assert.ok(files.length >= 8);
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    const hit = text.match(FORBIDDEN);
    assert.equal(hit, null, `${f} says "${hit?.[0]}"`);
  }
});

test('the brand SVGs carry no provenance blobs naming tools', () => {
  for (const f of walk('public/brand').filter((p) => p.endsWith('.svg'))) {
    const text = readFileSync(f, 'utf8');
    assert.doesNotMatch(text, /c2pa|<metadata/i, f);
  }
});

test('no response, error or page from the server says it either', async (t) => {
  const s = await start();
  t.after(s.close);
  const seen = [];
  const c = s.client();
  const record = (r) => { seen.push(typeof r.data === 'string' ? r.data : Buffer.isBuffer(r.data) ? '' : JSON.stringify(r.data)); return r; };

  record(await c.post('/api/redeem', { code: 'AAAA-BBBB' }));
  record(await c.get('/api/me'));
  await c.join();
  for (const text of [Q_YES, 'Which is the prettier city, Paris or Rome?', 'Will the economy recover soon?', 'hi']) record(await c.post('/api/check', { text }));
  const chk = record(await c.post('/api/check', { text: Q_YES }));
  const sealed = record(await c.post('/api/seal', { checkId: chk.data.checkId }));
  record(await c.post('/api/seal', { checkId: chk.data.checkId }));
  await s.tick();
  const me = record(await c.get('/api/me'));
  record(await c.get(`/api/wishes/${sealed.data.wish.id}`));
  const token = me.data.wishes[0].share_url.split('/w/')[1];
  record(await c.get(`/api/public/${token}`));
  record(await c.get(`/w/${token}`));
  record(await c.get('/'));
  record(await c.get('/missing'));
  record(await c.post('/api/check', { text: 'x'.repeat(40_000) }));

  const whole = seen.join('\n');
  assert.ok(whole.length > 500);
  const hit = whole.match(FORBIDDEN);
  assert.equal(hit, null, `a response says "${hit?.[0]}"`);
});

test('the share picture is an image and says nothing else', async (t) => {
  const s = await start();
  t.after(s.close);
  const c = s.client();
  await c.join();
  await c.wish(Q_YES);
  await s.tick();
  const url = (await c.get('/api/me')).data.wishes[0].share_url;
  const svg = s.app.deps.cards.svg(
    (await c.get('/api/me')).data.wishes[0].question,
    (await c.get('/api/me')).data.wishes[0].answer,
  );
  assert.equal(svg.match(FORBIDDEN), null);
  assert.ok(url.includes('/w/'));
});
