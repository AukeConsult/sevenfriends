# The iPhone app on a Mac: build it, run it, test push and the poke alarm

For whoever sits at the Mac. Everything for the iPhone was written on Windows and **has never been built in Xcode**, so expect a small fix or two (see "If something breaks"). Take it in order and stop at the first step that fails. Written for the project as it is now (Capacitor 8, Swift Package Manager, bundle id `io.sevenfriends.app`, minimum iOS 15).

The iPhone app is a thin shell that loads the live website (`https://sevenfriends.io`, set in `frontend/capacitor.config.json`). So almost everything you see is the deployed website: **deploy the website and the backend first** (`firebase deploy --only functions,hosting`), or you will test old code.

## 0. What you need
- A **Mac** with a recent macOS and **Xcode** (the newest from the App Store; Capacitor 8 needs a current one). Open Xcode once and accept the licence and the extra components.
- An **Apple Developer account** (99 USD a year) and a **real iPhone** with a cable. A simulator cannot receive push or ring a critical alert.
- **Node.js 22** (`node -v`), **Git**.
- Access to the **Firebase project** and the `.env` of this project (it holds the service account key; never commit or paste it).
- For the poke alarm: Apple's **Critical Alerts entitlement** (separate; see step 9 and `docs/design/apple-critical-alerts-request.md`). Everything else works without it.

## 1. Get the code
```sh
git clone <the project> sevenfriends     # or: git pull, if it is there already
cd sevenfriends
npm --prefix frontend install
npm --prefix functions install
```
Copy `.env` from the Windows machine into the project root (it is not in git). It must have `FIREBASE_PROJECT_ID`, `FIREBASE_SERVICE_ACCOUNT` and `IOS_BUNDLE_ID=io.sevenfriends.app`.

## 2. The Firebase file for the iPhone
```sh
npm run ios:config
```
This finds (or creates) the iOS app in Firebase and writes `client-wrappers/ios/App/App/GoogleService-Info.plist` (git-ignored). There is also an old copy in `client-wrappers/ios/App/`: delete that one.

## 3. Sounds
- The jingles: `npm run ios:sounds` (needs the Mac: it uses `afconvert`). It makes `drill.caf`, `hyper.caf` and `acidbreaks.caf` in `client-wrappers/ios/App/App/`. A jingle over 30 seconds is reported: an iPhone plays its default sound instead. **Commit the `.caf` files**; the Xcode project already lists them and will not build until they exist.
- The poke sound `poke.caf` is already in the folder (made by `npm run poke:sound`, 25 s). Check it is there.

## 4. Sync and open
```sh
npm run ios:sync      # builds the website bundle and copies config and plugins into the iPhone project
npm run ios:open      # opens Xcode
```
Do not edit generated files (`CapApp-SPM/Package.swift`, `App/App/public`): `ios:sync` rewrites them. Our own code is in `client-wrappers/ios/App/App` (`AppDelegate.swift`, `SceneDelegate.swift`, `PokeAlerts.swift`).

## 5. In Xcode (once)
1. **Firebase Messaging:** File > Add Package Dependencies > `https://github.com/firebase/firebase-ios-sdk` > add the product **FirebaseMessaging** (and its dependency FirebaseCore) to the **App** target. Without it the app builds but gives no push token.
2. **GoogleService-Info.plist:** make sure it is in the **App** group and ticked for the App target (select the file, look at "Target Membership").
3. **Target membership check:** select each of these and confirm the App target is ticked: `PokeAlerts.swift`, `poke.caf`, `drill.caf`, `hyper.caf`, `acidbreaks.caf`.
4. **Signing & Capabilities** (App target): pick your **Team**, keep the bundle id `io.sevenfriends.app`, "Automatically manage signing" on. Add the capability **Push Notifications** if it is not listed (Background Modes > Remote notifications is already in `Info.plist`).
5. Do **not** add the Critical Alerts entitlement yet (step 9). Adding it before Apple approves makes signing fail.
6. `Info.plist` already explains camera, microphone and location to the person. If you add a feature that uses another permission, add its text there or the app is rejected or crashes.

## 6. The Apple push key (once, on developer.apple.com)
1. Certificates, Identifiers & Profiles > **Keys** > add a key, tick **Apple Push Notifications service (APNs)**, download the `.p8` file (only once!), note the **Key ID** and your **Team ID**. Never commit the file.
2. Firebase console > Project settings > **Cloud Messaging** > Apple app configuration > upload the `.p8` with the Key ID and Team ID.
Without this, Firebase cannot deliver anything to an iPhone.

## 7. Run it on the iPhone
1. Connect the iPhone, unlock it, trust the Mac. On the iPhone: Settings > Privacy & Security > **Developer Mode** on (it restarts).
2. In Xcode choose your iPhone as the destination and press Run. First time: on the iPhone, Settings > General > VPN & Device Management > trust your developer certificate.
3. Sign in. Settings > Notifications in the app: turn on **Notify this device**. The iPhone asks for permission. (Without Apple's entitlement the question has no "Critical alerts" option: that is expected.)

## 8. Test ordinary push
From another account (a browser is enough) send a message to the iPhone's account, with the app **closed** and the screen locked. A notification must arrive, with the sound the person chose. If not, see the table below.

## 9. The poke alarm (Critical Alerts)
1. **Apply to Apple** with `docs/design/apple-critical-alerts-request.md` (the Account Holder does this; it can take days or weeks). Nothing below works without approval.
2. **When approved:** developer.apple.com > Identifiers > the App ID `io.sevenfriends.app` > enable **Critical Alerts** (it appears once approved) > make a new provisioning profile. In Xcode add the key `com.apple.developer.usernotifications.critical-alerts` = `true` to `App.entitlements` (Signing & Capabilities will show it once the profile has it). Build again.
3. **Delete the app from the iPhone and install it again**, then turn on "Notify this device": the **first** permission question must include **Critical alerts** (the plugin `PokeAlerts.swift` asks it). If the app was installed before, the question is not asked again: delete the app, or turn it on by hand in Settings > Seven Friends > Notifications > Critical Alerts.
4. **Test:** iPhone silent switch **on**, a Focus (Do Not Disturb) **on**, screen locked, app closed. From another account that has a seat for this person, press the bell in the friend's header and send the poke. The iPhone must ring loudly (about 25 s, once) and show who poked. Then test **Pause pokes** on the iPhone's account: the next poke must arrive as an ordinary notification, and the friend must see "Silent".
5. Try the same with the app **open**: the page shows the band at the top and plays a tone.

## 10. Publish (TestFlight and App Store), short
Raise the version (`MARKETING_VERSION`, `CURRENT_PROJECT_VERSION` in the target's General tab), set the destination to **Any iOS Device**, Product > **Archive**, then Distribute App > App Store Connect > upload. In App Store Connect: add the app (name, description, screenshots, age rating, privacy details, a support URL), add testers in **TestFlight**, then submit for review. The review notes should say the app shows the live website, that the poke uses Critical Alerts approved by Apple, and give a test account. Before the first App Store upload check `https://sevenfriends.io/privacy` is the privacy policy you want to show.

## If something breaks
| What you see | Likely cause and what to do |
|---|---|
| Xcode cannot resolve packages | File > Packages > Reset Package Caches; check the network; `npm run ios:sync` again |
| "No such file ... drill.caf" | Step 3: run `npm run ios:sounds` on the Mac and commit the `.caf` files |
| `PokeAlerts.swift` does not compile (CAPBridgedPlugin, registerPluginInstance) | The Capacitor 8 plugin API differs from what was written on Windows. Send the error text; as a stop-gap, in `SceneDelegate.swift` change `MainViewController()` back to `CAPBridgeViewController()` and remove `PokeAlerts.swift` from the target: the app then works, only without the critical-alert question |
| Signing error mentioning an entitlement | You added the critical-alerts key before Apple approved it: remove it from `App.entitlements` |
| App starts, white or black screen | The web app did not load: check the iPhone's network, and that `https://sevenfriends.io` opens in Safari |
| Notifications are on but nothing arrives | The Apple push key is not uploaded (step 6); `GoogleService-Info.plist` missing from the target; FirebaseMessaging not added; the phone's "Notify this device" is off; test on a real iPhone, not a simulator |
| A poke arrives as an ordinary notification | Normal until the entitlement is in the profile and Critical Alerts is on in Settings > Seven Friends > Notifications; also check the person has not **paused pokes**, and that the sender has a seat for them (not on their sleep list) |
| Camera or microphone closes the app | A permission text is missing from `Info.plist` |

## Send back to the developer
If anything fails, copy the **exact Xcode error text** (the red message in the Issue navigator, or the Report navigator log) and which step you were on. For push problems also say what Firebase console > Cloud Messaging shows for the iOS app. Do not send the `.p8` key, `.env` or `GoogleService-Info.plist` in chat.

More on the poke: `docs/design/poke-alarm.md` ("iPhone"). More on the iPhone shell: `client-wrappers/ios/README.md`.
