# Project notes

## TODO

- [ ] **Share into Seven Friends (hold: do not publish to users until the owner has accepted it).**
  Built so far, not accepted yet: the web page `/share-in` (`frontend/src/app/share-in/`, the `draft` start text in `friend-send.ts`, texts in `shareIn.json`) and the Windows MSIX share target (`client-wrappers/windows/SharedContent.cs`, `msix/AppxManifest.xml`).
  Before it goes to users:
  - the owner tries and accepts it (install the MSIX with the test certificate trusted, share a link from Edge, check `/share-in` on a phone-sized screen);
  - the MSIX is **not** put on the website downloads (`windows:release` only builds it into `client-wrappers/windows/msix/output/`, so nothing is published by that);
  - the web page `/share-in` goes online with the next `npm run deploy:hosting` (and `windows:release` runs that by default): deploy it only after the acceptance, or take the route out of `app.routes.ts` until then;
  - later steps, not built: Android share target, iPhone share extension, the browser's Web Share Target, and keeping the shared text through the sign-in when the person is signed out.

- [ ] **A message that a new version of the app is ready (Android and Windows), so the person decides when to update.**
  Decided 2026-11-18: no automatic install for now (the self-updating installer is on hold, see the Windows README, "automatic updates"). The website inside the apps already updates by itself on every deploy (`core/app-version.service.ts`); this is only for the app shell: the Android app (`client-wrappers/android`, `versionName` / `versionCode` in `app/build.gradle`) and the Windows installer (`client-wrappers/windows`, `<Version>` in `SevenFriends.csproj`). Not built yet. The plan:
  - a small file on the website, `downloads/app-versions.json`, written by the release scripts (`windows:release`, the Android release): for each app the newest version, where to get it (the installer or the APK, later the store), a short note, and for Windows a checksum;
  - the app tells the page which shell version it is (the Windows app already adds `SevenFriendsWindows/1.0` to the user agent; Android has the `SevenFriendsAndroid` bridge): compare the SHELL version, not the website build counter (`frontend/build-number.json`, shown as 1.1.<build> in About);
  - when the file has a newer version: a quiet notice on Home (an expandable frame in the page, no pop-up): "A new version of the app is ready" with **Update** (opens the download) and **Later** (hides it for some days); Settings → About shows the same state. Only inside the apps, never in a browser;
  - texts in English first and then every language (`npm run check:i18n`); the notice is not shown to someone who is signed out;
  - to decide: a minimum version that must be updated (a shell too old for the site) and when the notice comes back after Later.
