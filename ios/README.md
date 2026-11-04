# Seven Friends for iPhone

A thin iPhone app (Capacitor, Swift Package Manager) that loads the web app from `server.url` in `frontend/capacitor.config.json`
(https://sevenfriends.web.app now). Same idea as `android/`: deploy the web app and the iPhone app shows the new version.

- Bundle id: `io.sevenfriends.app` · push plugin: `@capacitor/push-notifications`
- Push is prepared: `App/App/App.entitlements` (aps-environment), background mode `remote-notification` in `Info.plist`, and the token
  hand-over in `AppDelegate.swift`.
- `npm run ios:sync` builds the frontend and copies config and plugins here; `npm run ios:open` opens Xcode (macOS only).
- `GoogleService-Info.plist`: put the service account key in `.env` and run `npm run ios:config` (it finds or creates the iOS app in
  Firebase and writes `ios/App/App/GoogleService-Info.plist`, which is in `.gitignore`). Add the file to the App target in Xcode.

Needs a Mac with Xcode and an Apple Developer account (99 USD a year) to build, run on a phone and publish. Not done yet:
- In Apple's developer site: an APNs key (a `.p8` file, never committed) uploaded in Firebase console → Project settings → Cloud Messaging.
- Setting the Team in Xcode (Signing & Capabilities) and adding the Push Notifications capability if Xcode asks.
- On iPhone the plugin gives the APNs token, not the Firebase one: the Firebase messaging SDK has to be added so the existing backend can
  send to it. Also sign-in inside the app (Google's popup does not work in a WebView) and the sound.
