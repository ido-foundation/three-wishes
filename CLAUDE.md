# 3 wishes / "III"

Invite-only iPhone app: three questions about the future, answered by Foundation's forecasting model, shown on a
dial with a gold star. Read `SPEC.md` first (product, rules, architecture). `README.md` has run/test/deploy.

## Commands

```bash
npm install
npm test                  # 99 tests, no network, no browser
npm run demo              # fake forecasts, no spend: prints invitation links (http://localhost:8787)
npm run test:e2e          # whole flow in a phone-sized Chromium (needs: npx playwright-core install chromium)
npm run decider-check     # sixteen labelled questions through the real form check (needs AWS credentials; pennies)
node scripts/live-smoke.mjs "Will ...?"   # one REAL forecast, ~$1, minutes (needs the forecaster token)
node bin/admin.mjs invite --count 3       # invitation codes
```

## Rules that must keep holding

- Exactly three questions per person; a failed run gives the question back (`server/wishes.mjs`).
- Nothing the person sees names a method, model, provider, cost or the forecaster; all answer data goes through
  the allowlist in `server/sanitize.mjs`. `test/api/leak.test.mjs` scans every served file and response.
- Brand: Foundation kit on near-black `#040405`, chalk `#F2E9E4`, ONE gold star (the lever arm's).
  No gradients, glows, shadows, no other stars. `test/unit/brand.test.mjs`.
- User-facing words are question / ask / answer; "wish" only exists inside the code and database.
- The web app is the product. `ios/` is a thin native shell (push, haptics, share sheet).

## The iPhone app

The iPhone 18 Pro simulator build was verified with Xcode 27.2. See `ios/MAC-SETUP.md` for setup.

## Secrets and money

No secrets are in this repo. The live forecaster token and AWS access live on the machine that runs the server.
Real forecasts cost about $0.80 each; `WISH_MAX_USD` and `DAILY_WISH_LIMIT` cap it.
