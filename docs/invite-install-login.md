# Invite, install and sign-in: the strategies

How a person gets from "a link from a friend" or "the website" to "signed in, in the right app". Three things are tied together:
**sign-in** (who you are), **install** (which app on which device) and **invitations** (how a friend request survives both).
Status words: **built** = in the code today, **planned** = agreed but not built, **open** = a question for the owner.

## 1. The environments

| Environment | What runs | Where it keeps its data |
|---|---|---|
| Browser tab (any device) | the website | the browser's storage for the site |
| Android app (`android/`, Capacitor) | the website in a WebView, plus native push | its own storage, **not** the browser's |
| iPhone / iPad home-screen app | the website as a web app | its own storage (separate from Safari) |
| Windows app (`windows/`, WPF + WebView2) | the website in WebView2 | `%LOCALAPPDATA%\SevenFriends` |
| Installed web app on a computer (Chrome/Edge) | the website in its own window | the browser profile |

All of them show the **same web app** from https://sevenfriends.web.app (main address later: https://sevenfriends.io). A new deploy of the
website updates every environment at once. The consequence that matters here: **storage is not shared between the browser and an app**,
so anything kept only on the device (a sign-in, a waiting invitation) does not follow the person from the browser into the app.

## 2. Sign-in (built)
Four ways, all on `/login` (`login/`, `core/auth.service.ts`); each ends in the same Firebase account:

| Way | How | Works in |
|---|---|---|
| Email + password | the form; "create account" mode has a repeat password and show/hide | everywhere |
| Phone | an SMS code (`/login/phone`) | everywhere (needs reCAPTCHA in the page) |
| Email link | a link by email opens `/login/link` (`signInWithEmailLink`) | everywhere; the link opens in the **browser**, not in an app |
| Google | `signInWithPopup` | browsers; **not** in a WebView (Google refuses embedded browsers): the Android app cannot use it yet; the Windows app may be refused too |

Consequences: for the app environments the dependable ways are **password, phone and email link**. The email link is the awkward one in an app:
the mail opens the browser, so the person ends up signed in in the browser, not in the app. A rejected sign-in shows a visible "Create account" option.

## 3. Install, per platform

| Platform | The way | Status |
|---|---|---|
| Android phone | **only the Android app** (a `.apk` from the website, no store). The web-app install through Chrome is not offered. | built |
| iPhone / iPad | Safari: Share, Add to Home Screen (no install button exists). Notifications need iOS 16.4 or newer, and only from the home-screen app. A native iOS app is not built. | built (steps), native open |
| Windows PC | the Windows app (installer from the website) | built; not yet compiled on Windows |
| Mac / Linux / other | the browser's own "install" (icon in the address bar), optional | built (steps) |

How the files get to the website: `frontend/public/downloads/` (git-ignored) is published by `npm run deploy:hosting`. Windows: `npm run windows:release` copies the
installer. Android: the Gradle tasks `publishApk` / `deployApp` in `android/app/publish.gradle`. The Install page (`/install-app`, public) and the sign-in page
link show a download button **only when the file is there** (a HEAD request that is not answered with html). Details: `windows/README.md`, `android/README.md`.
Without code signing: Windows SmartScreen warns on the first start; the Android file is debug-signed (fine by hand, not for Google Play).

## 4. Invitations today (built)
Two kinds of link, both opened as the front page of the website:
- `/?invite=<code>`: the person's own code (made on the server the first time: `GET /invite/code`; shown on the profile page and on Add a friend).
- `/?friend=<email or phone number>`: a link to a known contact (the Home page card "Invite people with a link").

What happens (`core/friend-link.service.ts`):
1. At the start of the app the link is read from the address and **removed from the address bar** (`capture()`), and kept in the preferences as `pendingFriend`
   (**on this device only**).
2. The sign-in page says "Sign in or create an account to send a friend request to …".
3. The pending link survives the sign-in itself (Google, an email link, an SMS code) and a reload.
4. After sign-in the person lands on `/friends/join` and **confirms**; only then is the friend request created on the server. Answering (or declining) clears it (`clear()`).

So: the request exists on the server only after the person has signed in **and confirmed**. Until then it is a note on the device.

## 5. The problem
The person opens the invitation **in the browser**, but the right place to use the service is the **app**. Install is a restart on a different storage:
- the waiting invitation (`pendingFriend`) is in the browser's storage and is not seen by the app;
- the browser's sign-in is not the app's;
- a sideloaded Android file gets no "where did you come from" information (only the Play Store gives an install referrer);
- on iPhone the home-screen app starts from its own start address, not from the page it was added from.

## 6. Strategies to carry an invitation across an install

| # | Strategy | Reliable on | Status |
|---|---|---|---|
| A | **Account first.** (built: the welcome page says "Sign in or create an account first" for an invitation) The welcome page offers "create your account, then install". The person signs in **in the browser** and answers `/friends/join`; the request now exists on the server and belongs to the account. After install they only sign in (password, phone) and it is waiting. | everywhere, the most dependable | planned |
| B | **Clipboard.** The welcome page copies the invitation link to the clipboard when the download is tapped, and says so. In the app the person taps **I have an invitation** on the sign-in page and **Paste** (or pastes by hand into the box). | Android, Windows (Android 12+ shows a small "pasted" notice); not iPhone | **built** (`WelcomeService`/`welcome.ts` `copyInvitation`, `login` `pasteInvite`; the Windows app allows clipboard reading) |
| C | **App links (Android).** The app opens links of the website itself (`https://sevenfriends.web.app` and `sevenfriends.io`): tapping the same invitation again after install, or an email sign-in link, opens the app, not the browser. | Android | **built, not tried on a phone**: the intent filter in `AndroidManifest.xml` and `pathOfWebsiteLink` in `MainActivity.java`. Until `/.well-known/assetlinks.json` with the signing key's SHA-256 fingerprint is on the website (`keytool -list -v`), Android asks which app to use. **Open:** that file; Firebase Hosting `ignore` has `**/.*`, which hides `.well-known` and must be changed first. |
| D | **Paste or type the invitation.** The sign-in page (not shown while an invitation waits) has **I have an invitation**: a box that takes the whole link, only the 10-character code, an email address or a phone number (`FriendLinkService.use`). | everywhere, manual | **built** |

Rules for all of them: the link is only ever a **pointer** (a code or a contact), never a sign-in; the person always confirms on `/friends/join`;
a link that cannot be read is ignored (`parseContact`, the code must be 10 letters/digits).

## 7. The welcome page (built)
A public page, `/welcome`, shown **before sign-in** as the **install step**:
- **Shared top** (the same everywhere): the 7 logo, "Seven Friends", the slogan "Stay close to the people who matter most.", the seven dots, and 3–4 short points.
- **Middle: one install action for this platform:** Android phone: Download the Android app; iPhone/iPad: the three Add to Home Screen steps; Windows PC: Download for Windows;
  Mac/Linux/other: the browser's install hint.
- **Below:** "Continue in the browser" (to sign-in). For an invitation the page starts with "<name> invited you", and offers strategy A beside the install.
- **Who sees it:** anyone **not already running as the app** (browser tab). The Android app, the Windows app and the iPhone home-screen app go straight to sign-in. A
  visitor who already has the app installed but opened the browser (the browser cannot tell) just taps "Continue in the browser".
- **Detection:** `core/install.service.ts` (`native`, `installed`/standalone, `ios`, `windows`, `androidDevice`, `windowsApp`: the Windows app adds `SevenFriendsWindows/1.0` to its browser identity).
- **Code:** `welcome/` (page), `hero/` (the shared top, also used by the sign-in page), `core/welcome.service.ts` (when it is due: `shouldShow()`), `core/auth.guard.ts` (`authGuard` sends a signed-out visitor to `/welcome` when it is due, else `/login`), preference `welcomeUntil` (30 days after "Continue in the browser"; a waiting friend invitation always shows the page again).
- **Open:** remember "Continue in the browser" on that device for 30 days? The points' wording. Translations with the language setting.

## 8. Decisions and open points
- Google sign-in in the Android and Windows apps: not solved (a native Google sign-in for Android is the proper fix; for now password, phone or email link).
- The email link opens the browser, not the app: for app users an SMS code or a password is the smoother way. Deep-link support (strategy C) would let the email link open the Android app too.
- The invitation is a device note until confirmed (section 4). If it should survive without the person signing in first, it would have to be stored on the server by a code (strategy D), which is a bigger change.
- Push when an app is not running: Android works (FCM + channels); Windows needs WNS (see `windows/README.md`); iPhone needs the home-screen app (iOS 16.4+).
