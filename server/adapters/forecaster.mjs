// The live forecaster: the Foundation Forecasts dashboard API, acting as the identity of its token.
// Three calls matter: sharpen (Quick Create draft), forecast (create + launch) and status.
// Nothing here leaves the server: the caller sanitizes (server/sanitize.mjs) before anyone sees it.
import { readForecasterToken } from '../config.mjs';
import { isNum, sleep } from '../util.mjs';

function fail(code, status) {
  const err = new Error(`forecaster ${code}${status ? ` ${status}` : ''}`);
  err.code = status ? `${code}_${status}` : code;
  return err;
}

export function makeForecaster(config, fetchImpl = fetch) {
  const f = config.forecaster;

  async function call(method, path, body, { timeoutMs = 30_000 } = {}) {
    const tok = readForecasterToken(config);
    if (!f.baseUrl || !tok) throw fail('not_configured');
    const headers = { Authorization: `Bearer ${tok}`, Accept: 'application/json' };
    if (f.org) headers['X-Forecasting-Org'] = f.org;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(`${f.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (res.status === 204) return null;
      if (!res.ok) throw fail('http', res.status);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    /** One sentence in, a precise draft out (or an error). Deletes the draft afterwards. */
    async sharpen(text) {
      const started = await call('POST', '/v1/quick-create/drafts', { text });
      const deadline = Date.now() + f.draftWaitMs;
      try {
        while (Date.now() < deadline) {
          await sleep(2500);
          const list = await call('GET', '/v1/quick-create/drafts');
          const mine = (Array.isArray(list) ? list : []).find((d) => d.id === started.id);
          if (mine?.state === 'ready') return mine.draft;
          if (mine?.state === 'failed' || mine?.error) throw fail('draft_failed');
        }
        throw fail('draft_timeout');
      } finally {
        call('DELETE', `/v1/quick-create/drafts/${started.id}`).catch(() => {});
      }
    },

    /** Creates the question and launches its one baseline run. Returns the forecaster's id. */
    async forecast(q) {
      const body = {
        title: q.title,
        description: q.description,
        resolution_criteria: q.resolution_criteria,
        kind: q.kind,
        close_date: q.close_date,
        cadence: 'once',
        runs: 'single',
        depth: f.depth,
        // No max_seconds: the forecaster refuses a time limit it did not choose ("does not allow the
        // time limit this launch chose"). WISH_TIMEOUT_MIN is our own backstop, in server/wishes.mjs.
        max_usd: config.wishMaxUsd,
        launch: true,
      };
      if (q.kind === 'categorical') body.options = q.options;
      if (q.kind === 'numerical') {
        body.lower_bound = q.lower_bound;
        body.upper_bound = q.upper_bound;
        if (q.unit) body.unit = q.unit;
      }
      const created = await call('POST', '/v1/questions', body, { timeoutMs: 60_000 });
      if (!created?.id) throw fail('no_id');
      return created.id;
    },

    /** { state: 'running' } | { state: 'failed', reason } | { state: 'ready', raw } */
    async status(id) {
      const d = await call('GET', `/v1/questions/${encodeURIComponent(id)}`);
      if (d.blocked) return { state: 'failed', reason: 'blocked' };
      const runs = [...(d.runs ?? [])].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
      const run = runs[0];
      if (!run || run.state === 'queued' || run.state === 'running') return { state: 'running' };
      if (run.state === 'failed' || run.state === 'stopped') return { state: 'failed', reason: run.state };
      const hasAnswer = isNum(d.value) || (Array.isArray(d.option_chances) && d.option_chances.length > 0);
      if (!hasAnswer) return { state: 'running' };
      return {
        state: 'ready',
        raw: {
          value: d.value,
          low: d.low,
          high: d.high,
          option_chances: d.option_chances,
          unit: d.unit,
        },
      };
    },
  };
}
