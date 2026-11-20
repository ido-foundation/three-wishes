// Web Push for the installed app (iOS 16.4+). Off unless a VAPID pair is configured.
export async function makePush({ db, config, now = Date.now, log = console }) {
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
      if (!enabled) return 0;
      const subs = db.prepare('select * from pushes where user_id = ?').all(userId);
      const payload = JSON.stringify({ title: 'III', body: 'Your answer is ready.', url: `/?w=${wishId}` });
      let sent = 0;
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
