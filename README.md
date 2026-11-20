# 3 wishes

An invite-only iPhone app. Three questions about the future, answered on a lever. The only brand
on screen is the logo; nothing says who we are, what we do or how an answer was made.

The product and technical spec is in [SPEC.md](SPEC.md). This file is how to run it.

## Check it yourself

1. **On this machine, no spend:** `npm run demo` prints three invitation links. Open one in Chrome with
   the device toolbar set to an iPhone (or any narrow window). Fake forecasts arrive in four seconds.
2. **On a real iPhone, no spend:** `npm run demo:tunnel` does the same behind a temporary https
   address (Cloudflare quick tunnel; it exists only while the command runs). Open a link in Safari,
   **Share → Add to Home Screen**, open the new icon, type the code it showed. Try the lever, share
   a result to Messages (the link shows a preview picture), and ask a question it should refuse.
3. **Real forecasts:** `MODE=live npm run demo:tunnel` (uses the dev dashboard and your token file; set `DAILY_WISH_LIMIT` to cap the day). Each wish now costs real money (up to
   `WISH_MAX_USD`, twice if a run has to be retried) and takes about 9 minutes at `light` depth.
4. **See the pieces work:** `npm test` (72 tests), `npm run test:e2e` (the whole flow in a browser, with
   screenshots), `npm run decider-check` (sixteen labelled questions through the real form check),
   `node scripts/live-smoke.mjs` (one real wish).

## Run it (no keys, no spend)

```bash
npm install
npm run assets                 # only if public/brand or public/icons are missing
MODE=fake PORT=8787 npm start  # or: npm run dev
node bin/admin.mjs invite --count 3 --note "me"   # prints codes and links
```

Open `http://localhost:8787/i/<code>` on a phone-sized browser. Fake mode uses a deterministic
forecaster and decision model; a wish is ready in about three seconds. Try: a yes/no question
("Will the Fed cut rates before the end of 2027?"), a choice ("Which of A, B or C will win…?"),
a number ("How much will a barrel of Brent cost on 30 June 2027?"), something it should refuse
("Which is the prettier city?"), and "…soon?" (too vague).

## Tests

```bash
npm test                # 72 tests: logic, API, brand rules, leak checks. No browser, no network.
npm run test:e2e        # drives the whole app in a phone-sized Chromium; screenshots in test/e2e/shots
```

`test:e2e` needs Chromium (`npx playwright-core install chromium`) and its system libraries. On a
box without them, `apt-get download` the packages and point `LD_LIBRARY_PATH` at the extracted
folder, as was done here.

## Live mode (the real forecaster)

```bash
cp .env.example .env     # then set MODE=live and the values below
```

| Setting | What |
|---|---|
| `FORECASTER_BASE_URL`, `FORECASTER_TOKEN` or `FORECASTER_TOKEN_FILE`, `FORECASTER_ORG` | The forecasting dashboard API, a token, and the organization wishes are created in. Questions appear there, owned by the token's person. |
| `FORECASTER_DEPTH` | `light` (default), `medium`, `deep`. Deeper costs more and takes longer. |
| `WISH_MAX_USD`, `DAILY_WISH_LIMIT`, `WISH_RETRIES` | Spend caps. A wish costs at most `WISH_MAX_USD × (1 + WISH_RETRIES)`; a day at most `DAILY_WISH_LIMIT` of those. |
| `DECIDER` (`bedrock`, `jev`, `none`), `DECIDER_MODEL` | The decision model that checks a question's form. Empty means Jev if `JEV_API_KEY` is set, else **Bedrock**: Claude Haiku 5.5 (`us.anthropic.claude-haiku-5-5`) through a forced structured answer, using the environment's AWS role (no key to manage). |
| `JEV_API_KEY` (+ `JEV_ENDPOINT`, `JEV_MODEL`, `JEV_MIN_PROB`) | Only for `DECIDER=jev`. `JEV_MIN_PROB` is the threshold for both deciders. |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Web Push ("Your wish is ready"). `npm run vapid` makes a pair. |
| `PUBLIC_BASE_URL`, `TRUST_PROXY`, `ADMIN_TOKEN` | Address in share links (use https), proxy trust, and the token for `/admin/stats`. |

One real wish, end to end, capped by `WISH_MAX_USD`:

```bash
MODE=live node scripts/live-smoke.mjs "Will the US Federal Reserve lower its target federal funds rate at its December 2026 meeting?"
```

## Putting it on an iPhone

A PWA needs https. For a test, a Cloudflare quick tunnel to the local port works
(`cloudflared tunnel --url http://localhost:8787`, then set `PUBLIC_BASE_URL` to its address).
For real use, deploy the container (`Dockerfile`; mount `/data`) behind https.

On the phone: open the invitation link in Safari, **Share → Add to Home Screen**, open the new icon
and type the code shown (iOS keeps the installed app's storage apart from Safari's, so the code
works from a second place for 24 hours). Notifications ("Your wish is ready") need the installed
app, iOS 16.4 or later, and the VAPID keys.

## Day to day

```bash
node bin/admin.mjs invite --count 20 --note "batch 2"   # new invitations
node bin/admin.mjs stats                                # people, wishes, turned away
node bin/admin.mjs wishes --status failed               # what was given back, and why
curl -H "X-Admin-Token: $ADMIN_TOKEN" $PUBLIC_BASE_URL/admin/stats
```

`GET /healthz` answers `ok` for a load balancer. Bump `CACHE` in `public/sw.js` when you change a
client file, so installed apps pick it up.

## Where things are

```
SPEC.md                      the spec
server/gate.mjs              is this a question we can answer? (rules, Jev, sharpening, validation)
server/wishes.mjs            spending, launching, retrying, refunding
server/sanitize.mjs          the allowlist: all a person ever sees of a question or an answer
server/adapters/             jev, forecaster (dashboard API), fakes
server/og.mjs                the share picture (also the link preview)
public/lib/lever.js          the lever: geometry and drawing, shared by the phone and the picture
public/app.js, lever-view.js the screens and the pull
public/brand/                the Foundation kit's files, used as they are (Hanken Grotesk stands in for Univers Next)
```

## What has and has not been checked

Checked here: the whole flow in a phone-sized Chromium against the fake forecaster; 72 automated
tests, including the one-wish-per-seal rule, refunds on failure, timeout and launch errors, the daily
cap, isolation between people, that nothing about method or cost reaches a client, and the brand
rules (one gold star, no gradients or shadows, kit palette and type); the real dashboard's
sharpening step and the launch, status and refund path.

Not checked: a real iPhone (install, Home Screen cookie behaviour, share sheet, Web Push, haptics),
the Jev API itself (no key was available), the tunnel command, the Docker image, and any load. The Bedrock form check was run on sixteen labelled questions: 15 as labelled, and the other turned away for a different but fair reason; about 1.2 s a call.
