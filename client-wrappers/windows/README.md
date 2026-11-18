# Seven Friends for Windows

A native Windows app (.NET 8, WPF) with the Microsoft Edge WebView2 control that shows the live web app, the same idea as
`client-wrappers/android/` and `client-wrappers/ios/`. The web app stays the one code base: deploy it and this app shows the new version, nothing to rebuild or reinstall.

- App id `io.sevenfriends.app` · the address shown is `AppUrl` in `MainWindow.xaml.cs` (the same as `server.url` in
  `frontend/capacitor.config.json`; change both when https://sevenfriends.io works).
- **Needs:** the .NET SDK 8 or newer on the computer that builds it. The people who install the app need nothing extra
  except the WebView2 Runtime, which is part of Windows 11 and of Microsoft Edge (the app says so if it is missing).
- `client-wrappers/windows/nuget.config` makes the restore use nuget.org only (a missing offline source from Visual Studio, `NU1301`, no longer stops it).
- **Try it:** `npm run windows:run` (builds and opens a window with the app).
- **Build, pack and publish, in one command:** `npm run windows:release` (`scripts/windows-release.mjs`): it builds the self-contained `client-wrappers/windows/publish/SevenFriends.exe`, packs the installer with Inno Setup 6 (https://jrsoftware.org/isdl.php; found in its usual folders) and copies it to `frontend/public/downloads/SevenFriendsSetup.exe`. The last step runs `npm run deploy:hosting`, so the new installer is on the website (the installer is not committed: the release has to run on this computer). `npm run windows:release -- --no-deploy` stops before the deploy.
- The installer (`client-wrappers/windows/installer/output/SevenFriendsSetup.exe`) installs for the current person only (no administrator needed), with a Start menu entry and an optional desktop icon, and has an uninstaller in Windows Settings → Apps. To publish a new version, change the version in `SevenFriends.csproj` and in `installer/SevenFriends.iss`, then run `npm run windows:release`.
- Only the app's own pages and the sign-in popup open inside the window; every other link opens in the browser. The microphone,
  camera and notifications are allowed for the app's own pages only. The sign-in is kept in `%LOCALAPPDATA%\SevenFriends`.
- The icon is `app.ico` (made from `frontend/public/icons/icon-512.png`).

**Running in the background (tray icon):** the close button does not end the app: the window goes to the tray (next to the clock) and
the app keeps running. Left-click the icon to open it, right-click for **Open**, **Start with Windows** and **Quit**. The installer
has a "Start Seven Friends when I sign in" choice (on by default); it starts the app hidden (`--tray`). A new message, friend request or answer
shows as a Windows notification, and clicking it opens the conversation. This needs the web app's own switch: in the app, Settings → Sound and notifications → turn on
notifications on this computer.

**MSIX package:** `npm run windows:release` also makes `client-wrappers/windows/msix/output/SevenFriends.msix` (after the installer; it is not put on the website, and a problem there only prints a warning; leave it out with `-- --no-msix`). `npm run windows:msix` makes only the package (`-- --unsigned`: no signing, only for checks; `-- --skip-publish`: use the files already in `publish/`). Needs the Windows 10/11 SDK (`makeappx.exe`, `signtool.exe`). The manifest is `msix/AppxManifest.xml` (logos in `msix/Assets/`, made from `icon-512.png`); the version comes from `SevenFriends.csproj`. **Signing:** Windows installs only a signed MSIX. With `SF_MSIX_PFX`, `SF_MSIX_PFX_PASSWORD` and `SF_MSIX_PUBLISHER` (the certificate's Subject) in `.env` that certificate signs it; without them a self-signed TEST certificate "Seven Friends MSIX test" is made in your Current User store (public part: `msix/output/SevenFriends-test.cer`, which a computer must trust under Local Machine > Trusted People before it installs the package). For the Microsoft Store the Store signs the package. Known differences of the packaged app: Windows redirects its writes to `%LOCALAPPDATA%` into a folder of the package, so it starts with its own empty sign-in (not the one of the installer version); the "Start with Windows" switch writes the registry Run key, which does not start a packaged app (a manifest start-up task is needed, not done yet).

**Share target (MSIX package only):** "Seven Friends" appears in the Windows share dialog for a link or text (the manifest has `windows.shareTarget`, the code is `SharedContent.cs`). A share starts the app (or, when it runs, a second start hands it to the first copy through a pipe only this person can reach); the window opens on the web app's `/share-in` page with the title, text and link as parameters, where the person chooses the friend or group; the text then lands in the writing field of that conversation (`/friends/:id/send?draft=`) and **nothing is sent until the person presses Send**. What is shared is cut to 4000 characters and cleaned of control characters. Not tried on a computer yet (the package has to be installed with the test certificate trusted, then share a link from Edge): packing and the build are checked, the share dialog is not.

**Log:** an error in a message from the page to the app (for example a poke alarm that could not be shown) is written to `%LOCALAPPDATA%\SevenFriendspp.log`.

**Poke (alarm):** a poke from a friend opens `PokeWindow.cs` (a window over everything, looping sound, Stop / Open), also while the window is hidden in the tray; the web page tells the app (`WebMessageReceived`). Only while the app runs; see `docs/design/poke-alarm.md`.

Not done yet:
- **"Registration failed - push service error"** when switching notifications on in the app was the web push registration, which WebView2 cannot do. The page (`push.service.ts`, `windowsApp`) now skips it in the Windows app: the switch only needs the notification permission, and notifications come from the live page while the app runs.
- **Push when the app is NOT running** (quit from the tray, or the computer is off). The browser's web push is not part of WebView2.
  The next step is a native push service (Windows Push Notifications, WNS): it needs an app registration in Microsoft's partner centre,
  a Windows device kind in `functions/src/push.ts`, and the app packaged as MSIX.
- Whether a notification of the web app (it comes through the service worker) reaches the tray in every case is not tried yet:
  `NotificationReceived` in `MainWindow.xaml.cs` is where to look if it does not.
- **Google sign-in** in an embedded window may be refused by Google. Email and phone sign-in do not depend on it.
- **Signing** the installer with a code-signing certificate (without it Windows SmartScreen warns on the first start) and **automatic updates**.
- Not compiled or tried on Windows yet: the first `windows:run` may need a small fix.

## Offering it for download on the website
`npm run windows:release` copies `client-wrappers/windows/installer/output/SevenFriendsSetup.exe` to `frontend/public/downloads/SevenFriendsSetup.exe` (not committed); `windows:release` then runs `npm run deploy:hosting` (skip it with `-- --no-deploy`), which
publishes it, and the Install page shows **Download for Windows** to people on a Windows computer (only when the file is there). A new version is a new
build, `windows:release` and a deploy: people download the installer again (no automatic updates yet).
