# The Seven Friends icon

`sevenfriends.svg` is the master: a white "7" on a purple gradient (#4f46e5 to #7c3aed) in a rounded square, the same as the
logo on the login page. Everything else is made from it:

| File                     | Used for                                                     |
| ------------------------ | ------------------------------------------------------------ |
| `sevenfriends.svg`       | the favicon of modern browsers, and an icon in the manifest  |
| `../favicon.ico`         | the favicon of older browsers (16, 32 and 48 pixels)         |
| `icon-192.png`, `icon-512.png` | the app icon (installed app, notifications)            |
| `icon-maskable-512.png`  | the app icon on Android, which cuts it to any shape (the "7" is kept inside the safe middle) |
| `apple-touch-icon.png`   | the icon on the iPhone Home Screen (180 pixels, square: iPhone rounds it itself) |

To change the icon, change the SVG and make the PNGs and the .ico again from it (same names, same sizes).
