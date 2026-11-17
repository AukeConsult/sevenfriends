# client-wrappers

The native apps that wrap the live web app (`frontend/`). The web app stays the one code base; these folders only hold the shell of each platform.

| Folder | What | More |
|---|---|---|
| `android/` | Capacitor wrapper (Gradle, Java) with native push and notification channels | `android/README.md` |
| `ios/` | Capacitor wrapper (Xcode, Swift Package Manager) | `ios/README.md` |
| `windows/` | .NET 8 WPF app with a WebView2 window, plus an Inno Setup installer | `windows/README.md` |

Run everything from the project root with the npm scripts (`android:sync`, `android:open`, `android:config`, `ios:sync`, `ios:open`, `ios:config`, `ios:sounds`, `windows:run`, `windows:release`). The scripts live in `scripts/`. Capacitor finds the two folders through `frontend/capacitor.config.json` (`android.path`, `ios.path`).
