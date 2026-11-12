# Seven Friends for Windows

A native Windows app (.NET 8, WPF) with the Microsoft Edge WebView2 control that shows the live web app, the same idea as
`android/` and `ios/`. The web app stays the one code base: deploy it and this app shows the new version, nothing to rebuild or reinstall.

- App id `io.sevenfriends.app` · the address shown is `AppUrl` in `MainWindow.xaml.cs` (the same as `server.url` in
  `frontend/capacitor.config.json`; change both when https://sevenfriends.io works).
- **Needs:** the .NET SDK 8 or newer on the computer that builds it. The people who install the app need nothing extra
  except the WebView2 Runtime, which is part of Windows 11 and of Microsoft Edge (the app says so if it is missing).
- `windows/nuget.config` makes the restore use nuget.org only (a missing offline source from Visual Studio, `NU1301`, no longer stops it).
- **Try it:** `npm run windows:run` (builds and opens a window with the app).
- **Build, pack and publish, in one command:** `npm run windows:release` (`scripts/windows-release.mjs`): it builds the self-contained `windows/publish/SevenFriends.exe`, packs the installer with Inno Setup 6 (https://jrsoftware.org/isdl.php; found in its usual folders) and copies it to `frontend/public/downloads/SevenFriendsSetup.exe`. Then `npm run deploy:hosting` publishes it.
- The installer (`windows/installer/output/SevenFriendsSetup.exe`) installs for the current person only (no administrator needed), with a Start menu entry and an optional desktop icon, and has an uninstaller in Windows Settings → Apps. To publish a new version, change the version in `SevenFriends.csproj` and in `installer/SevenFriends.iss`, then run `npm run windows:release`.
- Only the app's own pages and the sign-in popup open inside the window; every other link opens in the browser. The microphone,
  camera and notifications are allowed for the app's own pages only. The sign-in is kept in `%LOCALAPPDATA%\SevenFriends`.
- The icon is `app.ico` (made from `frontend/public/icons/icon-512.png`).

**Running in the background (tray icon):** the close button does not end the app: the window goes to the tray (next to the clock) and
the app keeps running. Left-click the icon to open it, right-click for **Open**, **Start with Windows** and **Quit**. The installer
has a "Start Seven Friends when I sign in" choice (on by default); it starts the app hidden (`--tray`). A new message, friend request or answer
shows as a Windows notification, and clicking it opens the conversation. This needs the web app's own switch: in the app, Settings → Sound and notifications → turn on
notifications on this computer.

Not done yet:
- **Push when the app is NOT running** (quit from the tray, or the computer is off). The browser's web push is not part of WebView2.
  The next step is a native push service (Windows Push Notifications, WNS): it needs an app registration in Microsoft's partner centre,
  a Windows device kind in `functions/src/push.ts`, and the app packaged as MSIX.
- Whether a notification of the web app (it comes through the service worker) reaches the tray in every case is not tried yet:
  `NotificationReceived` in `MainWindow.xaml.cs` is where to look if it does not.
- **Google sign-in** in an embedded window may be refused by Google. Email and phone sign-in do not depend on it.
- **Signing** the installer with a code-signing certificate (without it Windows SmartScreen warns on the first start) and **automatic updates**.
- Not compiled or tried on Windows yet: the first `windows:run` may need a small fix.

## Offering it for download on the website
`npm run windows:release` copies `windows/installer/output/SevenFriendsSetup.exe` to `frontend/public/downloads/SevenFriendsSetup.exe` (not committed); `npm run deploy:hosting`
publishes it, and the Install page shows **Download for Windows** to people on a Windows computer (only when the file is there). A new version is a new
build, `windows:release` and a deploy: people download the installer again (no automatic updates yet).
