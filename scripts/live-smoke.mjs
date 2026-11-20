// One real wish, through the real forecaster. Costs at most WISH_MAX_USD and takes minutes.
//   node scripts/live-smoke.mjs "Will ... ?"      (needs the forecaster token; see .env.example)
// Uses a throwaway in-memory database. Prints only what a person would see; never a credential.
import { createApp } from '../server/index.mjs';

const text = process.argv[2] ?? 'Will the US Federal Reserve lower its target federal funds rate at its December 2026 meeting?';
const stamp = () => new Date().toISOString().slice(11, 19);
const say = (m) => console.log(`[${stamp()}] ${m}`);

const app = await createApp(
  { mode: 'live', dbPath: ':memory:', publicBaseUrl: 'http://127.0.0.1:1', forecaster: { org: process.env.FORECASTER_ORG ?? 'foundation', baseUrl: process.env.FORECASTER_BASE_URL ?? 'https://dashboard.dev.foundationresearch.ai' } },
  { log: { warn: (m) => say(`warn: ${m}`), error: (m) => say(`error: ${m}`) }, deps: { noTimer: true } },
);
say(`mode live; per-wish cap $${app.config.wishMaxUsd}; form check ${app.deps.jev ? app.decider : 'off (rules only)'}`);

const [code] = app.deps.auth.createInvites({ count: 1 });
const { userId } = app.deps.auth.redeem(code);

say(`checking: ${text}`);
const t0 = Date.now();
const check = await app.deps.gate.check(userId, text);
say(`check took ${Math.round((Date.now() - t0) / 1000)}s -> ${JSON.stringify(check)}`);
if (check.verdict !== 'ok') {
  await app.close();
  process.exit(check.verdict === 'ok' ? 0 : 2);
}

const wish = app.deps.wishes.seal(userId, check.checkId);
say(`sealed ${wish.id}; wishes left ${app.deps.wishes.remaining(userId)}`);

const deadline = Date.now() + (app.config.wishTimeoutMin + 2) * 60_000;
let last = '';
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 20_000));
  await app.deps.wishes.tick();
  const w = app.deps.wishes.get(userId, wish.id);
  if (w.status !== last) say(`status: ${w.status}`);
  last = w.status;
  if (w.status === 'ready') {
    say(`answer: ${JSON.stringify(w.answer)}`);
    const png = await app.deps.cards.png('smoke', w.question, w.answer);
    say(`share picture rendered (${png.length} bytes); left ${app.deps.wishes.remaining(userId)}`);
    const row = app.db.prepare('select forecast_id, done_at, sealed_at from wishes where id = ?').get(wish.id);
    say(`took ${Math.round((row.done_at - row.sealed_at) / 1000)}s end to end; forecaster id ${row.forecast_id}`);
    await app.close();
    process.exit(0);
  }
  if (w.status === 'failed') {
    say(`failed and refunded; left ${app.deps.wishes.remaining(userId)}`);
    await app.close();
    process.exit(3);
  }
}
say('gave up waiting');
await app.close();
process.exit(4);
