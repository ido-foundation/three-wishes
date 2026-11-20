// The gate: is this a question we can answer, in a form we can answer it (rules R2, R5)?
// 1. rules pre-check (cheap, always)  2. decision model on the form (Jev)  3. sharpening into a
// precise question  4. rules on the precise question. A turned-away question costs no wish.
import { HttpError, daysBetween, isNum, makeLimiter, uuid } from './util.mjs';
import { sanitizeQuestion } from './sanitize.mjs';

export const REASONS = {
  past: 'That has already happened. Ask about what comes next.',
  opinion: "That's a matter of opinion. Ask about something that will be measured or decided.",
  private: "That's about someone's private life. Ask about something public.",
  harmful: "We can't take that one.",
  vague: 'Make it more specific: who, what and by when.',
  other: 'Ask about something that might happen.',
  length: 'Ask in a sentence or two.',
};

const FORM_CRITERIA = {
  fine: 'A question about a specific future event or measurable quantity that a public source will settle by a known date.',
  past: 'About something that has already happened, or a fact that is already known today.',
  opinion: 'A matter of opinion, taste, morality or advice, not an observable outcome.',
  private: "About a private individual's personal life, relationships or a non-public matter.",
  harmful: 'Asks about harming a person, self-harm, weapons, sexual content or helping with a crime.',
  vague: 'Too vague or broad to settle: no clear event, actor, quantity or time.',
  other: 'Not a question about the future, or gibberish.',
};

const KIND_CRITERIA = {
  binary: 'Whether something will or will not happen.',
  categorical: 'Which one of several named outcomes will happen.',
  numerical: 'How much or how many: a number.',
  date: 'When something will happen.',
};

export function buildJevRequest(text, model) {
  return {
    model,
    state: {
      question: text,
      context:
        'A person asked a question about the future. Judge only its form: can a public source settle it later? ' +
        'Do not judge whether the premise is true.',
    },
    questions: {
      form: { type: 'choice', instructions: 'What kind of question is `question`?', criteria: FORM_CRITERIA },
      kind: { type: 'choice', instructions: 'What kind of answer does `question` ask for?', criteria: KIND_CRITERIA },
    },
  };
}

/** Reads a decisions-API answer into { fine, reason, kind }. Throws on a shape we do not know. */
export function readJev(resp) {
  const answers = resp?.answers ?? resp?.data?.answers;
  const form = answers?.form?.probabilities;
  if (!form || typeof form !== 'object' || !isNum(form.fine)) {
    throw new Error('unexpected decision answer');
  }
  const reasons = Object.entries(form)
    .filter(([k, p]) => k !== 'fine' && REASONS[k] && isNum(p))
    .sort((a, b) => b[1] - a[1]);
  const kinds = Object.entries(answers?.kind?.probabilities ?? {}).sort((a, b) => b[1] - a[1]);
  return { fine: form.fine, reason: reasons[0]?.[0] ?? 'other', kind: kinds[0]?.[0] ?? null };
}

const HARMFUL = /\b(kill(ed|ing|s)?|murder(ed|s)?|assassinat\w*|suicid\w*|self[- ]?harm|rape|bomb[- ]making|how to (make|build) a (bomb|weapon))\b/i;
const PRIVATE = /\b(my|our)\s+(wife|husband|boyfriend|girlfriend|partner|ex|mom|mum|dad|mother|father|brother|sister|son|daughter|boss|friend|neighbou?r|crush|date|roommate)\b/i;
const OPINION = /\b(should i|am i|is it (good|bad|worth)|what('s| is) the best|which is better|do you think|your opinion)\b/i;
const PAST = /^(who|what|when|where|why|how)\s+(was|were|did|had)\b/i;

/** The cheap pre-check: obvious cases without a model. Returns a reason key or null. */
export function rulesPrecheck(text) {
  if (text.length < 8 || text.length > 300) return 'length';
  if (HARMFUL.test(text)) return 'harmful';
  if (PRIVATE.test(text)) return 'private';
  if (OPINION.test(text)) return 'opinion';
  if (PAST.test(text)) return 'past';
  if (!/[a-z]{3}/i.test(text)) return 'other';
  return null;
}

export function normalizeText(raw) {
  return String(raw ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * The rules on a sharpened question (docs: the dashboard's topic-questions). Returns
 * { ok: true, question } or { ok: false, reason, hints } where reason is a REASONS key or a code.
 */
export function validateDraft(draft, { now, minDays, maxDays }) {
  const hints = [];
  const fail = (reason, message) => ({ ok: false, reason, message, hints });

  if (!draft || typeof draft !== 'object') return fail('vague', REASONS.vague);

  // The sharpening step may fill a field with its best guess and flag it for the person to check
  // ("no date given; I used 9 Dec"). That is a note to show on the review screen, where the
  // question and its date are in plain view. A field it could not fill fails the checks below.
  if (Array.isArray(draft.unresolved)) {
    for (const u of draft.unresolved.slice(0, 3)) {
      const r = String(u?.reason ?? '').replace(/\s+/g, ' ').trim().slice(0, 240);
      if (r) hints.push(r);
    }
  }
  if (draft.condition) {
    return fail('conditional', 'Ask it without the "if". One question at a time.');
  }
  if (draft.kind === 'date') {
    return fail('date', 'Ask it as a yes or no by a date, or as a number.');
  }
  if (!['binary', 'categorical', 'numerical'].includes(draft.kind)) return fail('vague', REASONS.vague);

  const title = String(draft.title ?? '').trim();
  if (title.length < 8 || title.length > 400) return fail('vague', REASONS.vague);
  if (!String(draft.resolution_criteria ?? '').trim()) return fail('vague', REASONS.vague);

  const days = daysBetween(now, draft.close_date);
  if (Number.isNaN(days)) return fail('vague', REASONS.vague);
  if (days < minDays) return fail('soon', 'That has already settled, or settles today. Ask about tomorrow or later.');
  if (days > maxDays) return fail('far', "That's too far out. Ask about the next three years.");

  const q = {
    title,
    description: String(draft.description ?? '').trim(),
    resolution_criteria: String(draft.resolution_criteria).trim(),
    kind: draft.kind,
    close_date: draft.close_date,
    options: [],
    unit: null,
    lower_bound: null,
    upper_bound: null,
  };

  if (draft.kind === 'categorical') {
    const opts = [...new Set((draft.options ?? []).map((o) => String(o).trim()).filter(Boolean))];
    if (opts.length < 2 || opts.length > 20) return fail('vague', 'Name the choices: two or more, in one question.');
    q.options = opts;
  }
  if (draft.kind === 'numerical') {
    if (!isNum(draft.lower_bound) || !isNum(draft.upper_bound) || draft.lower_bound >= draft.upper_bound) {
      return fail('vague', 'Say what is being counted or measured, and in what unit.');
    }
    q.lower_bound = draft.lower_bound;
    q.upper_bound = draft.upper_bound;
    q.unit = String(draft.unit ?? '').trim().slice(0, 24) || null;
  }
  return { ok: true, question: q, notes: hints };
}

export function makeGate({ db, config, jev, forecaster, now = Date.now, log = console }) {
  const take = makeLimiter(now);

  async function check(userId, rawText) {
    const text = normalizeText(rawText);

    if (!take(`check:${userId}`, config.checksPerHour, 3_600_000)) {
      throw new HttpError(429, 'slow_down', 'Take a moment, then ask again.');
    }

    const record = (verdict, question = null) => {
      const id = uuid();
      db.prepare('insert into checks(id, user_id, text, verdict, question_json, created_at) values(?, ?, ?, ?, ?, ?)').run(
        id,
        userId,
        text,
        verdict,
        question ? JSON.stringify(question) : null,
        now(),
      );
      return id;
    };
    const no = (reason, message = REASONS[reason]) => {
      record('no');
      return { verdict: 'no', reason, message };
    };

    const pre = rulesPrecheck(text);
    if (pre) return no(pre);

    if (jev) {
      try {
        const read = readJev(await jev.decide(buildJevRequest(text, config.jev.model)));
        // "Vague" is not final: the sharpening step may still settle on a date and an event, and
        // says what it assumed. Every other reason (past, opinion, private, harmful) is.
        if (read.fine < config.jev.minProb && read.reason !== 'vague') return no(read.reason);
      } catch (err) {
        log.warn?.(`form check unavailable: ${err.code ?? err.name}`);
        // fall through: the sharpening step and the rules below still apply
      }
    }

    let draft;
    try {
      draft = await forecaster.sharpen(text);
    } catch (err) {
      log.warn?.(`sharpen failed: ${err.code ?? err.name}`);
      throw new HttpError(503, 'unavailable', 'The line is busy. Try again in a moment.');
    }

    const res = validateDraft(draft, {
      now: now(),
      minDays: config.minHorizonDays,
      maxDays: config.maxHorizonDays,
    });
    if (!res.ok) {
      record('fix');
      return { verdict: 'fix', reason: res.reason, message: res.message, hints: res.hints };
    }
    const checkId = record('ok', res.question);
    return { verdict: 'ok', checkId, question: sanitizeQuestion(res.question), notes: res.notes };
  }

  return { check };
}
