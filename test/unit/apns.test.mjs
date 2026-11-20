import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { generateKeyPairSync, verify } from 'node:crypto';
import { makeApns } from '../../server/apns.mjs';
import { makePush } from '../../server/push.mjs';
import { openDb } from '../../server/db.mjs';

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' });
const CFG = { key: PEM, keyId: 'KEY1234567', teamId: 'TEAM123456', bundleId: 'ai.example.iii' };
const TOKEN = 'ab'.repeat(32);

/** A stand-in for http2.connect: records each request and answers with a status. */
function fakeConnect(answer = () => ({ status: 200, body: '' })) {
  const log = { hosts: [], requests: [] };
  const connect = (host) => {
    log.hosts.push(host);
    const s = new EventEmitter();
    s.closed = false;
    s.close = () => { s.closed = true; };
    s.request = (headers) => {
      const req = new EventEmitter();
      req.setEncoding = () => {};
      req.setTimeout = () => {};
      req.end = (body) => {
        log.requests.push({ host, headers, body: JSON.parse(body) });
        const r = answer(headers);
        setImmediate(() => {
          req.emit('response', { ':status': r.status });
          if (r.body) req.emit('data', r.body);
          req.emit('end');
        });
      };
      return req;
    };
    return s;
  };
  return { connect, log };
}

test('off until all four settings are there', async () => {
  for (const patch of [{ key: '' }, { keyId: '' }, { teamId: '' }, { bundleId: '' }]) {
    const a = makeApns({ ...CFG, ...patch }, { connect: fakeConnect().connect });
    assert.equal(a.enabled, false);
    assert.deepEqual(await a.send({ token: TOKEN, env: 'production' }, {}), { ok: false, status: 0, reason: 'off', dead: false });
  }
  assert.equal(makeApns({}).enabled, false);
  assert.equal(makeApns(CFG, { connect: fakeConnect().connect }).enabled, true);
});

test("the provider token is an ES256 JWT that Apple's check would accept", async () => {
  const f = fakeConnect();
  await makeApns(CFG, { connect: f.connect, now: () => 1_700_000_000_000 }).send({ token: TOKEN, env: 'production' }, { aps: {} });
  const bearer = f.log.requests[0].headers.authorization;
  assert.match(bearer, /^bearer [\w-]+\.[\w-]+\.[\w-]+$/);
  const [h, p, sig] = bearer.slice(7).split('.');
  assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url')), { alg: 'ES256', kid: 'KEY1234567' });
  assert.deepEqual(JSON.parse(Buffer.from(p, 'base64url')), { iss: 'TEAM123456', iat: 1_700_000_000 });
  assert.equal(Buffer.from(sig, 'base64url').length, 64, 'raw r||s, not DER');
  assert.equal(verify('sha256', Buffer.from(`${h}.${p}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url')), true);
});

test('the token is reused for under 50 minutes, then renewed', async () => {
  let t = 1_700_000_000_000;
  const f = fakeConnect();
  const a = makeApns(CFG, { connect: f.connect, now: () => t });
  const dev = { token: TOKEN, env: 'production' };
  await a.send(dev, {});
  t += 49 * 60_000;
  await a.send(dev, {});
  t += 2 * 60_000;
  await a.send(dev, {});
  const jwts = f.log.requests.map((r) => r.headers.authorization);
  assert.equal(jwts[0], jwts[1]);
  assert.notEqual(jwts[1], jwts[2]);
});

test('a request goes to the right host with the headers Apple requires', async () => {
  const f = fakeConnect();
  const a = makeApns(CFG, { connect: f.connect });
  const payload = { aps: { alert: { title: 'III', body: 'x' } }, url: '/?w=1' };
  assert.deepEqual(await a.send({ token: TOKEN, env: 'production' }, payload), { ok: true, status: 200, reason: '', dead: false });
  await a.send({ token: TOKEN, env: 'sandbox' }, payload);
  assert.deepEqual(f.log.hosts, ['https://api.push.apple.com', 'https://api.sandbox.push.apple.com']);
  const r = f.log.requests[0];
  assert.equal(r.headers[':method'], 'POST');
  assert.equal(r.headers[':path'], `/3/device/${TOKEN}`);
  assert.equal(r.headers['apns-topic'], 'ai.example.iii');
  assert.equal(r.headers['apns-push-type'], 'alert');
  assert.deepEqual(r.body, payload);
  await a.send({ token: TOKEN, env: 'production' }, payload);
  assert.equal(f.log.hosts.length, 2, 'one connection per environment, reused');
});

test('dead tokens are told apart from passing trouble', async () => {
  const send = async (status, body) => makeApns(CFG, { connect: fakeConnect(() => ({ status, body })).connect }).send({ token: TOKEN, env: 'production' }, {});
  assert.equal((await send(410, '{"reason":"Unregistered"}')).dead, true);
  assert.equal((await send(400, '{"reason":"BadDeviceToken"}')).dead, true);
  assert.equal((await send(400, '{"reason":"PayloadEmpty"}')).dead, false);
  const busy = await send(429, '{"reason":"TooManyRequests"}');
  assert.deepEqual([busy.ok, busy.dead, busy.reason], [false, false, 'TooManyRequests']);
  assert.equal((await send(500, 'not json')).dead, false);
});

test('a connection that cannot be made is a failure, never a throw', async () => {
  const a = makeApns(CFG, { connect: () => { throw new Error('no route'); } });
  assert.deepEqual(await a.send({ token: TOKEN, env: 'production' }, {}), { ok: false, status: 0, reason: 'network', dead: false });
});

test('devices: only real tokens and known environments are stored', async (t) => {
  const db = openDb(':memory:');
  t.after(() => db.close());
  const push = await makePush({ db, config: { vapid: {}, apns: {} } });
  assert.equal(push.registerDevice(1, TOKEN, 'sandbox'), true);
  assert.equal(push.registerDevice(1, TOKEN.toUpperCase(), 'production'), true, 'the same token again updates it');
  assert.equal(db.prepare('select count(*) as n from devices').get().n, 1);
  assert.equal(db.prepare('select env from devices').get().env, 'production');
  for (const [tok, env] of [['short', 'sandbox'], ['zz'.repeat(32), 'sandbox'], [TOKEN, 'staging'], [null, 'sandbox'], [TOKEN, undefined], ['ab'.repeat(101), 'sandbox']]) {
    assert.equal(push.registerDevice(1, tok, env), false, String(tok).slice(0, 8));
  }
});

test('"your answer is ready" goes to the phone through Apple, and forgets a dead token', async (t) => {
  const db = openDb(':memory:');
  t.after(() => db.close());
  const sent = [];
  let status = 200;
  const apns = { enabled: true, send: async (d, p) => { sent.push([d.env, d.token, p]); return { ok: status === 200, status, reason: status === 410 ? 'Unregistered' : '', dead: status === 410 }; } };
  const push = await makePush({ db, config: { vapid: {}, apns: {} }, apns });
  push.registerDevice(7, TOKEN, 'production');
  push.registerDevice(8, 'cd'.repeat(32), 'production');
  assert.equal(await push.notify(7, { wishId: 'abc' }), 1);
  assert.equal(sent.length, 1, "another person's phone is not told");
  assert.equal(sent[0][2].url, '/?w=abc');
  assert.equal(sent[0][2].aps.alert.body, 'Your answer is ready.');
  assert.equal(sent[0][2].aps.sound, 'default');
  status = 410;
  assert.equal(await push.notify(7, { wishId: 'abc' }), 0);
  assert.equal(db.prepare('select count(*) as n from devices where user_id = 7').get().n, 0, 'a dead token is forgotten');
  assert.equal(db.prepare('select count(*) as n from devices where user_id = 8').get().n, 1);
});
