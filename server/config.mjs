import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

const expand = (p) => (p?.startsWith('~') ? resolve(homedir(), p.slice(2)) : p);

function num(env, key, fallback) {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/** Loads .env (if present) without a dependency, then reads settings. `overrides` wins; used by tests. */
export function loadConfig(overrides = {}, env = process.env) {
  const envFile = resolve(process.cwd(), '.env');
  const merged = { ...env };
  if (existsSync(envFile) && env === process.env) {
    for (const line of readFileSync(envFile, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && merged[m[1]] === undefined) merged[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
  }
  const e = merged;
  const mode = e.MODE === 'live' ? 'live' : 'fake';

  const cfg = {
    mode,
    port: num(e, 'PORT', 8787),
    publicBaseUrl: (e.PUBLIC_BASE_URL || 'http://localhost:8787').replace(/\/$/, ''),
    dbPath: e.DB_PATH || './data/wishes.db',
    adminToken: e.ADMIN_TOKEN || '',
    trustProxy: e.TRUST_PROXY === '1',
    wishMaxUsd: num(e, 'WISH_MAX_USD', 2),
    dailyLimit: num(e, 'DAILY_WISH_LIMIT', 25),
    checksPerHour: num(e, 'CHECKS_PER_HOUR', 20),
    wishTimeoutMin: num(e, 'WISH_TIMEOUT_MIN', 45),
    wishRetries: num(e, 'WISH_RETRIES', 1),
    invitesPerUser: num(e, 'INVITES_PER_USER', 0),
    maxHorizonDays: num(e, 'MAX_HORIZON_DAYS', 1095),
    minHorizonDays: num(e, 'MIN_HORIZON_DAYS', 7),
    wishesPerPerson: 3,
    checkTtlMin: 30,
    reentryHours: 24,
    maxDevices: 3,
    pollMs: num(e, 'POLL_MS', 15_000),
    forecaster: {
      baseUrl: (e.FORECASTER_BASE_URL || '').replace(/\/$/, ''),
      token: e.FORECASTER_TOKEN || '',
      tokenFile: expand(e.FORECASTER_TOKEN_FILE || '~/.config/foundation-forecasts/token'),
      org: e.FORECASTER_ORG || '',
      depth: e.FORECASTER_DEPTH || 'light',
      draftWaitMs: num(e, 'DRAFT_WAIT_MS', 60_000),
    },
    jev: {
      apiKey: e.JEV_API_KEY || '',
      endpoint: e.JEV_ENDPOINT || 'https://openrouter.ai/api/alpha/decisions',
      model: e.JEV_MODEL || 'typesafe/jev-1.14',
      minProb: num(e, 'JEV_MIN_PROB', 0.5),
      timeoutMs: num(e, 'JEV_TIMEOUT_MS', 4000),
    },
    decider: {
      // 'jev' | 'bedrock' | 'none'. Empty: Jev if it has a key, else Bedrock (live mode only).
      provider: e.DECIDER || '',
      model: e.DECIDER_MODEL || 'us.anthropic.claude-haiku-5-5',
      region: e.AWS_REGION || e.AWS_DEFAULT_REGION || 'us-east-1',
      timeoutMs: num(e, 'DECIDER_TIMEOUT_MS', 8000),
    },
    vapid: {
      publicKey: e.VAPID_PUBLIC_KEY || '',
      privateKey: e.VAPID_PRIVATE_KEY || '',
      subject: e.VAPID_SUBJECT || 'mailto:ops@example.com',
    },
  };
  return deepMerge(cfg, overrides);
}

function deepMerge(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object' ? deepMerge(a[k], v) : v;
  }
  return out;
}

/** Reads the forecaster token at the moment of use; never logged. */
export function readForecasterToken(cfg) {
  if (cfg.forecaster.token) return cfg.forecaster.token;
  try {
    return readFileSync(cfg.forecaster.tokenFile, 'utf8').trim();
  } catch {
    return '';
  }
}
