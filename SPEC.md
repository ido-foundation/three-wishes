# Three wishes — product and technical spec

Version 1 · 20 November 2026 · status: built (see README for what was verified)

## 1. What it is

An invite-only iPhone app. Each person gets **three wishes**: three questions about the future,
answered by Foundation's forecasting model. The answer is shown on a **lever**, a dial with a lever
arm, and can be shared as a picture or a link.

It is a marketing stunt (Ido, with Sam Lessin's "I like it"): it is given to a small, chosen set of
people through invitations, in the style of Instinct, and it is meant to spread by itself.

**The app never says who we are or what we do.** The logo is the only brand surface. The app never
says how an answer was reached: no sources, no reasoning, no model, no cost, no method. It shows
the output only.

### Look and name

- **Near-black `#040405`** is the ground, with the kit's chalk `#F2E9E4` and gold `#C9A865`.
  `public/styles.css` sets the interface color and `public/lib/lever.js` supplies the color for share cards and icons.
- **No stars.** No starfield, no star markers. The only star in the app is the gold one on the lever arm,
  which is the kit's "one small star". The three questions are three discs on an orbit round the seal.
- **A vast, faint instrument** (rings and graduations, turning once in about thirteen minutes) sits behind the
  gate, home and review screens, and is hidden while the dial is on screen.
- **The name is "III"** (three questions; the Roman numerals on the kit's dials). Places to change it:
  `public/manifest.webmanifest`, `public/index.html` (title, `apple-mobile-web-app-title`, noscript),
  `public/sw.js` (fallback notification title) and `server/push.mjs`. An installed icon keeps the name it
  was added with, so re-add it after a rename.

### Words people see

The app says **question**, **ask** and **answer**, never "wish" (the working name of the idea). Internally
the code, the database and the API still say "wish". The Home Screen name is "III" (see above). The question is shown as the forecasting dashboard shows it: **Yes / No**, **One of several**
or **A number**; **Resolves on** a date; **Resolution criteria**; and, when the sharpening step reworded
what was typed, "You wrote: …" and why. The answer screen has **How it resolves** (the same criteria).
While a question is being answered the screen says **Thinking**, over the instrument searching.

## 2. Rules that shape every decision

| # | Rule | Where it is enforced |
|---|------|----------------------|
| R1 | Exactly three wishes per person, ever. A wish is spent only when the person seals it. | `server/wishes.mjs`, in one database transaction |
| R2 | A question that is not in a form we can answer never costs a wish and never reaches the forecaster. | `server/gate.mjs` |
| R3 | If a wish fails (the run fails, stops or times out), the wish is given back automatically. | `server/wishes.mjs` `settle()` |
| R4 | Nothing about method leaves the server: results pass through an allowlist. | `server/sanitize.mjs`, `test/unit/sanitize.test.mjs` |
| R5 | No text in the client says "Deus", "Jev", a model name, a provider, "dashboard", or a price. | `test/unit/leak.test.mjs` scans every served file and every API error |
| R6 | Near-black `#040405` with the Foundation palette of chalk `#F2E9E4` and one small gold star `#C9A865`. Flat surfaces, Hanken Grotesk (the kit's free stand-in for Univers Next), sentence case, labels in spaced capitals. | `public/styles.css`, `test/unit/brand.test.mjs` |
| R7 | Spend is capped: per wish and per day. When the day's cap is reached, sealing says "come back tomorrow" and no wish is spent. | `server/config.mjs`, `server/wishes.mjs` |
| R8 | Invite only. No account, no email, no phone number, no analytics, no third-party scripts. | `server/auth.mjs` |

## 3. The person's journey

1. **Invitation.** A person receives a link `/i/ABCD-EFGH` (or a code). The page shows the stacked
   logo and nothing else, plus, in Safari, one icon hint for "Add to Home Screen". The code is
   redeemed when the link opens, and again by typing it inside the installed app (iOS keeps the
   installed app's storage separate from Safari's, so the code works from a second device or
   context for 24 hours after first use, up to three devices).
2. **Home.** The seal in gold at the top, three four-point stars (the wishes: lit, or spent), one
   input, and the person's earlier wishes below as small rows.
3. **Ask.** The person types a question in their own words ("will the Fed cut in March?").
4. **Check.** Three things happen in order, shown as a calm ring animation with no words about how:
   1. *Form check (Jev-style decision model).* Is this a question about a specific future event or
      measurable quantity that a public source will settle? Anything else is turned away at once
      with a one-line reason and, where possible, a better wording to tap.
   2. *Sharpening.* The dashboard's Quick Create reads the sentence and returns a precise question
      with a resolution date and resolution criteria, or lists what is vague.
   3. *Rules.* A date in the allowed window, 2 to 20 options for a choice, bounds and a unit for a
      number, one event not two.
5. **Review.** The person sees the sharpened question as the dashboard shows it (kind, resolution date,
   the question, what was reworded and why, resolution criteria) and what it costs: "This uses one of
   your questions." Buttons: **Yes, ask it** and **Change it**.
6. **Thinking.** The question is asked; one star goes out. The screen shows the instrument thinking: rings
   turning, the gold star searching round the dial, rings of light going out from the middle. The run takes minutes. The person can close
   the app. If they allowed notifications (installed app, iOS 16.4+), a notification says "Your
   wish is ready." Otherwise the app shows it next time it is opened.
7. **The lever.** The answer is not shown at once. The lever rests; the person pulls it (drag, tap
   or press the button). The arm swings with a damped spring and settles on the answer.
8. **Share.** A picture (4:5, night, the question, the lever, the answer, the seal) through the iOS
   share sheet, or a link `/w/<token>` that opens a read-only page with the same lever and a
   preview picture for Messages, WhatsApp and Slack.

## 4. The lever

A dial in the style of the kit's dial studies: thin chalk rings and ticks, labels in spaced
capitals, a vertical axis. A lever arm turns about the centre; its tip is the **gold four-point
star**, the only gold on the screen. No fill, no glow, no shadow.

| Question kind | What the lever shows |
|---|---|
| Yes/No | 0 to 100 around a 270° sweep (ticks every 1, majors every 10, labels 0, 25, 50, 75, 100). The arm points at the chance of Yes. Large figure: "73%". Caption: the question's resolution date. |
| Choose one | The ring is cut into arcs, one per option, each as wide as its chance, with small gaps. The arm points at the middle of the leading option's arc. Below the dial, the options ranked with their chances. |
| A number | A scale of four equal steps on round numbers (400, 600, 800, 1,000, 1,200), zoomed to the answer: it holds the 80% range with room either side, and never starts below zero when the answer cannot be negative. The arm points at the median; an arc marks the 80% range. Large figure: the median (`$` and `%` attached, a unit word such as "seats" set small beneath); below, "80% likely between a and b". |
| A date | Not offered in version 1 (see section 5). |

Behaviour: the arm starts at rest at the lowest mark. A pull is a drag on the star (past about a
quarter of the sweep it takes over), a tap on the dial, or the **Pull** button (for keyboard and
screen-reader users). Let go early and it falls back to rest. The swing is a damped spring
(stiffness 90, damping 13: one small overshoot of about 5%) over about 1.9 s. The answer fades in after
all three rings lock. With "reduce motion", the dial and answer settle immediately. The dial's
`aria-label` announces the answer after the pull.

The same drawing code (`public/lib/lever.js`) makes the on-screen dial and the share picture, so
they cannot drift apart.

## 5. Which questions we can answer (the form)

From the forecasting dashboard's own rules (`docs/topic-questions.md` there), applied in
`server/gate.mjs`:

- One observable event or quantity, with named actors, a threshold where it is a quantity, a window.
- It resolves without argument, later, by a public source named in the resolution criteria.
- Still open and neither certain nor impossible; worded neutrally.
- Kinds: **binary**, **categorical** (2 to 20 options, mutually exclusive, with "Other" when needed),
  **numerical** (unit, lower bound below upper bound). A "when will X happen?" question is turned
  back with "Ask it as a yes or no by a date, or as a number." (The dashboard reports a date result
  as a day count whose meaning I could not confirm, so version 1 does not draw it.) A question with
  an "if" is turned back too: one question at a time.
- Resolution date: at least 7 days from today unless the deciding event is sooner (never the past),
  at most 3 years out (`MAX_HORIZON_DAYS`, default 1095).
- Not about a private individual's private life; not harmful; not a matter of taste or advice.

The decision model returns a probability for each reason a question is turned away: *past or already
known*, *opinion or advice*, *private person*, *harmful*, *too vague*, *not about the future*, or
*fine*. Over the threshold for *fine* (0.5), the question goes on; otherwise the top reason picks a
message. Live Bedrock mode requires a decision before sharpening and asks the person to try again if
Bedrock is unavailable. The optional Jev mode can fall back to the rules and sharpening.

## 6. Architecture

```
iPhone (installed PWA)  ──HTTPS──▶  server/ (Node 22, node:http, node:sqlite)
   public/  vanilla ES modules          ├─ auth      invite redemption, device sessions
   service worker, Web Push             ├─ gate      form check (Jev) + sharpening + rules
                                        ├─ wishes    state machine, accounting, refunds
                                        ├─ adapters  jev, forecaster (dashboard) | fakes
                                        ├─ sanitize  the allowlist
                                        ├─ push      Web Push (VAPID)
                                        └─ og        preview picture for links
```

- **Forecaster adapter** (`server/adapters/forecaster.mjs`): calls the Foundation Forecasts
  dashboard API as the identity of its token, in the organization named by `FORECASTER_ORG`
  (header `X-Forecasting-Org`). `POST /v1/quick-create/drafts` with `{text}` only (the `as_of`
  field is for backtests and the API refuses it with 422), then poll `GET /v1/quick-create/drafts`
  for the draft, and delete it, to sharpen;
  `POST /v1/questions` with `launch: true`, `depth: "light"`, `runs: "single"`, `max_usd`,
  `max_seconds` to forecast; `GET /v1/questions/{id}` until the run is `succeeded`, `failed` or
  `stopped`. Results read: `value`, `low`, `high`, `option_chances`, `unit`, `close_date`, nothing
  else.
- **Decider** (the form check). Two interchangeable adapters with one contract (typed `choice`
  questions in, a probability per option out), chosen by `DECIDER`:
  **Bedrock** (`server/adapters/bedrock.mjs`, the default in live mode): Claude Haiku 5.5 through a
  forced tool call, so the answer is structured; the question is passed as quoted data and the
  model is told never to follow it; no temperature (the model refuses it); credentials from the AWS
  role. Checked on this box: the role can invoke `us.anthropic.claude-haiku-5-5` and
  `us.anthropic.claude-sonnet-5-5`, but cannot list models, so whether Bedrock also offers Jev or
  Strands Decider is unconfirmed. The OpenAI Decisions endpoint is not on Bedrock by the account
  of the note this was based on (unverified here).
  **Jev**: the Decisions API shape used by the Jev Tab Switcher:
  `POST {state, questions:{form:{type:"choice", criteria}, kind:{…}}, model}`; default endpoint
  `https://openrouter.ai/api/alpha/decisions`, model `typesafe/jev-1.14`; response
  `answers.<key>.probabilities`. Timeout 4 s; on error the gate falls back to rules.
- **Fakes** (`MODE=fake`): a deterministic forecaster and decision model so the whole app runs and
  is tested offline, with no spend.
- **Storage**: SQLite file. Tables: `invites`, `users`, `sessions`, `checks`, `wishes`, `pushes`,
  `ledger` (every wish spent, refunded, and the day's runs).
- **Static client**: no build step. Fonts, seal, wordmark and stars are the kit's files.

### API (all JSON; the cookie `tw_session` or `Authorization: Bearer`)

| Method and path | Purpose |
|---|---|
| `POST /api/redeem {code}` | Redeem an invitation; creates the person and a session. |
| `GET /api/me` | Wishes left, earlier wishes (allowlisted), invites to give. |
| `POST /api/check {text}` | The check. Returns `{verdict: "ok" \| "fix" \| "no", message, suggestions[], question?, checkId?}`. Spends nothing. |
| `POST /api/seal {checkId}` | Spends one wish and starts the forecast. 409 when none are left or the day's cap is reached. |
| `GET /api/wishes/:id` | State of one wish; the answer once ready. |
| `POST /api/wishes/:id/reveal` | Marks the pull (for the person's own history; the answer is the same either way). |
| `POST /api/push {subscription}` | Registers a Web Push subscription. |
| `GET /api/public/:token` | The shareable result: question and answer only. No auth. |
| `GET /w/:token`, `GET /w/:token/og.png` | The share page and its preview picture. |
| `GET /i/:code` | Invitation landing page. |
| `GET /admin/stats` | With `X-Admin-Token`: counts and spend. |

### Wish states

`checked → sealed → running → ready` or `→ failed` (refund). A check expires after 30 minutes.
Polling every 15 s while anything is running; a hard timeout at `WISH_TIMEOUT_MIN` (default 45).

### The iPhone app

`ios/` wraps the web app in a native shell (`WKWebView`), so the page is the same and only the pieces a
web app does badly are native: **push** through Apple's service (`server/apns.mjs`; the phone's token goes
to `POST /api/device`), **haptics** (a click per twelve degrees of the dial, a knock per locking ring, a
success at the end), and the **share sheet** with the picture and link. The page detects the shell by its
user agent (`III-iOS/1.0`) and talks to it through one message handler (`public/native.js`). The shell
keeps its own storage, so an invitation code typed in the app stays signed in. Built with XcodeGen from
`ios/project.yml`; see `ios/README.md`. Not yet compiled: it needs Xcode.

## 7. Spend and safety

- `WISH_MAX_USD` (default **2.00**) per wish, `DAILY_WISH_LIMIT` (default **25**) wishes sealed per
  UTC day. These are placeholders until Ido sets numbers.
- `CHECKS_PER_HOUR` (default 20) per person. The sharpening step costs a model call.
- Wish text is stored; nothing else about a person is. No IP storage beyond the rate limiter's memory.
- Moderation: the decision model's *harmful* and *private* reasons, plus a short blocklist, run
  before anything is sent to the forecaster.

## 8. Invitations

- `node bin/admin.mjs invite --count 20 --note "friends batch"` prints codes like `K7QM-2XWD`
  (an alphabet without 0/O/1/I/L).
- Each person who joins is given `INVITES_PER_USER` (default 0) codes to pass on. Set it above zero
  to let it spread; the first batch should be hand-given.
- A code is single-use, except for the 24-hour, three-device re-entry window.

## 9. Not in version 1

- App Store release. The iPhone app is a TestFlight-ready shell, not yet built or reviewed.
- Date questions ("when will…?") and conditional questions.
- Following up a wish; editing a sealed wish; deleting a person (the database file can be edited by hand).
- Multiple languages (English only; the forecaster's titles are English).

## 10. Open items for Ido

1. Whether to keep **Bedrock** (Claude Haiku 5.5) as the form check, which works today with no key, or add a Jev key (OpenRouter) for its 0.3 s and $0.0001 per call. Strands Decider 2B on SageMaker or AgentCore is a third option, not tried.
2. The per-wish and daily **spend numbers**.
3. A **service identity** on the dashboard for the app (today it uses the shared dev token; its
   questions appear in the owner's dashboard). A dedicated organization would keep wishes apart.
4. The app's **name** on the Home Screen (now "III", proposed) and its domain.
5. Whether each person may **invite others** (`INVITES_PER_USER`).
6. A real-iPhone pass: install flow, Web Push, share sheet, haptics.
