// Wishes: spending, launching, settling, refunding (rules R1, R3, R7).
import { HttpError, startOfUtcDay, token, uuid } from './util.mjs';
import { tx } from './db.mjs';
import { ownWish, publicWish, sanitizeAnswer } from './sanitize.mjs';

const MAX_LAUNCH_ATTEMPTS = 3;

export function makeWishes({ db, config, forecaster, push, now = Date.now, log = console }) {
  const total = (userId) => db.prepare('select wishes_total as n from users where id = ?').get(userId)?.n ?? 0;
  const spent = (userId) =>
    db.prepare('select count(*) as n from wishes where user_id = ? and refunded = 0').get(userId).n;
  const remaining = (userId) => Math.max(0, total(userId) - spent(userId));

  /** Spends one wish on a checked question. All or nothing. */
  function seal(userId, checkId) {
    const wish = tx(db, () => {
      const t = now();
      const check = db
        .prepare('select * from checks where id = ? and user_id = ? and verdict = ?')
        .get(String(checkId ?? ''), userId, 'ok');
      if (!check || check.used || t - check.created_at > config.checkTtlMin * 60_000) {
        throw new HttpError(410, 'expired', 'That question has expired. Ask it again.');
      }
      if (remaining(userId) <= 0) throw new HttpError(409, 'none_left', 'You have used your three wishes.');
      const today = db
        .prepare('select count(*) as n from wishes where sealed_at >= ?')
        .get(startOfUtcDay(t)).n;
      if (today >= config.dailyLimit) {
        throw new HttpError(409, 'daily_cap', 'Wishes are paused until tomorrow. Come back then.');
      }
      const question = JSON.parse(check.question_json);
      const id = uuid();
      db.prepare(
        `insert into wishes(id, user_id, text, question_json, kind, status, share_token, created_at, sealed_at)
         values(?, ?, ?, ?, ?, 'sealed', ?, ?, ?)`,
      ).run(id, userId, check.text, check.question_json, question.kind, token(16), t, t);
      db.prepare('update checks set used = 1 where id = ?').run(check.id);
      return db.prepare('select * from wishes where id = ?').get(id);
    });
    launch(wish.id).catch((err) => log.warn?.(`launch error: ${err.code ?? err.name}`));
    return wish;
  }

  async function launch(id) {
    const w = db.prepare('select * from wishes where id = ?').get(id);
    if (!w || w.status !== 'sealed' || w.forecast_id) return;
    db.prepare('update wishes set launch_attempts = launch_attempts + 1 where id = ?').run(id);
    try {
      const forecastId = await forecaster.forecast(JSON.parse(w.question_json));
      db.prepare("update wishes set forecast_id = ?, status = 'running' where id = ?").run(forecastId, id);
    } catch (err) {
      const attempts = w.launch_attempts + 1;
      log.warn?.(`launch failed (${attempts}): ${err.code ?? err.name}`);
      if (attempts >= MAX_LAUNCH_ATTEMPTS) fail(id, 'launch');
    }
  }

  function fail(id, reason) {
    db.prepare(
      "update wishes set status = 'failed', refunded = 1, error = ?, done_at = ? where id = ? and status in ('sealed','running')",
    ).run(String(reason).slice(0, 40), now(), id);
  }

  async function settleOne(w) {
    const t = now();
    if (t - w.sealed_at > config.wishTimeoutMin * 60_000) return fail(w.id, 'timeout');
    if (w.status === 'sealed') {
      // A launch that never completed (the process stopped, or it failed before the limit): try again.
      if (!w.forecast_id) return launch(w.id);
      db.prepare("update wishes set status = 'running' where id = ?").run(w.id);
    }
    if (!w.forecast_id) return;
    let st;
    try {
      st = await forecaster.status(w.forecast_id);
    } catch (err) {
      log.warn?.(`status check failed: ${err.code ?? err.name}`);
      return; // try again on the next tick; the timeout above is the backstop
    }
    if (st.state === 'failed') {
      if (w.retries < config.wishRetries) {
        // Start again as a new forecast; the person sees "running" throughout.
        db.prepare("update wishes set forecast_id = null, status = 'sealed', launch_attempts = 0, retries = retries + 1 where id = ?").run(w.id);
        return launch(w.id);
      }
      return fail(w.id, st.reason ?? 'failed');
    }
    if (st.state !== 'ready') return;
    const answer = sanitizeAnswer(w.kind, st.raw);
    if (!answer) return fail(w.id, 'empty');
    db.prepare("update wishes set status = 'ready', result_json = ?, done_at = ? where id = ?").run(
      JSON.stringify(answer),
      now(),
      w.id,
    );
    if (!w.notified) {
      db.prepare('update wishes set notified = 1 where id = ?').run(w.id);
      push?.notify(w.user_id, { wishId: w.id }).catch(() => {});
    }
  }

  let ticking = false;
  /** One pass over every unfinished wish. Safe to call from a timer or a test. */
  async function tick() {
    if (ticking) return;
    ticking = true;
    try {
      const open = db.prepare("select * from wishes where status in ('sealed','running') order by sealed_at").all();
      for (const w of open) await settleOne(w);
    } finally {
      ticking = false;
    }
  }

  const row = (userId, id) => db.prepare('select * from wishes where id = ? and user_id = ?').get(String(id), userId);

  return {
    remaining,
    seal,
    tick,
    launch,
    forUser(userId) {
      const rows = db.prepare('select * from wishes where user_id = ? order by created_at desc').all(userId);
      return rows.map((r) => ownWish(r, { baseUrl: config.publicBaseUrl }));
    },
    get(userId, id) {
      const r = row(userId, id);
      return r ? ownWish(r, { baseUrl: config.publicBaseUrl }) : null;
    },
    reveal(userId, id) {
      const r = row(userId, id);
      if (!r || r.status !== 'ready') return false;
      db.prepare('update wishes set revealed_at = coalesce(revealed_at, ?) where id = ?').run(now(), r.id);
      return true;
    },
    byShareToken(tok) {
      const r = db.prepare('select * from wishes where share_token = ?').get(String(tok ?? ''));
      return r ? publicWish(r) : null;
    },
  };
}
