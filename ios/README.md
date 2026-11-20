# III, the iPhone app

A native shell around the web app: it opens the app full screen and adds what a Home Screen web app
cannot do well: **real push notifications** ("Your answer is ready"), **haptics** (a click for every
twelve degrees you turn the dial, a knock as each ring locks, a success at the end), and the **iOS
share sheet** with the picture and the link. Its storage is its own, so an invitation code typed in the
app stays signed in; there is no Safari-to-Home-Screen hop.

Everything on screen is still the web app. Change the web app and the iPhone app changes with it, with
no new build, except the native pieces in `III/`.

## What you need

- A **Mac with Xcode 15 or later**, and an iPhone on iOS 16 or later.
- An **Apple ID** to run it on your own phone (free, but the install lasts 7 days and **has no push**), or
  the **Apple Developer Program** ($99 a year) for push notifications and TestFlight.
- An **https address** for the web app that stays up. The one in `project.yml` is a temporary tunnel
  and will stop working; see "The address" below.

## Run it on your iPhone

```bash
brew install xcodegen        # once
cd ios
xcodegen                     # writes III.xcodeproj from project.yml
open III.xcodeproj
```

In Xcode:

1. Select the **III** target, then **Signing & Capabilities**. Pick your **Team**. If Xcode says the
   bundle identifier is taken, change `ai.foundationresearch.iii` to something of yours (in
   `project.yml` too, then run `xcodegen` again, and set `APNS_BUNDLE_ID` on the server to match).
2. **Free Apple ID?** Push Notifications cannot be signed with a free account. In `project.yml`, set
   `CODE_SIGN_ENTITLEMENTS: ""`, run `xcodegen` again, and the app builds without push.
3. Plug in the iPhone. On the phone: **Settings > Privacy & Security > Developer Mode > on**, restart,
   and tap **Trust** when asked.
4. Choose the phone at the top of Xcode and press **Run** (the play button). First launch on a free
   account: **Settings > General > VPN & Device Management > your Apple ID > Trust**.

The app opens on the gate. Type an invitation code (`node bin/admin.mjs invite`), or open
`iii://i/ABCD-EFGH` (for example from Notes or Messages) to go straight to that invitation.

## The address

`APP_URL` in `project.yml` is where the app loads from. A Cloudflare quick tunnel changes every time it
restarts and will break the app. For anything you hand to other people, give the web app a stable https
address (a named Cloudflare tunnel, or the container behind a load balancer), set `APP_URL`, and run
`xcodegen` again. Also set `PUBLIC_BASE_URL` on the server to the same address, so share links match.

## Push notifications

The native app needs Apple's push service, which needs a key:

1. Apple Developer > **Certificates, Identifiers & Profiles** > **Keys** > **+** > tick **Apple Push
   Notifications service (APNs)** > Continue > Register > **Download** the `.p8` (you can download it
   once). Note its **Key ID**; your **Team ID** is under Membership.
2. On the server (`.env` or environment):

   ```
   APNS_KEY_FILE=/path/to/AuthKey_ABCDE12345.p8
   APNS_KEY_ID=ABCDE12345
   APNS_TEAM_ID=TEAM123456
   APNS_BUNDLE_ID=ai.foundationresearch.iii
   ```

   Restart the server.
3. In Xcode the entitlement `aps-environment` is already in `III/III.entitlements`; Xcode adds the
   capability to your App ID when you sign.
4. Test: run from Xcode, ask a question, accept the notification prompt, lock the phone. When the
   answer is ready the phone buzzes; tapping it opens that answer.

Builds run from Xcode use Apple's **sandbox** push service and TestFlight or App Store builds use
**production**; the app reports which (`ApnsEnv`, set per configuration in `project.yml`) and the
server sends to the matching one. A token for the wrong one is dropped after Apple refuses it.

## TestFlight (to give it to other people)

1. App Store Connect > **My Apps** > **+** > **New App**; use your bundle identifier.
2. In Xcode: set the run destination to **Any iOS Device**, **Product > Archive**, then **Distribute
   App > App Store Connect > Upload**.
3. In App Store Connect > **TestFlight**: add **internal testers** (up to 100 people on your team; no
   review) or **external testers** (a public link; Apple reviews the first build).

Apple's review guideline 4.2 refuses apps that are only a website in a frame. This one adds native
haptics, the native share sheet and push notifications, which is what the guideline asks for, but
there is no guarantee. Internal TestFlight needs no review.

## How the page and the shell talk

The page posts `{ type: "haptic" | "share" | "push" | "ready", ... }` to `window.webkit.messageHandlers.native`
(see `public/native.js`). Swift answers by calling `window.nativePush(token, env)` with the phone's push
token, which the page sends to `POST /api/device` as the signed-in person. The shell adds ` III-iOS/1.0` to
the user agent; the page uses that to hide the "Add to Home Screen" hints and use the native pieces.

| File | Does |
|---|---|
| `III/WebView.swift` | hosts the page; keeps navigation on the app's address; handles the messages |
| `III/Bridge.swift` | opens links and notification taps; hands over the push token; the offline state |
| `III/AppDelegate.swift` | push registration, showing a banner while the app is open, opening a tapped answer |
| `III/Sharer.swift`, `Haptics.swift`, `Push.swift` | the share sheet, the haptics, the permission prompt |
| `III/OfflineView.swift` | "No connection" with Try again |
| `III/Info.plist`, `III.entitlements` | name, the `iii://` link, launch colour, push |
| `III/Assets.xcassets` | icon (the seal on night), launch seal, night colour |

## What has and has not been checked

Checked, on a Linux machine with no Xcode: all ten Swift files parse (`swiftc -parse`); the plist,
entitlements, asset catalog and `project.yml` are well-formed; the icon is 1024 x 1024 with no alpha
channel; the web side of every message is exercised in a browser against a stand-in for the shell;
and the server side (device registration, the Apple provider token, sending, forgetting dead tokens)
has automated tests that check the token's signature the way Apple does.

**Not checked: that the project compiles, runs, or notifies a real phone.** No Xcode, no Mac, no iPhone and
no Apple key were available. Expect a first build to need small fixes. Send me the compiler's messages
and I will fix them.
