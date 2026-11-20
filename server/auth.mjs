import { HttpError, makeCode, normalizeCode, sha256, token } from './util.mjs';
import { tx } from './db.mjs';

const BAD_CODE = "That code doesn't work.";

export function makeAuth({ db, config, now = Date.now }) {
  function createInvites({ count = 1, note = null, issuedBy = null } = {}) {
    const codes = [];
    const insert = db.prepare('insert into invites(code, created_at, note, issued_by) values(?, ?, ?, ?)');
    while (codes.length < count) {
      const code = makeCode();
      try {
        insert.run(code, now(), note, issuedBy);
        codes.push(code);
      } catch {
        /* a collision on an 8-character code: draw again */
      }
    }
    return codes;
  }

  function newSession(userId) {
    const tok = token();
    db.prepare('insert into sessions(token_hash, user_id, created_at, last_seen) values(?, ?, ?, ?)').run(
      sha256(tok),
      userId,
      now(),
      now(),
    );
    return tok;
  }

  /** Redeems an invitation. First use creates the person; later use, within the window, adds a device. */
  function redeem(rawCode) {
    const code = normalizeCode(rawCode);
    if (!code) throw new HttpError(400, 'invalid_code', BAD_CODE);
    return tx(db, () => {
      const inv = db.prepare('select * from invites where code = ?').get(code);
      if (!inv) throw new HttpError(400, 'invalid_code', BAD_CODE);
      const t = now();
      if (!inv.user_id) {
        const { lastInsertRowid } = db
          .prepare('insert into users(created_at, invite_code, wishes_total) values(?, ?, ?)')
          .run(t, code, config.wishesPerPerson);
        const userId = Number(lastInsertRowid);
        db.prepare('update invites set user_id = ?, redeemed_at = ? where code = ?').run(userId, t, code);
        if (config.invitesPerUser > 0) createInvites({ count: config.invitesPerUser, note: 'given', issuedBy: userId });
        return { userId, token: newSession(userId), created: true };
      }
      const within = t - inv.redeemed_at < config.reentryHours * 3_600_000;
      const devices = db.prepare('select count(*) as n from sessions where user_id = ?').get(inv.user_id).n;
      if (!within || devices >= config.maxDevices) throw new HttpError(400, 'invalid_code', BAD_CODE);
      return { userId: inv.user_id, token: newSession(inv.user_id), created: false };
    });
  }

  function authenticate(tok) {
    if (!tok) return null;
    const row = db
      .prepare('select s.user_id as id from sessions s where s.token_hash = ?')
      .get(sha256(tok));
    if (!row) return null;
    db.prepare('update sessions set last_seen = ? where token_hash = ?').run(now(), sha256(tok));
    return { id: row.id };
  }

  function givenInvites(userId) {
    return db
      .prepare('select code from invites where issued_by = ? and user_id is null order by created_at')
      .all(userId)
      .map((r) => r.code);
  }

  function stats() {
    const one = (sql) => db.prepare(sql).get().n;
    return {
      invitesIssued: one('select count(*) as n from invites'),
      invitesRedeemed: one('select count(*) as n from invites where user_id is not null'),
      people: one('select count(*) as n from users'),
      wishesSealed: one('select count(*) as n from wishes'),
      wishesReady: one("select count(*) as n from wishes where status = 'ready'"),
      wishesFailed: one("select count(*) as n from wishes where status = 'failed'"),
      wishesRunning: one("select count(*) as n from wishes where status in ('sealed','running')"),
      checks: one('select count(*) as n from checks'),
      checksTurnedAway: one("select count(*) as n from checks where verdict != 'ok'"),
    };
  }

  return { createInvites, redeem, authenticate, givenInvites, stats };
}
