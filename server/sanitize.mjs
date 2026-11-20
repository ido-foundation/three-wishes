// The allowlist (rule R4). Everything the client or a share page sees about a question or an
// answer is built here, field by field, from what the forecaster returned. Nothing is passed
// through: a new field upstream cannot reach a person until it is added here on purpose.
import { clamp, isNum } from './util.mjs';

const KINDS = new Set(['binary', 'categorical', 'numerical']);
const MAX_OPTIONS = 12;

const str = (x, max) => (typeof x === 'string' ? x.replace(/\s+/g, ' ').trim().slice(0, max) : '');

export function sanitizeQuestion(q) {
  if (!q || !KINDS.has(q.kind)) return null;
  const out = {
    title: str(q.title, 400),
    kind: q.kind,
    close_date: /^\d{4}-\d{2}-\d{2}$/.test(q.close_date ?? '') ? q.close_date : null,
  };
  const criteria = str(q.resolution_criteria, 700);
  if (criteria) out.criteria = criteria;
  if (q.kind === 'categorical') out.options = (q.options ?? []).map((o) => str(o, 120)).filter(Boolean).slice(0, 20);
  if (q.kind === 'numerical') out.unit = str(q.unit, 24) || null;
  return out;
}

/** The part of a forecast a person may see, as a plain object of numbers and option names. */
export function sanitizeAnswer(kind, raw) {
  if (!raw || !KINDS.has(kind)) return null;

  if (kind === 'binary') {
    let p = raw.value;
    if (!isNum(p)) return null;
    if (p > 1 && p <= 100) p /= 100;
    return { kind, p: round(clamp(p, 0, 1), 4) };
  }

  if (kind === 'categorical') {
    const list = (raw.option_chances ?? [])
      .filter((o) => o && typeof o.option === 'string' && isNum(o.probability) && o.probability >= 0)
      .map((o) => ({ label: str(o.option, 120), p: o.probability }));
    const sum = list.reduce((s, o) => s + o.p, 0);
    if (!list.length || sum <= 0) return null;
    let options = list
      .map((o) => ({ label: o.label, p: o.p / sum }))
      .sort((a, b) => b.p - a.p);
    if (options.length > MAX_OPTIONS) {
      const rest = options.slice(MAX_OPTIONS - 1).reduce((s, o) => s + o.p, 0);
      options = [...options.slice(0, MAX_OPTIONS - 1), { label: 'Other', p: rest }];
    }
    options = options.map((o) => ({ label: o.label, p: round(o.p, 4) }));
    return { kind, options, leading: options[0].label };
  }

  // numerical
  const median = raw.value;
  if (!isNum(median)) return null;
  const out = { kind, median, unit: str(raw.unit, 24) || null };
  if (isNum(raw.low) && isNum(raw.high) && raw.low <= median && median <= raw.high && raw.low < raw.high) {
    out.low = raw.low;
    out.high = raw.high;
  }
  return out;
}

/** What the owner sees of one of their wishes. */
export function ownWish(row, { baseUrl = '' } = {}) {
  const question = sanitizeQuestion(JSON.parse(row.question_json));
  const out = {
    id: row.id,
    status: row.status === 'sealed' ? 'running' : row.status,
    refunded: !!row.refunded,
    question,
    created_at: row.created_at,
    done_at: row.done_at,
    revealed: !!row.revealed_at,
  };
  if (row.status === 'ready' && row.result_json) {
    out.answer = JSON.parse(row.result_json);
    out.share_url = `${baseUrl}/w/${row.share_token}`;
  }
  return out;
}

/** What anyone with the link sees: the question as sharpened, and the answer. No person, no wish text. */
export function publicWish(row) {
  if (!row || row.status !== 'ready' || !row.result_json) return null;
  return {
    question: sanitizeQuestion(JSON.parse(row.question_json)),
    answer: JSON.parse(row.result_json),
    done_at: row.done_at,
  };
}

const round = (x, d) => Math.round(x * 10 ** d) / 10 ** d;
