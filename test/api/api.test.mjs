import test from 'node:test';
import assert from 'node:assert/strict';
import { start, fakeForecasterWith, sleep, Q_YES, T0 } from '../helpers.mjs';

const HOUR = 3_600_000;

test('invitations: a wrong code says one quiet thing; a right one opens; the cookie is locked down', async (t) => {
  const s = await start();
  t.after(s.close);
  const c = s.client();
  const bad = await c.post('/api/redeem', { code: 'AAAA-BBBB' });
  assert.equal(bad.status, 400);
  assert.equal(bad.data.error.message, "That code doesn't work.");
  assert.equal((await c.post('/api/redeem', { code: 'nonsense' })).data.error.message, "That code doesn't work.");
  assert.equal((await c.post('/api/redeem', {})).status, 400);
  assert.equal((await c.get('/api/me')).status, 401);

  const [code] = s.app.deps.auth.createInvites({ count: 1 });
  const ok = await c.post('/api/redeem', { code: code.toLowerCase() });
  assert.equal(ok.status, 200);
  const cookie = ok.headers.getSetCookie()[0];
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Max-Age=\d+/);
  const me = (await c.get('/api/me')).data;
  assert.equal(me.left, 3);
  assert.deepEqual(me.wishes, []);
});

test('invitations: a code is one person; a second device works for a day, up to three', async (t) => {
  const s = await start();
  t.after(s.close);
  const [code] = s.app.deps.auth.createInvites({ count: 1 });
  const a = s.client();
  await a.join(code);
  const b = s.client();
  assert.equal((await b.post('/api/redeem', { code })).status, 200, 'second device within the window');
  const c = s.client();
  assert.equal((await c.post('/api/redeem', { code })).status, 200, 'third device');
  const d = s.client();
  assert.equal((await d.post('/api/redeem', { code })).status, 400, 'a fourth is refused');
  // they are the same person: a wish on one shows on the other
  await a.wish(Q_YES);
  assert.equal((await b.get('/api/me')).data.wishes.length, 1);
  s.clock.t += 25 * HOUR;
  const late = s.client();
  assert.equal((await late.post('/api/redeem', { code })).status, 400, 'after a day the code is spent');
  assert.equal((await a.get('/api/me')).status, 200, 'existing devices stay signed in');
});

test('invitations: people can be given invitations to pass on', async (t) => {
  const s = await start({ invitesPerUser: 2 });
  t.after(s.close);
  const a = s.client();
  await a.join();
  const { invites } = (await a.get('/api/me')).data;
  assert.equal(invites.length, 2);
  const friend = s.client();
  assert.equal((await friend.post('/api/redeem', { code: invites[0] })).status, 200);
  assert.equal((await a.get('/api/me')).data.invites.length, 1, 'a used one leaves the list');
  const stats = s.app.deps.auth.stats();
  assert.equal(stats.people, 2);
});

test('redeeming is rate limited per address', async (t) => {
  const s = await start();
  t.after(s.close);
  const c = s.client();
  let last;
  for (let i = 0; i < 12; i++) last = await c.post('/api/redeem', { code: `ZZZZ-${String(1000 + i)}` });
  assert.equal(last.status, 429);
});

test('a question we cannot answer is turned away and costs nothing', async (t) => {
  const s = await start();
  t.after(s.close);
  const c = s.client();
  await c.join();
  for (const [text, reason] of [
    ['Which is the prettier city, Paris or Rome?', 'opinion'],
    ['Should I move to Berlin next year?', 'opinion'],
    ['Will my girlfriend text me back tonight?', 'private'],
    ['Who was the president in 1990?', 'past'],
    ['hi', 'length'],
  ]) {
    const r = await c.post('/api/check', { text });
    assert.equal(r.status, 200, text);
    assert.equal(r.data.verdict, 'no', text);
    assert.equal(r.data.reason, reason, text);
    assert.ok(r.data.message.length > 5);
    assert.equal(r.data.checkId, undefined);
  }
  assert.equal((await c.get('/api/me')).data.left, 3);
});

test('a vague question gets hints; a conditional and a "when" question are turned back', async (t) => {
  const s = await start();
  t.after(s.close);
  const c = s.client();
  await c.join();
  const vague = (await c.post('/api/check', { text: 'Will the economy recover soon?' })).data;
  assert.equal(vague.verdict, 'fix');
  assert.ok(vague.hints.length >= 1);
  const guessed = (await c.post('/api/check', { text: 'Will the unemployment rate exceed 6 percent, probably by the summer of 2027?' })).data;
  assert.equal(guessed.verdict, 'ok', 'a flagged guess still reaches the review screen');
  assert.equal(guessed.notes.length, 1);
  assert.match(guessed.notes[0], /please check/);
  assert.equal((await c.post('/api/check', { text: 'If rates fall then will housing recover by 2027?' })).data.reason, 'conditional');
  assert.equal((await c.post('/api/check', { text: 'When will the Fed cut rates next?' })).data.reason, 'date');
  assert.equal((await c.post('/api/check', { text: 'Will the Fed cut rates today?' })).data.reason, 'soon', 'settles today');
  assert.equal((await c.post('/api/check', { text: 'Will the Fed cut rates tomorrow?' })).data.verdict, 'ok', 'a question can settle tomorrow');
  assert.equal((await c.get('/api/me')).data.left, 3);
});

test('a good question returns only what a person may see, and a check to seal', async (t) => {
  const s = await start();
  t.after(s.close);
  const c = s.client();
  await c.join();
  const r = (await c.post('/api/check', { text: Q_YES })).data;
  assert.equal(r.verdict, 'ok');
  assert.ok(r.checkId);
  assert.deepEqual(Object.keys(r.question).sort(), ['close_date', 'criteria', 'kind', 'title']);
  assert.equal(r.question.kind, 'binary');
  assert.match(r.question.criteria, /^Resolves/);
  const raw = JSON.stringify(r);
  assert.equal(raw.includes('resolution_criteria') || raw.includes('"description"'), false, 'no raw fields');
  assert.equal(r.rewrite, null, 'asked exactly as written: nothing was reworded');
  const reworded = (await c.post('/api/check', { text: 'Will bitcoin close above 150000 dollars next year?' })).data;
  assert.equal(reworded.verdict, 'ok');
  assert.equal(reworded.question.title, 'Will bitcoin close above 150000 dollars in 2027?');
  assert.equal(reworded.rewrite.from, 'Will bitcoin close above 150000 dollars next year?');
  assert.match(reworded.rewrite.reason, /next year/);
  const quiet = (await c.post('/api/check', { text: 'will the fed cut rates before the end of 2027' })).data;
  assert.equal(quiet.rewrite, null, 'capital letters and a question mark are not worth mentioning');
});

test('sealing spends exactly one wish; a check seals once; three wishes, never four', async (t) => {
  const s = await start();
  t.after(s.close);
  const c = s.client();
  await c.join();
  const chk = (await c.post('/api/check', { text: Q_YES })).data;
  const first = await c.post('/api/seal', { checkId: chk.checkId });
  assert.equal(first.status, 200);
  assert.equal(first.data.left, 2);
  assert.equal(first.data.wish.status, 'running');
  assert.equal((await c.post('/api/seal', { checkId: chk.checkId })).status, 410, 'the same check cannot be sealed twice');
  assert.equal((await c.get('/api/me')).data.left, 2);

  await c.wish('Will Bitcoin close above 150000 dollars before the end of 2027?');
  const third = await c.wish('Will the unemployment rate exceed 6 percent in 2027?');
  assert.equal(third.data.left, 0);

  const more = (await c.post('/api/check', { text: 'Will oil exceed 120 dollars before the end of 2027?' })).data;
  assert.equal(more.verdict, 'ok', 'checking is free');
  const over = await c.post('/api/seal', { checkId: more.checkId });
  assert.equal(over.status, 409);
  assert.equal(over.data.error.code, 'none_left');
  assert.equal((await c.get('/api/me')).data.wishes.length, 3);
});

test('a check expires, belongs to its person, and cannot be forged', async (t) => {
  const s = await start();
  t.after(s.close);
  const a = s.client();
  const b = s.client();
  await a.join();
  await b.join();
  const chk = (await a.post('/api/check', { text: Q_YES })).data;
  assert.equal((await b.post('/api/seal', { checkId: chk.checkId })).status, 410, "someone else's check");
  assert.equal((await a.post('/api/seal', { checkId: "1' or '1'='1" })).status, 410);
  assert.equal((await a.post('/api/seal', {})).status, 410);
  s.clock.t += 31 * 60_000;
  assert.equal((await a.post('/api/seal', { checkId: chk.checkId })).status, 410, 'after thirty minutes');
  assert.equal((await a.get('/api/me')).data.left, 3);
});

test('the answer arrives, is the same however it is read, and a share link shows only the answer', async (t) => {
  const s = await start();
  t.after(s.close);
  const c = s.client();
  await c.join();
  const sealed = await c.wish(Q_YES);
  const id = sealed.data.wish.id;
  await s.tick();
  const got = (await c.get(`/api/wishes/${id}`)).data;
  assert.equal(got.wish.status, 'ready');
  assert.equal(got.wish.answer.kind, 'binary');
  assert.ok(got.wish.answer.p > 0 && got.wish.answer.p < 1);
  assert.match(got.wish.share_url, /\/w\/[A-Za-z0-9_-]{8,}$/);
  assert.equal(got.wish.revealed, false);
  assert.equal((await c.post(`/api/wishes/${id}/reveal`)).status, 200);
  assert.equal((await c.get(`/api/wishes/${id}`)).data.wish.revealed, true);

  const token = got.wish.share_url.split('/w/')[1];
  const anon = s.client();
  const pub = await anon.get(`/api/public/${token}`);
  assert.equal(pub.status, 200);
  assert.deepEqual(Object.keys(pub.data).sort(), ['answer', 'demo', 'done_at', 'question']);
  assert.equal(pub.data.demo, true, 'a fake answer says so');
  assert.equal((await anon.get('/api/public/not-a-real-token-xxxx')).status, 404);

  const page = await anon.get(`/w/${token}`);
  assert.equal(page.status, 200);
  assert.match(page.data, new RegExp(`og:image" content="${s.base}/w/${token}/card.png"`));
  assert.match(page.data, /twitter:card/);
  assert.equal(page.data.match(/<title>/g).length, 1, 'one title, the answer');
  assert.match(page.data, /<title>\d+% · /);
  const card = await anon.get(`/w/${token}/card.png`);
  assert.equal(card.status, 200);
  assert.equal(card.headers.get('content-type'), 'image/png');
  assert.deepEqual([...card.data.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
  assert.equal((await anon.get('/w/zzzzzzzzzz/card.png')).status, 404);
});

test('a failed run gives the wish back', async (t) => {
  const s = await start();
  t.after(s.close);
  const c = s.client();
  await c.join();
  const { data } = await c.wish('Will this wish fail before the end of 2027?');
  assert.equal(data.left, 2);
  await sleep(20);
  await s.tick(); // fails: started again once, still a running wish
  assert.equal((await c.get('/api/me')).data.wishes[0].status, 'running');
  assert.equal((await c.get('/api/me')).data.left, 2);
  await sleep(20);
  await s.tick(); // fails again: given back
  const me = (await c.get('/api/me')).data;
  assert.equal(me.left, 3, 'refunded');
  assert.equal(me.wishes[0].status, 'failed');
  assert.equal(me.wishes[0].refunded, true);
  assert.equal(me.wishes[0].answer, undefined);
  assert.equal(JSON.stringify(me).includes('launch'), false, 'no internal reason shown');
});

test('a run that fails once is started again, and the person never sees the stumble', async (t) => {
  const real = fakeForecasterWith({});
  const bad = new Set();
  let n = 0;
  const forecaster = {
    ...real,
    forecast: async (q) => { const id = await real.forecast(q); if (n++ === 0) bad.add(id); return id; },
    status: async (id) => (bad.has(id) ? { state: 'failed', reason: 'failed' } : real.status(id)),
  };
  const s = await start({}, { forecaster });
  t.after(s.close);
  const c = s.client();
  await c.join();
  await c.wish(Q_YES);
  await sleep(20);
  await s.tick();
  assert.equal((await c.get('/api/me')).data.wishes[0].status, 'running');
  await sleep(20);
  await s.tick();
  const me = (await c.get('/api/me')).data;
  assert.equal(n, 2, 'two forecasts were started');
  assert.equal(me.wishes[0].status, 'ready');
  assert.equal(me.left, 2, 'one wish spent, as it should be');
});

test('a wish that cannot be launched is retried, then given back', async (t) => {
  let attempts = 0;
  const s = await start({}, { forecaster: fakeForecasterWith({ forecast: async () => { attempts++; throw Object.assign(new Error('down'), { code: 'http' }); } }) });
  t.after(s.close);
  const c = s.client();
  await c.join();
  await c.wish(Q_YES);
  await sleep(30);
  assert.equal((await c.get('/api/me')).data.left, 2, 'still held while retrying');
  await s.tick();
  await s.tick();
  const me = (await c.get('/api/me')).data;
  assert.equal(attempts, 3);
  assert.equal(me.left, 3);
  assert.equal(me.wishes[0].status, 'failed');
});

test('a wish that takes too long is given back', async (t) => {
  const s = await start({}, { forecaster: fakeForecasterWith({ status: async () => ({ state: 'running' }) }) });
  t.after(s.close);
  const c = s.client();
  await c.join();
  await c.wish(Q_YES);
  await sleep(20);
  await s.tick();
  assert.equal((await c.get('/api/me')).data.left, 2, 'still running at first');
  s.clock.t += 46 * 60_000;
  await s.tick();
  const me = (await c.get('/api/me')).data;
  assert.equal(me.left, 3);
  assert.equal(me.wishes[0].status, 'failed');
});

test('a status error does not lose the wish', async (t) => {
  let down = true;
  const real = fakeForecasterWith({});
  const s = await start({}, { forecaster: { ...real, status: async (id) => { if (down) throw new Error('blip'); return real.status(id); } } });
  t.after(s.close);
  const c = s.client();
  await c.join();
  await c.wish(Q_YES);
  await sleep(20);
  await s.tick();
  assert.equal((await c.get('/api/me')).data.wishes[0].status, 'running');
  down = false;
  await s.tick();
  assert.equal((await c.get('/api/me')).data.wishes[0].status, 'ready');
});

test('the day has a cap on wishes sealed, and a refused seal spends nothing', async (t) => {
  const s = await start({ dailyLimit: 2 });
  t.after(s.close);
  const a = s.client();
  const b = s.client();
  await a.join();
  await b.join();
  await a.wish(Q_YES);
  await b.wish('Will Bitcoin close above 150000 dollars before the end of 2027?');
  const chk = (await a.post('/api/check', { text: 'Will oil exceed 120 dollars before the end of 2027?' })).data;
  const r = await a.post('/api/seal', { checkId: chk.checkId });
  assert.equal(r.status, 409);
  assert.equal(r.data.error.code, 'daily_cap');
  assert.equal((await a.get('/api/me')).data.left, 2);
  s.clock.t += 24 * HOUR;
  assert.equal((await a.post('/api/check', { text: 'Will oil exceed 120 dollars before the end of 2027?' })).status, 200);
});

test('people cannot see or touch each other', async (t) => {
  const s = await start();
  t.after(s.close);
  const a = s.client();
  const b = s.client();
  await a.join();
  await b.join();
  const { data } = await a.wish(Q_YES);
  const id = data.wish.id;
  assert.equal((await b.get(`/api/wishes/${id}`)).status, 404);
  assert.equal((await b.post(`/api/wishes/${id}/reveal`)).status, 404);
  assert.deepEqual((await b.get('/api/me')).data.wishes, []);
  assert.equal((await b.get('/api/wishes/not-a-uuid')).status, 404);
});

test('a person is limited in how many checks an hour; one at a time', async (t) => {
  const s = await start({ checksPerHour: 3 });
  t.after(s.close);
  const c = s.client();
  await c.join();
  for (let i = 0; i < 3; i++) assert.equal((await c.post('/api/check', { text: 'Which is the prettier city, Paris or Rome?' })).status, 200);
  const r = await c.post('/api/check', { text: Q_YES });
  assert.equal(r.status, 429);
  s.clock.t += 61 * 60_000;
  assert.equal((await c.post('/api/check', { text: Q_YES })).status, 200);
});

test('the form check (Jev) turns questions away by reason, and failing open falls back to the rules', async (t) => {
  const answer = (form) => ({ answers: { form: { probabilities: form }, kind: { probabilities: { binary: 1 } } } });
  let respond = answer({ fine: 0.05, past: 0.9, other: 0.05 });
  const s = await start({}, { jev: { decide: async () => (typeof respond === 'function' ? respond() : respond) } });
  t.after(s.close);
  const c = s.client();
  await c.join();
  let r = (await c.post('/api/check', { text: Q_YES })).data;
  assert.deepEqual([r.verdict, r.reason], ['no', 'past']);
  respond = answer({ fine: 0.1, vague: 0.8, other: 0.1 });
  r = (await c.post('/api/check', { text: Q_YES })).data;
  assert.equal(r.verdict, 'ok', '"vague" from the decision model is not final: the sharpening step decides');
  respond = answer({ fine: 0.97, other: 0.03 });
  assert.equal((await c.post('/api/check', { text: Q_YES })).data.verdict, 'ok');
  respond = () => { throw new Error('timeout'); };
  assert.equal((await c.post('/api/check', { text: Q_YES })).data.verdict, 'ok', 'the rules and the sharpening step still apply');
  assert.equal((await c.post('/api/check', { text: 'Should I move to Berlin next year?' })).data.verdict, 'no', 'and the rules still catch the obvious');
  respond = { nonsense: true };
  assert.equal((await c.post('/api/check', { text: Q_YES })).data.verdict, 'ok');
});

test('if the sharpening step is down, the person is told to try again and nothing is spent', async (t) => {
  const s = await start({}, { forecaster: fakeForecasterWith({ sharpen: async () => { throw Object.assign(new Error('x'), { code: 'http' }); } }) });
  t.after(s.close);
  const c = s.client();
  await c.join();
  const r = await c.post('/api/check', { text: Q_YES });
  assert.equal(r.status, 503);
  assert.match(r.data.error.message, /try again/i);
  assert.equal((await c.get('/api/me')).data.left, 3);
});

test('what the forecaster adds beyond the answer never reaches the phone or a link', async (t) => {
  const real = fakeForecasterWith({});
  const forecaster = {
    ...real,
    status: async (id) => {
      const st = await real.status(id);
      return st.state === 'ready' ? { state: 'ready', raw: { ...st.raw, model: 'SECRET-MODEL', cost_usd: 9.99, deus_run_id: 'SECRET-RUN', trace: 'SECRET-TRACE' } } : st;
    },
  };
  const s = await start({}, { forecaster });
  t.after(s.close);
  const c = s.client();
  await c.join();
  const { data } = await c.wish(Q_YES);
  await s.tick();
  const mine = JSON.stringify((await c.get('/api/me')).data) + JSON.stringify((await c.get(`/api/wishes/${data.wish.id}`)).data);
  const token = (await c.get('/api/me')).data.wishes[0].share_url.split('/w/')[1];
  const shared = JSON.stringify((await s.client().get(`/api/public/${token}`)).data) + (await s.client().get(`/w/${token}`)).data;
  for (const bad of ['SECRET', '9.99']) {
    assert.ok(!mine.includes(bad), `phone leaked ${bad}`);
    assert.ok(!shared.includes(bad), `link leaked ${bad}`);
  }
});

test('Web Push: only real subscriptions are kept, and "ready" notifies once', async (t) => {
  const sent = [];
  const push = {
    enabled: true,
    publicKey: 'PUBKEY',
    subscribe: (uid, sub) => (sub?.endpoint?.startsWith('https://') ? (sent.push(['sub', uid]), true) : false),
    notify: async (uid, p) => { sent.push(['notify', uid, p.wishId]); },
  };
  const s = await start({}, { push });
  t.after(s.close);
  const c = s.client();
  await c.join();
  assert.equal((await c.get('/api/me')).data.push.key, 'PUBKEY');
  assert.equal((await c.post('/api/push', { subscription: { endpoint: 'http://insecure' } })).status, 400);
  assert.equal((await c.post('/api/push', { subscription: { endpoint: 'https://push.example/abc', keys: { p256dh: 'a', auth: 'b' } } })).status, 200);
  const { data } = await c.wish(Q_YES);
  await s.tick();
  await s.tick();
  assert.deepEqual(sent.filter((x) => x[0] === 'notify'), [['notify', 1, data.wish.id]]);
});

test('the native app registers its phone, and only a signed-in person can', async (t) => {
  const seen = [];
  const push = { enabled: false, publicKey: null, subscribe: () => false, registerDevice: (uid, token, env) => (/^[0-9a-f]{64}$/.test(token) && ['sandbox', 'production'].includes(env) ? (seen.push([uid, env]), true) : false), notify: async () => 0 };
  const s = await start({}, { push });
  t.after(s.close);
  const c = s.client();
  assert.equal((await c.post('/api/device', { token: 'ab'.repeat(32), env: 'sandbox' })).status, 401);
  await c.join();
  assert.equal((await c.post('/api/device', { token: 'nope', env: 'sandbox' })).status, 400);
  assert.equal((await c.post('/api/device', { token: 'ab'.repeat(32), env: 'sandbox' })).status, 200);
  assert.deepEqual(seen, [[1, 'sandbox']]);
});

test('the real Web Push store rejects bad subscriptions and drops dead ones', async (t) => {
  const { makePush } = await import('../../server/push.mjs');
  const { openDb } = await import('../../server/db.mjs');
  const db = openDb(':memory:');
  t.after(() => db.close());
  const off = await makePush({ db, config: { vapid: {} } });
  assert.equal(off.enabled, false);
  assert.equal(await off.notify(1, { wishId: 'x' }), 0);
  const good = { endpoint: 'https://push.example/' + 'a'.repeat(20), keys: { p256dh: 'p', auth: 'a' } };
  assert.equal(off.subscribe(1, good), true);
  assert.equal(off.subscribe(1, { endpoint: 'https://x', keys: {} }), false);
  assert.equal(off.subscribe(1, { endpoint: 'ftp://x', keys: { p256dh: 'p', auth: 'a' } }), false);
  assert.equal(off.subscribe(1, null), false);
  assert.equal(db.prepare('select count(*) as n from pushes').get().n, 1);
});

test('requests from another site are refused; headers are strict', async (t) => {
  const s = await start();
  t.after(s.close);
  const c = s.client();
  await c.join();
  const evil = await c.post('/api/check', { text: Q_YES }, { Origin: 'https://evil.example' });
  assert.equal(evil.status, 403);
  assert.equal((await c.post('/api/check', { text: Q_YES }, { Origin: 'null' })).status, 403, 'a sandboxed page sends "null"');
  assert.equal((await c.post('/api/check', { text: Q_YES }, { Origin: 'not a url' })).status, 403);
  assert.equal((await c.get('/api/me', { Cookie: 'tw_session=%E0%A4%A' })).status, 401, 'a malformed cookie is just no cookie');
  const page = await c.get('/');
  assert.equal(page.status, 200);
  const csp = page.headers.get('content-security-policy');
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
  assert.match(page.data, /name="robots" content="noindex/);
  assert.match((await c.get('/robots.txt')).data, /Disallow: \//);
});

test('only the public folder is served', async (t) => {
  const s = await start();
  t.after(s.close);
  const c = s.client();
  for (const p of ['/server/config.mjs', '/package.json', '/.env', '/data/wishes.db', '/..%2fpackage.json', '/%2e%2e/package.json', '/brand/', '/nope.js']) {
    const r = await c.get(p);
    assert.equal(r.status, 404, p);
  }
  assert.equal((await c.get('/manifest.webmanifest')).status, 200);
  assert.equal((await c.get('/sw.js')).headers.get('service-worker-allowed'), '/');
  assert.equal((await c.get('/brand/fonts/HankenGrotesk-Light.ttf')).status, 200);
  assert.equal((await c.get('/i/ABCD-EFGH')).status, 200, 'the invitation link opens the app shell');
});

test('the admin numbers need the token', async (t) => {
  const s = await start();
  t.after(s.close);
  const c = s.client();
  assert.equal((await c.get('/admin/stats')).status, 404);
  assert.equal((await c.get('/admin/stats', { 'X-Admin-Token': 'wrong' })).status, 404);
  await c.join();
  await c.wish(Q_YES);
  const stats = (await c.get('/admin/stats', { 'X-Admin-Token': 'admin-secret' })).data;
  assert.equal(stats.people, 1);
  assert.equal(stats.wishesSealed, 1);
  assert.equal(stats.mode, 'fake');
  const none = await start({ adminToken: '' });
  t.after(none.close);
  assert.equal((await none.client().get('/admin/stats', { 'X-Admin-Token': '' })).status, 404, 'no token set means off');
});

test('big or broken bodies are refused cleanly', async (t) => {
  const s = await start();
  t.after(s.close);
  const c = s.client();
  await c.join();
  const big = await c.post('/api/check', { text: 'x'.repeat(40_000) });
  assert.equal(big.status, 413);
  const res = await fetch(s.base + '/api/check', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: 'tw_session=' }, body: '{not json' });
  assert.equal(res.status, 401);
  assert.equal((await c.get('/nothing')).status, 404);
  assert.equal((await c.req('DELETE', '/')).status, 405);
});
