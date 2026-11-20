// A demo you can open on a phone.
//   npm run demo           fake forecasts, no spend, on http://localhost:8787
//   npm run demo:tunnel    the same, behind a temporary https address (Cloudflare quick tunnel)
//   MODE=live npm run demo:tunnel   real forecasts: each question costs real money (see WISH_MAX_USD)
// To restart the app but keep the same address and people: DEMO_BASE_URL=<the https address> DEMO_DB=<the .db file> npm run demo
// It prints invitation links. Ctrl-C stops it, and the tunnel with it.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/index.mjs';

const port = Number(process.env.PORT ?? 8787);
const tunnel = process.argv.includes('--tunnel');
const live = process.env.MODE === 'live';

let base = process.env.DEMO_BASE_URL?.replace(/\/$/, '') || `http://localhost:${port}`;
let child = null;
if (tunnel && !process.env.DEMO_BASE_URL) {
  child = spawn(process.env.CLOUDFLARED ?? 'cloudflared', ['tunnel', '--no-autoupdate', '--url', `http://localhost:${port}`], { stdio: ['ignore', 'ignore', 'pipe'] });
  base = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no tunnel address after 40 s')), 40_000);
    let buf = '';
    child.stderr.on('data', (d) => {
      buf += d;
      const m = buf.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (m) {
        clearTimeout(timer);
        resolve(m[0]);
      }
    });
    child.on('error', reject);
    child.on('exit', () => reject(new Error('the tunnel stopped')));
  }).catch((e) => {
    console.error(`could not open a tunnel: ${e.message}`);
    child?.kill();
    process.exit(1);
  });
}

const app = await createApp({
  mode: live ? 'live' : 'fake',
  port,
  dbPath: process.env.DEMO_DB || join(mkdtempSync(join(tmpdir(), 'wishes-demo-')), 'demo.db'),
  publicBaseUrl: base,
  fakeDelayMs: 4000,
  pollMs: 3000,
  invitesPerUser: 1,
  // Live mode reads the dashboard from the environment; the dev dashboard and the Foundation org are the defaults here.
  forecaster: { baseUrl: process.env.FORECASTER_BASE_URL || 'https://dashboard.dev.foundationresearch.ai', org: process.env.FORECASTER_ORG || 'foundation' },
});
await app.listen(port, process.env.DEMO_HOST);
// Keep the codes already given out; make three more only if there are none left to use.
let codes = app.db.prepare('select code from invites where user_id is null order by created_at').all().map((r) => r.code);
if (!codes.length) codes = app.deps.auth.createInvites({ count: 3, note: 'demo' });

console.log(`\n3 questions, ${live ? 'LIVE (real forecasts, real spend)' : 'demo (fake forecasts, no spend)'}${live ? `, form check: ${app.decider}` : ''}`);
console.log(`\n  open on the phone:\n`);
for (const c of codes) console.log(`    ${base}/i/${c}`);
console.log(`\n  codes: ${codes.join('  ')}  (each is one person; Ctrl-C to stop)\n`);
if (tunnel) console.log('  On an iPhone: open a link in Safari, Share > Add to Home Screen, then open the icon and type the code.\n');

const stop = async () => {
  child?.kill();
  await app.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
