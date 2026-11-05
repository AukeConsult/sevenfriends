# Seven Friends for Windows

A native Windows app (.NET 8, WPF) with the Microsoft Edge WebView2 control that shows the live web app, the same idea as
`android/` and `ios/`. The web app stays the one code base: deploy it and this app shows the new version, nothing to rebuild or reinstall.

- App id `io.sevenfriends.app` · the address shown is `AppUrl` in `MainWindow.xaml.cs` (the same as `server.url` in
  `frontend/capacitor.config.json`; change both when https://sevenfriends.io works).
- **Needs:** the .NET SDK 8 or newer on the computer that builds it. The people who install the app need nothing extra
  except the WebView2 Runtime, which is part of Windows 11 and of Microsoft Edge (the app says so if it is missing).
- **Try it:** `npm run windows:run` (builds and opens a window with the app).
- **Make the app:** `npm run windows:publish` writes a self-contained `windows/publish/SevenFriends.exe` (no .NET needed to run it).
- **Make the installer:** install Inno Setup 6 (https://jrsoftware.org/isdl.php), then `npm run windows:installer`.
  The result is `windows/installer/output/SevenFriendsSetup.exe`: it installs for the current person only (no administrator needed),
  with a Start menu entry and an optional desktop icon, and has an uninstaller in Windows Settings → Apps.
  To publish a new version, change the version in `SevenFriends.csproj` and in `installer/SevenFriends.iss`.
- Only the app's own pages and the sign-in popup open inside the window; every other link opens in the browser. The microphone,
  camera and notifications are allowed for the app's own pages only. The sign-in is kept in `%LOCALAPPDATA%\SevenFriends`.
- The icon is `app.ico` (made from `frontend/public/icons/icon-512.png`).

Not done yet:
- **Push when the app is closed.** The web push of the browser (Firebase Cloud Messaging) is not built into WebView2, so notifications
  show only while the app is running. Next steps: a tray icon (keep running when the window is closed), and later a native push
  service (Windows Push Notifications) with the backend sending to it.
- **Google sign-in** in an embedded window may be refused by Google. Email and phone sign-in do not depend on it.
- **Signing** the installer with a code-signing certificate (without it Windows SmartScreen warns on the first start) and **automatic updates**.
  The Microsoft Store (MSIX) is another way to hand the app out.
- Not compiled or tried on Windows yet: the first `windows:run` may need a small fix.
