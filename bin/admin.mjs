#!/usr/bin/env node
// Invitations and numbers, from the command line.
//   node bin/admin.mjs invite --count 20 --note "friends"   print new invitation codes
//   node bin/admin.mjs stats                                counts
//   node bin/admin.mjs wishes [--status failed]             recent wishes (the question, never the answer)
import { loadConfig } from '../server/config.mjs';
import { openDb } from '../server/db.mjs';
import { makeAuth } from '../server/auth.mjs';

const [cmd, ...rest] = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : fallback;
};

const config = loadConfig();
const db = openDb(config.dbPath);
const auth = makeAuth({ db, config });

if (cmd === 'invite') {
  const count = Math.max(1, Math.min(500, Number(flag('count', 1)) || 1));
  for (const code of auth.createInvites({ count, note: flag('note', null) })) console.log(`${code}   ${config.publicBaseUrl}/i/${code}`);
} else if (cmd === 'stats') {
  console.log(JSON.stringify(auth.stats(), null, 2));
} else if (cmd === 'wishes') {
  const status = flag('status', null);
  const rows = db
    .prepare(`select id, user_id, status, kind, refunded, error, created_at, text from wishes ${status ? 'where status = ?' : ''} order by created_at desc limit 50`)
    .all(...(status ? [status] : []));
  for (const r of rows) console.log(`${new Date(r.created_at).toISOString()}  #${r.user_id}  ${r.status}${r.refunded ? ' (refunded)' : ''}${r.error ? ` [${r.error}]` : ''}  ${r.kind}  ${r.text}`);
} else {
  console.log('usage: admin.mjs invite [--count N] [--note TEXT] | stats | wishes [--status S]');
  process.exitCode = 1;
}
db.close();
