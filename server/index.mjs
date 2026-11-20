import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';

import { loadConfig } from './config.mjs';
import { openDb } from './db.mjs';
import { HttpError, makeLimiter, parseCookies } from './util.mjs';
import { makeAuth } from './auth.mjs';
import { makeGate } from './gate.mjs';
import { makeWishes } from './wishes.mjs';
import { makePush } from './push.mjs';
import { makeCards } from './og.mjs';
import { makeJev } from './adapters/jev.mjs';
import { makeBedrockDecider } from './adapters/bedrock.mjs';
import { makeForecaster } from './adapters/forecaster.mjs';
import { makeFakeForecaster, makeFakeJev } from './adapters/fakes.mjs';
import { esc, leverModel } from '../public/lib/lever.js';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PUBLIC = join(ROOT, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ttf': 'font/ttf',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

const CSP = [
  "default-src 'self'",
  "img-src 'self' data:",
  "style-src 'self'",
  "script-src 'self'",
  "connect-src 'self'",
  "font-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join('; ');

export async function createApp(overrides = {}, { now = Date.now, log = console, deps = {} } = {}) {
  const config = loadConfig(overrides);
  const db = openDb(config.dbPath);
  const live = config.mode === 'live';

  const decider = live ? config.decider.provider || (config.jev.apiKey ? 'jev' : 'bedrock') : 'fake';
  const jev =
    deps.jev !== undefined
      ? deps.jev
      : decider === 'jev'
        ? makeJev(config.jev)
        : decider === 'bedrock'
          ? await makeBedrockDecider(config.decider)
          : decider === 'fake'
            ? makeFakeJev()
            : null;
  const forecaster =
    deps.forecaster ?? (live ? makeForecaster(config) : makeFakeForecaster({ delayMs: config.fakeDelayMs ?? 3000, now }));
  const push = deps.push ?? (await makePush({ db, config, now, log }));
  const auth = makeAuth({ db, config, now });
  const gate = makeGate({ db, config, jev, forecaster, now, log });
  const wishes = makeWishes({ db, config, forecaster, push, now, log });
  const cards = makeCards({ publicDir: PUBLIC });
  const redeemLimit = makeLimiter(now);
  const inflight = new Set();

  const secure = config.publicBaseUrl.startsWith('https://');
  const originHost = new URL(config.publicBaseUrl).host;

  const clientIp = (req) =>
    (config.trustProxy && String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim()) || req.socket.remoteAddress || '?';

  /** No Origin header (a script, an app): fine. One that is not this site, or not a URL: refused. */
  function sameOrigin(origin) {
    if (!origin) return true;
    try {
      const u = new URL(origin);
      return u.host === originHost || u.hostname === 'localhost' || u.hostname === '127.0.0.1';
    } catch {
      return false;
    }
  }

  function headers(extra = {}) {
    return {
      'Content-Security-Policy': CSP,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
      'X-Frame-Options': 'DENY',
      ...extra,
    };
  }

  function send(res, status, body, extra = {}) {
    const isObj = typeof body === 'object' && !Buffer.isBuffer(body) && body !== null;
    const payload = isObj ? JSON.stringify(body) : body;
    res.writeHead(
      status,
      headers({
        'Content-Type': isObj ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
        ...extra,
      }),
    );
    res.end(payload);
  }

  async function readJson(req) {
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > 16_384) throw new HttpError(413, 'too_large', 'Too much.');
      chunks.push(c);
    }
    if (!size) return {};
    try {
      const v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      return v && typeof v === 'object' ? v : {};
    } catch {
      throw new HttpError(400, 'bad_json', 'That did not read.');
    }
  }

  function sessionCookie(tok) {
    return `tw_session=${encodeURIComponent(tok)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=34560000${secure ? '; Secure' : ''}`;
  }

  function user(req) {
    const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
    const u = auth.authenticate(bearer ?? parseCookies(req.headers.cookie).tw_session);
    if (!u) throw new HttpError(401, 'unauthorized', 'Enter your invitation.');
    return u;
  }

  function meView(u) {
    return {
      left: wishes.remaining(u.id),
      total: config.wishesPerPerson,
      wishes: wishes.forUser(u.id),
      invites: auth.givenInvites(u.id),
      push: { enabled: push.enabled, key: push.publicKey },
    };
  }

  async function api(req, res, url) {
    const { pathname } = url;
    const method = req.method;

    if (method === 'POST' && !sameOrigin(req.headers.origin)) throw new HttpError(403, 'forbidden', 'Not allowed.');

    if (method === 'POST' && pathname === '/api/redeem') {
      if (!redeemLimit(`redeem:${clientIp(req)}`, 10, 600_000)) throw new HttpError(429, 'slow_down', 'Try again in a few minutes.');
      const { code } = await readJson(req);
      const r = auth.redeem(code);
      return send(res, 200, { ok: true, created: r.created }, { 'Set-Cookie': sessionCookie(r.token) });
    }

    if (method === 'GET' && pathname === '/api/me') return send(res, 200, meView(user(req)));

    if (method === 'POST' && pathname === '/api/check') {
      const u = user(req);
      if (inflight.has(u.id)) throw new HttpError(429, 'busy', 'One at a time.');
      const { text } = await readJson(req);
      inflight.add(u.id);
      try {
        return send(res, 200, await gate.check(u.id, text));
      } finally {
        inflight.delete(u.id);
      }
    }

    if (method === 'POST' && pathname === '/api/seal') {
      const u = user(req);
      const { checkId } = await readJson(req);
      const w = wishes.seal(u.id, checkId);
      return send(res, 200, { wish: wishes.get(u.id, w.id), left: wishes.remaining(u.id) });
    }

    let m = /^\/api\/wishes\/([0-9a-f-]{36})(\/reveal)?$/.exec(pathname);
    if (m) {
      const u = user(req);
      if (method === 'GET' && !m[2]) {
        const w = wishes.get(u.id, m[1]);
        if (!w) throw new HttpError(404, 'not_found', 'Not found.');
        return send(res, 200, { wish: w, left: wishes.remaining(u.id) });
      }
      if (method === 'POST' && m[2]) {
        if (!wishes.reveal(u.id, m[1])) throw new HttpError(404, 'not_found', 'Not found.');
        return send(res, 200, { ok: true });
      }
    }

    if (method === 'POST' && pathname === '/api/push') {
      const u = user(req);
      const { subscription } = await readJson(req);
      if (!push.subscribe(u.id, subscription)) throw new HttpError(400, 'bad_subscription', 'That did not work.');
      return send(res, 200, { ok: true });
    }

    m = /^\/api\/public\/([A-Za-z0-9_-]{8,64})$/.exec(pathname);
    if (method === 'GET' && m) {
      const w = wishes.byShareToken(m[1]);
      if (!w) throw new HttpError(404, 'not_found', 'Not found.');
      return send(res, 200, w, { 'Cache-Control': 'public, max-age=300' });
    }

    if (method === 'GET' && pathname === '/admin/stats') {
      const given = Buffer.from(String(req.headers['x-admin-token'] ?? ''));
      const want = Buffer.from(config.adminToken);
      if (!config.adminToken || given.length !== want.length || !timingSafeEqual(given, want)) {
        throw new HttpError(404, 'not_found', 'Not found.');
      }
      return send(res, 200, { ...auth.stats(), dailyLimit: config.dailyLimit, mode: config.mode });
    }

    throw new HttpError(404, 'not_found', 'Not found.');
  }

  async function serveFile(res, rel, { cache } = {}) {
    const file = normalize(join(PUBLIC, rel));
    if (file !== PUBLIC && !file.startsWith(PUBLIC + sep)) throw new HttpError(404, 'not_found', 'Not found.');
    let s;
    try {
      s = await stat(file);
    } catch {
      throw new HttpError(404, 'not_found', 'Not found.');
    }
    if (!s.isFile()) throw new HttpError(404, 'not_found', 'Not found.');
    const ext = extname(file);
    const immutable = /^\/?(brand|icons)\//.test(rel);
    res.writeHead(
      200,
      headers({
        'Content-Type': MIME[ext] ?? 'application/octet-stream',
        'Cache-Control': cache ?? (immutable ? 'public, max-age=604800' : 'no-cache'),
        ...(rel === 'sw.js' ? { 'Service-Worker-Allowed': '/' } : {}),
      }),
    );
    res.end(await readFile(file));
  }

  let shell;
  async function shellHtml(meta = '') {
    shell ??= await readFile(join(PUBLIC, 'index.html'), 'utf8');
    // A page with its own <title> (a shared answer) replaces the default one.
    return (meta ? shell.replace(/<title>[^<]*<\/title>/, '') : shell).replace('<!--meta-->', meta);
  }

  async function sharePage(res, tok) {
    const w = wishes.byShareToken(tok);
    if (!w) throw new HttpError(404, 'not_found', 'Not found.');
    const model = leverModel(w.question, w.answer);
    const title = `${model.figure} · ${w.question.title}`.slice(0, 200);
    const meta = [
      `<title>${esc(title)}</title>`,
      `<meta property="og:title" content="${esc(title)}">`,
      `<meta property="og:type" content="website">`,
      `<meta property="og:image" content="${config.publicBaseUrl}/w/${tok}/card.png">`,
      `<meta property="og:image:width" content="1080"><meta property="og:image:height" content="1350">`,
      `<meta name="twitter:card" content="summary_large_image">`,
      `<meta name="twitter:image" content="${config.publicBaseUrl}/w/${tok}/card.png">`,
    ].join('\n');
    res.writeHead(200, headers({ 'Content-Type': MIME['.html'], 'Cache-Control': 'public, max-age=300' }));
    res.end(await shellHtml(meta));
  }

  async function handler(req, res) {
    try {
      const url = new URL(req.url, config.publicBaseUrl);
      const { pathname } = url;

      if (pathname.startsWith('/api/') || pathname === '/admin/stats') return await api(req, res, url);
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'method', 'Not allowed.');

      let m = /^\/w\/([A-Za-z0-9_-]{8,64})\/card\.png$/.exec(pathname);
      if (m) {
        const w = wishes.byShareToken(m[1]);
        if (!w) throw new HttpError(404, 'not_found', 'Not found.');
        const png = await cards.png(`${m[1]}:${w.done_at}`, w.question, w.answer);
        res.writeHead(200, headers({ 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600' }));
        return res.end(png);
      }
      m = /^\/w\/([A-Za-z0-9_-]{8,64})$/.exec(pathname);
      if (m) return await sharePage(res, m[1]);

      if (pathname === '/' || /^\/i\/[A-Za-z0-9-]{4,16}$/.test(pathname)) {
        res.writeHead(200, headers({ 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' }));
        return res.end(await shellHtml());
      }
      if (pathname === '/healthz') return send(res, 200, 'ok');
      if (pathname === '/robots.txt') return send(res, 200, 'User-agent: *\nDisallow: /\n', { 'Cache-Control': 'public, max-age=86400' });
      if (pathname === '/manifest.webmanifest') return await serveFile(res, 'manifest.webmanifest');
      return await serveFile(res, pathname.slice(1));
    } catch (err) {
      if (err instanceof HttpError) {
        return send(res, err.status, { error: { code: err.code, message: err.message } });
      }
      log.error?.(`unhandled: ${err?.name}: ${err?.message}`);
      return send(res, 500, { error: { code: 'error', message: 'Something went wrong.' } });
    }
  }

  const server = createServer(handler);
  let timer = null;

  return {
    config,
    db,
    server,
    decider,
    deps: { auth, gate, wishes, push, forecaster, jev, cards },
    async listen(port = config.port) {
      await new Promise((ok) => server.listen(port, ok));
      if (!deps.noTimer) timer = setInterval(() => wishes.tick().catch(() => {}), config.pollMs);
      timer?.unref?.();
      return server.address().port;
    },
    async close() {
      if (timer) clearInterval(timer);
      await new Promise((ok) => server.close(ok));
      server.closeAllConnections?.();
      db.close();
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = await createApp();
  const port = await app.listen();
  console.log(`three wishes (${app.config.mode}) on http://localhost:${port}`);
  if (app.config.mode === 'live') {
    console.log(`  forecaster: ${app.config.forecaster.baseUrl || 'NOT SET'}  form check: ${app.deps.jev ? app.decider : 'off (rules only)'}`);
  }
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => app.close().then(() => process.exit(0)));
}
