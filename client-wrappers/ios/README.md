# Seven Friends for iPhone

A thin iPhone app (Capacitor, Swift Package Manager) that loads the web app from `server.url` in `frontend/capacitor.config.json`
(https://sevenfriends.io). Same idea as `client-wrappers/android/`: deploy the web app and the iPhone app shows the new version.

- Bundle id: `io.sevenfriends.app` · push plugin: `@capacitor/push-notifications`
- Push is prepared: `App/App/App.entitlements` (aps-environment), background mode `remote-notification` in `Info.plist`, and the token
  hand-over in `AppDelegate.swift`.
- `npm run ios:sync` builds the frontend and copies config and plugins here; `npm run ios:open` opens Xcode (macOS only).
- `GoogleService-Info.plist`: put the service account key in `.env` and run `npm run ios:config` (it finds or creates the iOS app in
  Firebase and writes `client-wrappers/ios/App/App/GoogleService-Info.plist`, which is in `.gitignore`). Add the file to the App target in Xcode.

**Step by step for the Mac: `docs/guide/ios-on-mac.md`.** Needs a Mac with Xcode and an Apple Developer account (99 USD a year) to build, run on a phone and publish. Not tried on a Mac yet
(written on Windows). What is built:
- Push token: `AppDelegate.swift` hands the **Firebase** token (not the APNs one) to the push plugin when `FirebaseMessaging` is linked
  (`#if canImport`); without it the app builds and gives the APNs token. The backend (`functions/src/push.ts`, `deliver`) sends an `apns`
  alert with the phone's own sound ("No sound" = silent) next to the Android and web parts.
- Google sign-in: `@capacitor-firebase/authentication` (run `npm run ios:sync` to add it to `Package.swift`) and the reversed client id
  as a URL scheme in `Info.plist`.

Still to do by hand:
- In Xcode: File > Add Package Dependencies > `https://github.com/firebase/firebase-ios-sdk`, add the product **FirebaseMessaging** to the App target.
- `GoogleService-Info.plist` must be in `client-wrappers/ios/App/App/` and in the App target (a copy now sits in `client-wrappers/ios/App/`: move it).
- Apple developer site: an APNs key (`.p8`, never committed), uploaded in Firebase console > Project settings > Cloud Messaging.
- The Team in Xcode (Signing & Capabilities) and the Push Notifications capability if Xcode asks.
- Sounds: on the Mac run `npm run ios:sounds` (makes `drill.caf`, `hyper.caf`, `acidbreaks.caf` in `client-wrappers/ios/App/App/` from the Android mp3 files, and warns about
  one over 30 s), commit them. The Xcode project already lists them, so it does not build until they exist. The push names the file; the other choices play the phone's own sound.

**Poke (alarm on the iPhone):** a poke is a Critical Alert (`functions/src/push.ts`), with the sound `poke.caf` (made by `npm run poke:sound`) and the plugin `PokeAlerts.swift` that asks for critical alerts in the first permission question. It needs Apple's **Critical Alerts entitlement** (apply for it first; add `com.apple.developer.usernotifications.critical-alerts` to `App.entitlements` only after Apple approves, or the app will not sign). The full list of steps, in order, is in `docs/design/poke-alarm.md`, "iPhone".

