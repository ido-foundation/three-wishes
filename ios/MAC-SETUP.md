# Bringing the iPhone app up on a Mac

This is a hand-off. The app in `ios/` was written on a Linux machine with no Xcode, so **it has never been
compiled or run**. Your job on the Mac: get it to build, put it on an iPhone, and fix whatever the first build
turns up. `ios/README.md` explains the app and the push-notification and TestFlight set-up; this file is the
checklist.

## 0. What you have and what you need

- The repo (this one). Read `SPEC.md` (what the product is and its rules) and `ios/README.md`.
- A Mac with **Xcode 15 or later** (Xcode 16 is fine) and the command line tools (`xcode-select --install`).
- An iPhone on iOS 16 or later and a cable. An Apple ID (free: runs on your own phone for 7 days, **no push**)
  or the Apple Developer Program ($99 a year: push and TestFlight).
- Homebrew, for `xcodegen`. Node 22 or later only if you want to run the web server on the Mac.

## 1. Generate the project and prove it compiles (no phone, no signing)

```bash
brew install xcodegen
cd ios
xcodegen                    # writes III.xcodeproj from project.yml
xcodebuild -project III.xcodeproj -scheme III \
  -destination 'generic/platform=iOS Simulator' \
  CODE_SIGNING_ALLOWED=NO build 2>&1 | tail -40
```

**Expected:** `BUILD SUCCEEDED`. If it does not, the messages are the work. Fix them in `ios/III/*.swift` or
`ios/project.yml` (re-run `xcodegen` after changing the project file). Things most likely to need a touch, because
they could only be syntax-checked:

| Where | Why it might fail |
|---|---|
| `IIIApp.swift` | `@UIApplicationDelegateAdaptor` with a plain `NSObject` delegate |
| `WebView.swift` | `UIViewRepresentable` and `WKScriptMessageHandler` signatures; `isInspectable` needs iOS 16.4 (guarded) |
| `Bridge.swift` | `@Published` set from delegate callbacks; Swift 6 toolchain warnings in Swift 5 mode (set `SWIFT_VERSION: "5.0"`; ignore warnings, fix errors) |
| `Sharer.swift` | a captured `var` mutated in a closure (a `Box` class is used to avoid it) |
| `Assets.xcassets` | single-size `AppIcon` (needs Xcode 14+), `UILaunchScreen` colour and image names |
| `Info.plist` | `$(APP_URL)` and `$(APNS_ENV)` come from build settings in `project.yml` |

## 2. Run it in the simulator

```bash
open -a Simulator
xcrun simctl list devices available | grep iPhone | head
xcodebuild -project III.xcodeproj -scheme III \
  -destination 'platform=iOS Simulator,name=iPhone 15' \
  CODE_SIGNING_ALLOWED=NO -derivedDataPath build build
xcrun simctl install booted build/Build/Products/Debug-iphonesimulator/III.app
xcrun simctl launch booted ai.foundationresearch.iii
```

(Or open `III.xcodeproj` in Xcode and press Run.) The simulator cannot receive remote push; everything else works.

## 3. Point it at a server

The app loads `APP_URL` from `ios/project.yml`. It currently names a **temporary tunnel that will be gone**. Pick one:

- **The real server** (stable https address): set `APP_URL`, re-run `xcodegen`.
- **A server on this Mac, no spend:** from the repo root

  ```bash
  npm install
  npm run assets            # only if public/brand or public/icons are missing
  npm run demo              # fake forecasts, prints invitation links, http://localhost:8787
  ```

  In the simulator, `APP_URL` can be `http://localhost:8787` (the plist allows local networking). For a real phone
  use the Mac's address on the same Wi-Fi, for example `http://192.168.1.20:8787`, or `npm run demo:tunnel`.
  Demo answers are labelled as fake in the app.

Any change to the web files in `public/` shows up in the app on reload, with no rebuild.

## 4. Put it on the iPhone

1. `open III.xcodeproj`. Target **III** > **Signing & Capabilities** > choose your **Team**. If the bundle
   identifier `ai.foundationresearch.iii` is taken, change it in `project.yml` and re-run `xcodegen`.
2. **Free Apple ID:** set `CODE_SIGN_ENTITLEMENTS: ""` in `project.yml`, re-run `xcodegen` (push cannot be signed
   with a free account).
3. iPhone: **Settings > Privacy & Security > Developer Mode > on**, restart, trust the Mac.
4. Choose the iPhone in Xcode's toolbar and press Run. First launch on a free account: Settings > General > VPN &
   Device Management > trust your Apple ID.

## 5. Check it by hand (the list that matters)

- [ ] Launch: dark launch screen with the seal, then the gate (logo, a code field). No "Add to Home Screen" hint.
- [ ] Type an invitation code (from `node bin/admin.mjs invite`, or the demo's printed list). The home screen shows
      three markers orbiting the seal. Close and reopen the app: still signed in.
- [ ] Ask a question that should pass ("Will the Fed cut rates before the end of 2027?"). Review screen shows the
      kind, the date, the question, resolution criteria. "Yes, ask it". The iOS notification prompt appears now.
- [ ] While it thinks: the instrument turns and the gold star searches. Close the app.
- [ ] When ready (about 9 minutes live, 4 seconds in demo): reopen, turn the dial with a finger. **You feel a click
      every twelve degrees, a knock as each ring locks, then a success buzz.** The figure appears.
- [ ] **Share** opens the iOS share sheet with the picture and a link.
- [ ] Airplane mode, relaunch: the "No connection" screen with Try again; turning airplane mode off and tapping it
      reloads.
- [ ] Open `iii://i/ABCD-EFGH` in Safari or Notes: the app opens on that invitation.
- [ ] (Paid account, APNs key configured on the server) ask a question, lock the phone, wait: a notification
      "Your answer is ready." arrives; tapping opens the answer. See `ios/README.md` for the key.

If something here does not work, the likeliest causes: `APP_URL` wrong or not https (a blank page); the web page
not detecting the shell (check the user agent ends in `III-iOS/1.0`: Safari > Develop > the phone > the page, Debug
builds only); a push token sent before sign-in (it is re-sent after sign-in).

## 6. When it works

```bash
git add -A && git commit -m "iOS: fixes from the first build" && git push
```

Then TestFlight: `ios/README.md`, section "TestFlight".

## Facts a new session should know

- Rules the app keeps: brand = the Foundation kit, with night darkened to `#02031A` by request; the only star
  anywhere is the gold one on the lever arm; nothing the person sees names a method, model, provider or cost
  (`test/api/leak.test.mjs` checks every served file). `npm test` runs 99 tests in about 20 seconds.
- The web app is the product; the iOS shell is thin on purpose. Do not move product logic into Swift.
- The native/web contract is `public/native.js` <-> `ios/III/WebView.swift`; `test/unit/ios.test.mjs` fails if the
  message types, haptic names, user agent, bundle id or payload key drift apart. Keep it passing.
- Open decisions are listed in `SPEC.md` section 10 (Jev vs Bedrock for the form check, spend caps, a stable
  address and a service identity for the dashboard, the app name "III").
