// End to end, in a phone-sized browser, against the fake forecaster (no spend).
//   npm run test:e2e            screenshots land in test/e2e/shots (override with SHOTS=dir)
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, devices } from 'playwright-core';
import { createApp } from '../../server/index.mjs';

const SHOTS = resolve(process.env.SHOTS ?? 'test/e2e/shots');
mkdirSync(SHOTS, { recursive: true });
const dir = mkdtempSync(join(tmpdir(), 'wishes-e2e-'));

const app = await createApp(
  { mode: 'fake', dbPath: join(dir, 'e2e.db'), fakeDelayMs: 1200, pollMs: 400, adminToken: 'e2e', publicBaseUrl: 'http://127.0.0.1:0' },
  { log: { warn() {}, error: console.error } },
);
const port = await app.listen(0);
const base = `http://127.0.0.1:${port}`;
app.config.publicBaseUrl = base;
const [code] = app.deps.auth.createInvites({ count: 1, note: 'e2e' });

const browser = await chromium.launch();
const device = devices['iPhone 14'] ?? devices['iPhone 13'];
const problems = [];
let step = 0;
const log = (m) => console.log(`  ✓ ${m}`);

async function newPage(context) {
  const page = await context.newPage();
  page.on('console', (m) => {
    if (['error', 'warning'].includes(m.type()) && !/favicon|Failed to load resource.*(400|401|404|409)/.test(m.text())) problems.push(`console ${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  return page;
}
const shot = async (page, name) => {
  await page.waitForTimeout(500); // let the entrance animation finish
  await page.screenshot({ path: join(SHOTS, `${String(++step).padStart(2, '0')}-${name}.png`) });
};

try {
  const ctx = await browser.newContext({ ...device, permissions: ['clipboard-read', 'clipboard-write'], baseURL: base });
  const page = await newPage(ctx);

  console.log('invitation');
  await page.goto('/');
  await page.waitForSelector('.lockup');
  assert.equal(await page.locator('.field.code').count(), 1);
  await shot(page, 'gate');
  await page.fill('.field.code', 'AAAA-BBBB');
  await page.click('button[type=submit]');
  await page.waitForFunction(() => document.querySelector('.error')?.textContent.includes("doesn't work"));
  log('a wrong code is refused with one quiet line');
  await page.fill('.field.code', code);
  await page.click('button[type=submit]');
  await page.waitForSelector('textarea.field');
  assert.match(await page.locator('.label').first().innerText(), /Three questions left/i);
  await shot(page, 'home');
  log('the right code opens the app with three questions');

  console.log('a question we cannot answer');
  await page.fill('textarea.field', 'Which is the prettier city, Paris or Rome?');
  await page.click('button[type=submit]');
  await page.waitForSelector('text=Change it');
  await shot(page, 'refused');
  assert.match(await page.locator('.title').innerText(), /opinion/i);
  assert.equal((await (await page.request.get('/api/me')).json()).left, 3);
  log('turned away, and no question was used');
  await page.click('text=Change it');

  console.log('a vague question');
  await page.fill('textarea.field', 'Will the economy recover soon?');
  await page.click('button[type=submit]');
  await page.waitForSelector('text=Change it');
  await shot(page, 'vague');
  log('vague wording gets the hints and no question is used');
  await page.click('text=Change it');

  console.log('the question as the dashboard shows it');
  await page.fill('textarea.field', 'Will bitcoin close above 150000 dollars next year?');
  await page.click('button[type=submit]');
  await page.waitForSelector('text=Yes, ask it');
  assert.match(await page.locator('.view').innerText(), /YES \/ NO\s*·\s*RESOLVES ON 31 DEC 2027/i);
  assert.match(await page.locator('.view').innerText(), /You wrote:/);
  assert.match(await page.locator('.view').innerText(), /Resolution criteria/i);
  await shot(page, 'review-dashboard');
  log('kind, resolution date, what we changed and why, resolution criteria');
  await page.click('text=Change it');
  await page.waitForSelector('textarea.field');

  console.log('a yes / no question, start to finish');
  await page.fill('textarea.field', 'Will the Federal Reserve cut interest rates before the end of 2027?');
  await page.click('button[type=submit]');
  await page.waitForSelector('text=Yes, ask it');
  await shot(page, 'review');
  assert.match(await page.locator('.title').innerText(), /Federal Reserve/);
  await page.click('text=Yes, ask it');
  await page.waitForSelector('text=Thinking');
  await shot(page, 'waiting');
  log('asked; one star goes out');
  await page.waitForSelector('text=Turn the dial', { timeout: 20_000 });
  await shot(page, 'lever-rest');
  assert.equal(await page.locator('.figure.hidden').count(), 1);
  await page.click('button:has-text("Reveal")');
  await page.waitForSelector('.dialbox .ripple');
  assert.equal(await page.locator('.figure.hidden').count(), 1, 'the figure stays hidden while the first ring locks');
  await page.waitForSelector('.figure:not(.hidden)');
  await page.waitForTimeout(3300);
  await shot(page, 'lever-yes');
  const figure = await page.locator('.figure').innerText();
  assert.match(figure, /^\d+%$/);
  log(`the lever settles on ${figure}`);

  console.log('sharing');
  const shareUrl = await page.evaluate(async () => {
    const me = await (await fetch('/api/me')).json();
    return me.wishes[0].share_url;
  });
  await page.click('button:has-text("Share")');
  await page.waitForSelector('text=Link copied');
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), shareUrl);
  log('no share sheet in this browser: the link is copied');
  const card = await page.request.get(`${shareUrl}/card.png`);
  assert.equal(card.status(), 200);
  assert.equal(card.headers()['content-type'], 'image/png');
  log('the share picture renders');

  console.log('a question that fails is given back');
  await page.click('button.back');
  await page.waitForSelector('textarea.field');
  await page.fill('textarea.field', 'Will this wish fail before the end of 2027?');
  await page.click('button[type=submit]');
  await page.waitForSelector('text=Yes, ask it');
  await page.click('text=Yes, ask it');
  await page.waitForSelector("text=couldn't be answered", { timeout: 30_000 });
  await shot(page, 'returned');
  const afterFail = await (await page.request.get('/api/me')).json();
  assert.equal(afterFail.left, 2);
  log('failed, returned: two questions left');
  await page.click('text=Ask again');

  console.log('a choice question');
  await page.fill('textarea.field', 'Which of Likud, Yesh Atid or National Unity will win the most seats in 2027?');
  await page.click('button[type=submit]');
  await page.waitForSelector('text=Yes, ask it');
  await shot(page, 'review-choice');
  await page.click('text=Yes, ask it');
  await page.waitForSelector('text=Turn the dial', { timeout: 20_000 });
  // turn the dial with a finger: a circle and a half round the middle
  const box = await page.locator('.dialbox svg').boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const R = box.width * 0.33;
  await page.mouse.move(cx, cy - R);
  await page.mouse.down();
  for (let i = 1; i <= 36; i++) {
    const a = (i / 36) * Math.PI * 1.7;
    await page.mouse.move(cx + R * Math.sin(a), cy - R * Math.cos(a));
    if (i === 14) await shot(page, 'dial-turning');
  }
  await page.mouse.up();
  await page.waitForTimeout(1000);
  await shot(page, 'dial-locking');
  await page.waitForTimeout(2600);
  await shot(page, 'lever-choice');
  assert.ok((await page.locator('.rank li').count()) >= 3);
  log('turned with a finger, the dial locks and the ring is cut by option');

  console.log('a number question, the last one');
  await page.click('button.back');
  await page.fill('textarea.field', 'How much will a barrel of Brent crude cost on 30 June 2027?');
  await page.click('button[type=submit]');
  await page.waitForSelector('text=Yes, ask it');
  await shot(page, 'review-last');
  await page.click('text=Yes, ask it');
  await page.waitForSelector('text=Turn the dial', { timeout: 20_000 });
  await page.click('button:has-text("Reveal")');
  await page.waitForTimeout(3300);
  await shot(page, 'lever-number');
  assert.match(await page.locator('.reading .sub').innerText(), /80% likely between/);
  await page.click('button.back');
  await page.waitForSelector("text=You've asked all three.");
  await shot(page, 'home-done');
  assert.equal(await page.locator('textarea.field').count(), 0);
  log('three questions asked: the input is gone');

  const over = await page.evaluate(async () => (await fetch('/api/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'Will the Fed cut rates in 2027?' }) })).status);
  assert.equal(over, 200); // checking is free; sealing is what is limited
  const seal = await page.evaluate(async () => {
    const r = await (await fetch('/api/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'Will the Fed cut rates in 2027?' }) })).json();
    const s = await fetch('/api/seal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ checkId: r.checkId }) });
    return s.status;
  });
  assert.equal(seal, 409);
  log('a fourth wish is refused by the server');

  console.log('a shared link, in a fresh browser');
  const ctx2 = await browser.newContext({ ...device, baseURL: base });
  const p2 = await newPage(ctx2);
  await p2.goto(new URL(shareUrl).pathname);
  await p2.waitForSelector('text=Turn the dial');
  await shot(p2, 'shared-rest');
  await p2.click('button:has-text("Reveal")');
  await p2.waitForTimeout(3300);
  await shot(p2, 'shared-lever');
  assert.match(await p2.locator('.figure').innerText(), /^\d+%$/);
  const head = await p2.evaluate(() => document.querySelector('meta[property="og:image"]')?.content);
  assert.match(head, /\/card\.png$/);
  log('anyone with the link pulls the lever; the preview picture is set');
  assert.equal((await p2.request.get('/api/me')).status(), 401);
  log('and the link gives no access to the app');

  console.log('an invitation link, opened in Safari on an iPhone');
  const [code2] = app.deps.auth.createInvites({ count: 1 });
  const ctx3 = await browser.newContext({ ...device, baseURL: base });
  const p3 = await newPage(ctx3);
  await p3.goto(`/i/${code2}`);
  await p3.waitForSelector('text=Continue here');
  assert.equal(await p3.locator('.code-show').innerText(), code2);
  assert.equal(new URL(p3.url()).pathname, '/', 'the code is not left in the address bar');
  await shot(p3, 'install');
  await p3.click('text=Continue here');
  await p3.waitForSelector('textarea.field');
  log('the code is shown for the Home Screen app, and Continue goes on in Safari');
  const ctx4 = await browser.newContext({ ...device, baseURL: base });
  const p4 = await newPage(ctx4);
  await p4.goto('/');
  await p4.fill('.field.code', code2.toLowerCase());
  await p4.click('button[type=submit]');
  await p4.waitForSelector('textarea.field');
  log('typing it in a second browser (the Home Screen app) signs in the same person');
  await ctx3.close();
  await ctx4.close();

  console.log('inside the iPhone app (a simulated native shell)');
  const [code5] = app.deps.auth.createInvites({ count: 1 });
  const ctx5 = await browser.newContext({ ...device, userAgent: `${device.userAgent} III-iOS/1.0`, baseURL: base });
  await ctx5.addInitScript(() => {
    window.__native = [];
    window.webkit = { messageHandlers: { native: { postMessage: (m) => window.__native.push(m) } } };
  });
  const p5 = await newPage(ctx5);
  const sent = () => p5.evaluate(() => window.__native);
  await p5.goto('/');
  await p5.waitForSelector('.lockup');
  assert.equal(await p5.locator('.install').count(), 0, 'no "Add to Home Screen" inside the app');
  await p5.fill('.field.code', code5);
  await p5.click('button[type=submit]');
  await p5.waitForSelector('textarea.field');
  assert.ok((await sent()).some((m) => m.type === 'ready'), 'tells the shell the person is signed in');
  await p5.fill('textarea.field', 'Will the Federal Reserve cut interest rates before the end of 2027?');
  await p5.click('button[type=submit]');
  await p5.waitForSelector('text=Yes, ask it');
  await p5.click('text=Yes, ask it');
  await p5.waitForSelector('text=Thinking');
  assert.ok((await sent()).some((m) => m.type === 'push'), 'asks for permission to notify once there is something to wait for');
  log('signed in, and asks for notifications after the first question');
  await p5.evaluate(() => window.nativePush('ab'.repeat(32), 'sandbox'));
  await p5.waitForTimeout(300);
  assert.equal(app.db.prepare('select count(*) as n from devices').get().n, 1);
  log("the phone's push token reaches the server");
  await p5.waitForSelector('text=Turn the dial', { timeout: 20_000 });
  const b5 = await p5.locator('.dialbox svg').boundingBox();
  const [mx, my, mr] = [b5.x + b5.width / 2, b5.y + b5.height / 2, b5.width * 0.33];
  await p5.mouse.move(mx, my - mr);
  await p5.mouse.down();
  for (let i = 1; i <= 40; i++) {
    const a = (i / 40) * Math.PI * 1.7;
    await p5.mouse.move(mx + mr * Math.sin(a), my - mr * Math.cos(a));
  }
  await p5.mouse.up();
  await p5.waitForTimeout(3600);
  const styles = (await sent()).filter((m) => m.type === 'haptic').map((m) => m.style);
  assert.ok(styles.filter((x) => x === 'selection').length >= 5, `a click as the dial turns (${styles.join(',')})`);
  assert.ok(styles.includes('rigid') && styles.includes('heavy') && styles.at(-1) === 'success', 'rings lock with a knock, then a success');
  log(`haptics: ${styles.length} (clicks while turning, a knock for each ring, then success)`);
  await p5.click('button:has-text("Share")');
  const share = (await sent()).find((m) => m.type === 'share');
  assert.match(share.url, /\/w\/[\w-]+$/);
  assert.match(share.image, /\/w\/[\w-]+\/card\.png$/);
  assert.equal(await p5.locator('text=Link copied').count(), 0, 'the native share sheet, not the clipboard');
  log('Share opens the native sheet with the picture and the link');
  await ctx5.close();

  console.log('install metadata');
  const manifest = await (await page.request.get('/manifest.webmanifest')).json();
  assert.equal(manifest.display, 'standalone');
  const sw = await page.request.get('/sw.js');
  assert.equal(sw.headers()['service-worker-allowed'], '/');
  log('manifest and service worker are served');
} catch (err) {
  problems.push(`FAILED: ${err.stack ?? err}`);
} finally {
  await browser.close();
  await app.close();
  rmSync(dir, { recursive: true, force: true });
}

if (problems.length) {
  console.error(`\n${problems.length} problem(s):\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log(`\nall good. screenshots: ${SHOTS}`);
