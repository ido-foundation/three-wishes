// Apple Push Notification service, for the native iPhone app. Token-based (a .p8 key from the Apple
// Developer account), HTTP/2, no dependency. Off until the key, its id, the team id and the app's
// bundle id are configured; tokens are stored anyway, so turning it on later reaches everyone.
import { createPrivateKey, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import http2 from 'node:http2';

const HOSTS = { production: 'https://api.push.apple.com', sandbox: 'https://api.sandbox.push.apple.com' };
const b64 = (x) => Buffer.from(x).toString('base64url');

function readKey(cfg) {
  if (cfg.key) return cfg.key.includes('BEGIN') ? cfg.key : cfg.key.replace(/\\n/g, '\n');
  if (cfg.keyFile) {
    try {
      return readFileSync(cfg.keyFile, 'utf8');
    } catch {
      return '';
    }
  }
  return '';
}

export function makeApns(cfg, { connect = http2.connect, now = Date.now } = {}) {
  const pem = readKey(cfg);
  const enabled = !!(pem && cfg.keyId && cfg.teamId && cfg.bundleId);
  let jwt = null;
  let jwtAt = 0;
  const sessions = new Map();

  /** Apple wants a fresh provider token between 20 and 60 minutes old. */
  function bearer() {
    if (!jwt || now() - jwtAt > 50 * 60_000) {
      const head = b64(JSON.stringify({ alg: 'ES256', kid: cfg.keyId }));
      const body = b64(JSON.stringify({ iss: cfg.teamId, iat: Math.floor(now() / 1000) }));
      const sig = sign('sha256', Buffer.from(`${head}.${body}`), { key: createPrivateKey(pem), dsaEncoding: 'ieee-p1363' });
      jwt = `${head}.${body}.${b64(sig)}`;
      jwtAt = now();
    }
    return jwt;
  }

  function session(env) {
    let s = sessions.get(env);
    if (!s || s.closed || s.destroyed) {
      s = connect(HOSTS[env]);
      const drop = () => sessions.delete(env);
      s.on('error', drop);
      s.on('close', drop);
      sessions.set(env, s);
    }
    return s;
  }

  return {
    enabled,

    /** Sends one alert. Resolves { ok, status, reason }; `dead` says the token should be forgotten. */
    send(device, payload) {
      if (!enabled || !HOSTS[device.env]) return Promise.resolve({ ok: false, status: 0, reason: 'off', dead: false });
      return new Promise((resolve) => {
        let settled = false;
        const done = (r) => {
          if (settled) return;
          settled = true;
          resolve({ ...r, dead: r.status === 410 || (r.status === 400 && /BadDeviceToken|DeviceTokenNotForTopic/.test(r.reason)) });
        };
        try {
          const req = session(device.env).request({
            ':method': 'POST',
            ':path': `/3/device/${device.token}`,
            authorization: `bearer ${bearer()}`,
            'apns-topic': cfg.bundleId,
            'apns-push-type': 'alert',
            'apns-priority': '10',
            'content-type': 'application/json',
          });
          let status = 0;
          let data = '';
          req.setEncoding('utf8');
          req.on('response', (h) => {
            status = h[':status'];
          });
          req.on('data', (c) => {
            data += c;
          });
          req.on('end', () => {
            let reason = '';
            try {
              reason = JSON.parse(data).reason ?? '';
            } catch {
              /* a 200 has no body */
            }
            done({ ok: status === 200, status, reason });
          });
          req.on('error', () => done({ ok: false, status: 0, reason: 'network' }));
          req.setTimeout?.(10_000, () => {
            req.close?.();
            done({ ok: false, status: 0, reason: 'timeout' });
          });
          req.end(JSON.stringify(payload));
        } catch {
          done({ ok: false, status: 0, reason: 'network' });
        }
      });
    },

    close() {
      for (const s of sessions.values()) s.close?.();
      sessions.clear();
    },
  };
}
