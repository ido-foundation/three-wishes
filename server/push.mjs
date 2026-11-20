// Web Push for the installed app (iOS 16.4+). Off unless a VAPID pair is configured.
import { makeApns } from './apns.mjs';

export async function makePush({ db, config, now = Date.now, log = console, apns = makeApns(config.apns ?? {}) }) {
  const v = config.vapid;
  const enabled = !!(v.publicKey && v.privateKey);
  let webpush = null;
  if (enabled) {
    webpush = (await import('web-push')).default;
    webpush.setVapidDetails(v.subject, v.publicKey, v.privateKey);
  }

  return {
    enabled,
    publicKey: enabled ? v.publicKey : null,
    nativeEnabled: !!apns.enabled,

    /** The native app's APNs token. `env` is the APNs environment the build was signed for. */
    registerDevice(userId, token, env) {
      if (typeof token !== 'string' || !/^[0-9a-f]{64,200}$/i.test(token) || !['sandbox', 'production'].includes(env)) return false;
      db.prepare(
        `insert into devices(token, user_id, env, created_at) values(?, ?, ?, ?)
         on conflict(token) do update set user_id = excluded.user_id, env = excluded.env`,
      ).run(token.toLowerCase(), userId, env, now());
      return true;
    },

    subscribe(userId, sub) {
      const ok =
        sub &&
        typeof sub.endpoint === 'string' &&
        sub.endpoint.startsWith('https://') &&
        sub.endpoint.length < 1000 &&
        typeof sub.keys?.p256dh === 'string' &&
        typeof sub.keys?.auth === 'string';
      if (!ok) return false;
      db.prepare(
        `insert into pushes(endpoint, user_id, sub_json, created_at) values(?, ?, ?, ?)
         on conflict(endpoint) do update set user_id = excluded.user_id, sub_json = excluded.sub_json`,
      ).run(sub.endpoint, userId, JSON.stringify({ endpoint: sub.endpoint, keys: sub.keys }), now());
      return true;
    },

    async notify(userId, { wishId }) {
      let sent = 0;
      const url = `/?w=${wishId}`;
      // The native app, through Apple.
      for (const d of db.prepare('select * from devices where user_id = ?').all(userId)) {
        const r = await apns.send(d, {
          aps: { alert: { title: 'III', body: 'Your answer is ready.' }, sound: 'default', 'thread-id': 'answers' },
          url,
        });
        if (r.ok) sent++;
        else if (r.dead) db.prepare('delete from devices where token = ?').run(d.token);
        else if (r.reason !== 'off') log.warn?.(`apns failed: ${r.status} ${r.reason}`);
      }
      // The Home Screen web app, through Web Push.
      if (!enabled) return sent;
      const subs = db.prepare('select * from pushes where user_id = ?').all(userId);
      const payload = JSON.stringify({ title: 'III', body: 'Your answer is ready.', url });
      for (const s of subs) {
        try {
          await webpush.sendNotification(JSON.parse(s.sub_json), payload, { TTL: 86_400 });
          sent++;
        } catch (err) {
          if (err.statusCode === 404 || err.statusCode === 410) {
            db.prepare('delete from pushes where endpoint = ?').run(s.endpoint);
          } else {
            log.warn?.(`push failed: ${err.statusCode ?? err.name}`);
          }
        }
      }
      return sent;
    },
  };
}
