import { createHash, randomBytes, randomUUID } from 'node:crypto';

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const sha256 = (s) => createHash('sha256').update(s).digest('hex');
export const token = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const uuid = () => randomUUID();

// No 0, O, 1, I or L: easy to read out loud and to type.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function makeCode() {
  const bytes = randomBytes(8);
  let out = '';
  for (let i = 0; i < 8; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}
export function normalizeCode(raw) {
  const c = String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return c.length === 8 ? `${c.slice(0, 4)}-${c.slice(4)}` : null;
}

export const DAY = 86_400_000;
export const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
export const startOfUtcDay = (ms) => Math.floor(ms / DAY) * DAY;
export function daysBetween(fromMs, isoDate) {
  const t = Date.parse(`${isoDate}T00:00:00Z`);
  return Number.isNaN(t) ? NaN : Math.floor((t - startOfUtcDay(fromMs)) / DAY);
}

export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
export const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

// A small fixed-window limiter, in memory. Enough for one process.
export function makeLimiter(now = Date.now) {
  const hits = new Map();
  return function take(key, limit, windowMs) {
    const t = now();
    const arr = (hits.get(key) ?? []).filter((x) => t - x < windowMs);
    if (arr.length >= limit) {
      hits.set(key, arr);
      return false;
    }
    arr.push(t);
    hits.set(key, arr);
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.length || t - v[v.length - 1] > windowMs) hits.delete(k);
    return true;
  };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function parseCookies(header = '') {
  const out = {};
  for (const part of String(header).split(';')) {
    const i = part.indexOf('=');
    if (i > 0) {
      try {
        out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        /* a malformed value is ignored, never an error */
      }
    }
  }
  return out;
}
