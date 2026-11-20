// Deterministic stand-ins (MODE=fake and tests): no network, no spend. They return the same
// shapes as the live adapters so the real parsing and rules are what the tests exercise.
import { createHash } from 'node:crypto';
import { DAY, isoDay, startOfUtcDay } from '../util.mjs';

const h = (s) => createHash('sha256').update(s).digest().readUInt32BE(0);
const endOfMonth = (ms) => {
  const d = new Date(ms);
  return isoDay(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
};

/** Same response shape as the Decisions API. Judges the form with a few patterns. */
export function makeFakeJev() {
  return {
    async decide(body) {
      const t = String(body.state.question).toLowerCase();
      const p = { fine: 0.9, past: 0.02, opinion: 0.02, private: 0.02, harmful: 0.01, vague: 0.02, other: 0.01 };
      const bump = (k) => {
        p[k] = 0.85;
        p.fine = 0.05;
      };
      if (/\b(already|last year|yesterday|used to)\b/.test(t)) bump('past');
      else if (/\b(better|prettier|tastiest|ought|moral)\b/.test(t)) bump('opinion');
      else if (/\b(everything|the future|anything|life)\b/.test(t) && t.split(' ').length < 7) bump('vague');
      else if (/\b(blorp|asdf|lorem)\b/.test(t)) bump('other');
      const sum = Object.values(p).reduce((a, b) => a + b, 0);
      for (const k of Object.keys(p)) p[k] /= sum;
      const kind = /\bwhich|who will win\b/.test(t)
        ? 'categorical'
        : /\bhow (much|many)|what will .* (be|reach)\b/.test(t)
          ? 'numerical'
          : 'binary';
      const kinds = { binary: 0.05, categorical: 0.05, numerical: 0.05, date: 0.05 };
      kinds[kind] = 0.85;
      const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1])[0][0];
      return {
        answers: {
          form: { choice: top(p), confidence: Math.max(...Object.values(p)), probabilities: p },
          kind: { choice: top(kinds), confidence: 0.85, probabilities: kinds },
        },
      };
    },
  };
}

export function makeFakeForecaster({ delayMs = 3000, now = Date.now } = {}) {
  const runs = new Map();
  return {
    async sharpen(text) {
      const t = text.trim();
      const lower = t.toLowerCase();
      const title = (t[0].toUpperCase() + t.slice(1)).replace(/[?.!\s]*$/, '?');
      const today = now();
      const draft = {
        title,
        title_reason: null,
        title_as_written: t,
        description: `The question asks: ${title} It is settled by a public source on the resolution date.`,
        resolution_criteria: 'Resolves by the figure or result published by the relevant official source on the resolution date.',
        kind: 'binary',
        close_date: endOfMonth(startOfUtcDay(today) + 180 * DAY),
        close_dates: [],
        lower_bound: null,
        upper_bound: null,
        unit: null,
        cutpoints: [],
        options: [],
        condition: null,
        unresolved: [],
      };
      const year = lower.match(/\b(20\d\d)\b/);
      if (year) draft.close_date = `${year[1]}-12-31`;
      if (/\bsoon\b/.test(lower)) {
        // could not fill the date at all
        draft.close_date = null;
        draft.unresolved = [{ field: 'close_date', reason: 'Say by when you mean by "soon".' }];
      }
      if (/\bprobably by\b/.test(lower)) {
        // filled the date with a guess and flagged it for the person to check
        draft.unresolved = [{ field: 'close_date', reason: `No date was given; I used ${draft.close_date}, so please check it.` }];
      }
      if (/\btomorrow\b/.test(lower)) draft.close_date = isoDay(today + DAY);
      if (/\btoday|tonight\b/.test(lower)) draft.close_date = isoDay(today);
      if (/\bif\b.+\bthen\b/.test(lower)) draft.condition = 'a condition';
      if (/\bwhen will\b/.test(lower)) draft.kind = 'date';
      if (/\bwhich\b/.test(lower)) {
        draft.kind = 'categorical';
        draft.options = ['Option one', 'Option two', 'Other'];
        const m = t.match(/which of (.+?)(?: will|\?|$)/i);
        if (m) {
          const named = m[1].split(/,| or | and /).map((s) => s.trim()).filter(Boolean);
          if (named.length >= 2) draft.options = [...named, 'Other'];
        }
      } else if (/\bhow (much|many)\b/.test(lower)) {
        draft.kind = 'numerical';
        draft.lower_bound = 0;
        draft.upper_bound = 1000;
        draft.unit = /\bdollar|usd|price\b/.test(lower) ? 'USD' : 'units';
      }
      return draft;
    },

    async forecast(q) {
      const id = `fake-${h(q.title + Date.now() + Math.random())}`;
      runs.set(id, { q, at: now() });
      return id;
    },

    async status(id) {
      const r = runs.get(id);
      if (!r) return { state: 'failed', reason: 'gone' };
      if (/\bfail\b/i.test(r.q.title)) return { state: 'failed', reason: 'failed' };
      if (now() - r.at < delayMs) return { state: 'running' };
      const seed = h(r.q.title);
      const { q } = r;
      if (q.kind === 'binary') return { state: 'ready', raw: { value: (5 + (seed % 90)) / 100 } };
      if (q.kind === 'categorical') {
        const w = q.options.map((_, i) => 1 + ((seed >> (i * 3)) % 7));
        const sum = w.reduce((a, b) => a + b, 0);
        return {
          state: 'ready',
          raw: { option_chances: q.options.map((o, i) => ({ option: o, probability: w[i] / sum })) },
        };
      }
      const span = q.upper_bound - q.lower_bound;
      const median = q.lower_bound + span * (0.2 + (seed % 50) / 100);
      return {
        state: 'ready',
        raw: { value: median, low: median - span * 0.08, high: median + span * 0.12, unit: q.unit },
      };
    },
  };
}
