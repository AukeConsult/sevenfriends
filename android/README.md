# Seven Friends for Android

A thin Android app (Capacitor) that loads the web app from `server.url` in `frontend/capacitor.config.json`
(now https://sevenfriends.web.app; change it to https://sevenfriends.io when that domain works). The web app
stays the one code base: deploy it and the Android app shows the new version.

- App id: `io.sevenfriends.app` · push plugin: `@capacitor/push-notifications`
- `npm run android:sync` builds the frontend and copies the config and plugins into this folder
  (run it after changing `frontend/capacitor.config.json` or adding a Capacitor plugin).
- `npm run android:open` opens the project in Android Studio (Run ▶ on a phone or emulator).
- Push needs `app/google-services.json`: put the service account key in `.env` (see `.env.example`) and run `npm run android:config`.
  It finds (or creates) the Android app in the Firebase project, adds `ANDROID_SHA1` when set, and writes the file. The file is in `.gitignore`.

Not done yet: sign-in inside the app (Google's popup does not work in a WebView), the native service that plays
the chosen sound when a push arrives in the background, and the sound choice shared with the native side.

## Offering the app for download on the website (no app store)
Two Gradle tasks (group **sevenfriends**, in `app/publish.gradle`), run in Android Studio (Gradle panel > Tasks > sevenfriends) or here with `gradlew`:
- **`publishApk`** builds the app and copies it to `frontend/public/downloads/SevenFriends.apk` (git-ignored).
- **`deployApp`** does `publishApk` and then `npm run deploy:hosting`, which puts the website online with the file (Node and the Firebase login are needed).

The Install page and the sign-in page then show **Download the Android app** on an Android phone (only when the file is there). People must allow their
browser to install apps from this source once. The file is signed with the debug key: fine for this, but Google Play needs a release key.
If the web config or plugins changed, run `npm run android:sync` first.
