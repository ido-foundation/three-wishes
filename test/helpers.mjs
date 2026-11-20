import { createApp } from '../server/index.mjs';
import { makeFakeForecaster } from '../server/adapters/fakes.mjs';

export const T0 = Date.parse('2026-11-20T12:00:00Z');
const quiet = { warn() {}, error() {}, log() {} };

/** An app on a free port, an in-memory database and a clock the test can move. */
export async function start(overrides = {}, deps = {}) {
  const clock = { t: T0 };
  const now = () => clock.t;
  const app = await createApp(
    { mode: 'fake', dbPath: ':memory:', fakeDelayMs: 0, adminToken: 'admin-secret', publicBaseUrl: 'http://127.0.0.1:1', unlimitedQuestions: false, ...overrides },
    { now, log: quiet, deps: { noTimer: true, ...deps } },
  );
  const port = await app.listen(0);
  const base = `http://127.0.0.1:${port}`;
  app.config.publicBaseUrl = base;

  function client() {
    let cookie = '';
    const c = {
      async req(method, path, body, headers = {}) {
        const res = await fetch(base + path, {
          method,
          headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
          body: body !== undefined ? JSON.stringify(body) : undefined,
          redirect: 'manual',
        });
        const set = res.headers.getSetCookie?.()[0];
        if (set) cookie = set.split(';')[0];
        const type = res.headers.get('content-type') ?? '';
        const data = type.includes('json') ? await res.json() : type.startsWith('text') ? await res.text() : Buffer.from(await res.arrayBuffer());
        return { status: res.status, headers: res.headers, data };
      },
      get: (p, h) => c.req('GET', p, undefined, h),
      post: (p, b = {}, h) => c.req('POST', p, b, h),
      async join(code) {
        const [fresh] = code ? [code] : app.deps.auth.createInvites({ count: 1 });
        const r = await c.post('/api/redeem', { code: fresh });
        if (r.status !== 200) throw new Error(`join failed ${r.status}`);
        return fresh;
      },
      /** check + seal in one go; returns the seal response. */
      async wish(text) {
        const chk = await c.post('/api/check', { text });
        if (chk.data.verdict !== 'ok') throw new Error(`not ok: ${JSON.stringify(chk.data)}`);
        return c.post('/api/seal', { checkId: chk.data.checkId });
      },
    };
    return c;
  }
  return { app, clock, base, client, tick: () => app.deps.wishes.tick(), close: () => app.close() };
}

export const fakeForecasterWith = (patch, opts = {}) => ({ ...makeFakeForecaster({ delayMs: 0, ...opts }), ...patch });
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const Q_YES = 'Will the Federal Reserve cut interest rates before the end of 2027?';
