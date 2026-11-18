# The Seven Friends icon

`sevenfriends.svg` is the master: a white "7" on a purple gradient (#4f46e5 to #7c3aed) in a rounded square, with a small white **alarm-bell badge** at the lower right (the poke: see `docs/design/poke-alarm.md`). **Every icon of every app is made from it by ONE script: `npm run icons`** (`scripts/make-icons.mjs`; run `npm i --no-save sharp` first). It writes this folder, the copies in `client-wrappers/android` and `client-wrappers/ios` (their `public` folders), the Android launcher images (`mipmap-*`), the iPhone app icon (`AppIcon-512@2x.png`), the Windows `app.ico` and the MSIX pictures. To move or change the badge, change `BADGE` in the script and run it again. The table below is what the web app uses:

| File                     | Used for                                                     |
| ------------------------ | ------------------------------------------------------------ |
| `sevenfriends.svg`       | the favicon of modern browsers, and an icon in the manifest  |
| `../favicon.ico`         | the favicon of older browsers (16, 32 and 48 pixels)         |
| `icon-192.png`, `icon-512.png` | the app icon (installed app, notifications)            |
| `icon-maskable-512.png`  | the app icon on Android, which cuts it to any shape (the "7" is kept inside the safe middle) |
| `apple-touch-icon.png`   | the icon on the iPhone Home Screen (180 pixels, square: iPhone rounds it itself) |

To change the icon, change the SVG and make the PNGs and the .ico again from it (same names, same sizes).
