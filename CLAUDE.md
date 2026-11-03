# Seven Friends – project guide

An app for staying in contact with your 7 closest friends.

## Structure
- `frontend/` – Angular app (standalone components, signals, Bootstrap 5 + SCSS), hosted on Firebase Hosting.
- `functions/` – Node.js + TypeScript Express backend, deployed as the Firebase Cloud Function `api` (served at `/api/**`).
- `firebase.json` / `.firebaserc` – Firebase config. Link the project with `firebase use <project-id>`.

## Pages
- `/` **Notifications** (home): a quiet page with incoming friend requests and unread messages. No banner, light styling; shows "All quiet" when empty.
- `/friends` **Friends**: the friend circle (7 slots), add/remove friends, pending/confirmed badges.
- `/friends/:id/invite` **Invite your friend**: full-screen page shown after adding somebody who has no account yet. It shows the address / number and the message so the sender can **verify them first**, then **Send email / Send SMS**, **Not now**, or "wrong address, remove and add again".
- `/friends/add` **Add a friend**: a full-screen form that ends with **Cancel** and **Send friend request** (opened from an empty seat on the Friends page).
- `/friends/:id` **Conversation**: the message feed with one confirmed friend (click a confirmed contact, or the chat icon on its card, or Open on a message on Home). Incoming messages appear at once while the page is open (live, see Live updates); a slow 30-second refresh is only a safety net.
- `/pending` **Pending**: incoming friend requests that wait for a free seat (all 7 seats taken). With a free seat they show as a pending friend on `/friends` instead.
- `/profile` **Profile**: account details, an editable **name**, phone and social accounts, all **autosaved** (no Save button, see Profile); reached from the dropup on the bottom menu (also holds Log out).
- `/settings` **Settings**: full-screen page (dropup menu on Profile → Settings) with desktop notifications on/off and where the user picks the sound for each of the three events (new message, friend request, answer to my request) from: No sound, Ding, Chime, Bell, Pop, Marimba, Soft note. Choosing a sound plays it; each row has a Play button.
- `/delete-account` **Delete my account**: full-screen page that erases the user and everything shared with others (see Deleting my account).
- After **creating an account** (any login method) the app opens `/profile` so the person can fill in their details; later logins go to Home. (`AuthService.landingPath()`.)
- `/login` **Login**: Google, phone (SMS code, `/login/phone`), email link (`/login/email`, finished at `/login/link`) and email/password (a verification email is sent at sign-up). `/verify-phone` lets a signed-in user verify a phone by SMS (Profile).
- Bottom menu (always visible when signed in): Home, Friends, Profile (dropup: My profile, Log out).

## Mobile first (important)
**The default use of this app is on a mobile phone.** All UI work must follow this:
- **Every function is a full-screen page.** This is a mobile app, so the standard is: a function (adding a friend, a conversation, the profile, ...) gets its own page and route that fills the screen, not a pop-up.
  - **No pop-ups:** no modals, dialogs, bottom sheets, overlays or `window.confirm` / `alert` / `prompt`. A quick confirmation (like delete) is an **expandable frame inside the page**, under the thing it is about.
  - A sub-page has a **sticky top bar** with a back arrow and the title (see `chat` and `add-friend`). A form page **ends with Cancel and the main action** (for example "Send friend request"). Leave room at the bottom for the bottom menu.
  - The only floating element is the small Profile dropup in the bottom menu: it is navigation (My profile, Log out), not a function.
  - New function checklist: a component in its own folder, a route in `app.routes.ts` (put fixed paths like `friends/add` **before** parameter paths like `friends/:id`), guarded with `authGuard`, and a link or button on the page it comes from.
- Design and build for a ~360–430px wide portrait screen first; add `min-width` media queries to adapt up to tablet/desktop, never the other way around.
- Touch targets at least 44x44px; no hover-only interactions.
- Use the bottom tab bar for primary navigation; keep key actions reachable with one thumb.
- Respect safe areas (`env(safe-area-inset-*)`) and use `100dvh` instead of `100vh`.
- Keep the viewport meta tag (`viewport-fit=cover`) in `frontend/src/index.html`.
- **The bottom menu is always shown when signed in, so every page needs room under its content** (about 4.5rem plus the safe area): `.sf-narrow` already has it; a page with its own layout must add the same bottom padding.
- Test every change in a mobile viewport (browser devtools device mode) before desktop.
- Keep the bundle small and avoid heavy dependencies; assume a slow mobile connection.

## Styling: Bootstrap + overall stylesheet
- Use **Bootstrap 5** (CSS only, loaded in `angular.json` before our styles; no Bootstrap JS) for layout and components: grid (`row` / `col-*`), `btn`, `form-control`, `alert`, `badge`, `card`, `nav`, utilities (`d-flex`, `gap-*`, `text-secondary`, ...). Prefer Bootstrap classes over hand-written CSS.
- **`frontend/src/styles.scss` is the overall stylesheet** (loaded after Bootstrap). Brand colours, font sizes, dimensions and the Bootstrap theme overrides live there as CSS variables. Change values there, not per component.
- Component `.scss` files only hold what Bootstrap cannot do, and use the global variables and `rem` units (never fixed `px` for sizes or fonts).
- The whole app is at most **1000px wide** and centred (`--sf-max-width`). Fixed elements (tab bar, bottom sheet) obey the same limit.

### One set of basic font sizes and dimensions, scaled per view size
Defined as variables in `styles.scss`; the root font size changes per breakpoint, so every `rem` scales with the screen.

| View | Breakpoint | Root font | Gutter | Avatar | Notes |
|---|---|---|---|---|---|
| Phone (default) | < 576px | 16px | 1rem | 2.5rem | single column |
| Large phone | >= 576px | 16px | 1.25rem | 2.75rem | |
| Tablet | >= 768px | 17px | 1.5rem | 3rem | friend list in 2 columns (`col-md-6`) |
| Desktop | >= 1000px | 18px | 2rem | 3.25rem | app column capped at 1000px |

Font scale: `--sf-fs-xs` .75rem, `--sf-fs-sm` .875rem, `--sf-fs-base` 1rem, `--sf-fs-lg` 1.25rem, `--sf-fs-xl` 1.625rem (1.75 from md), `--sf-fs-xxl` 2rem (2.25 from md).
Other dimensions: `--sf-touch` 2.75rem (min tap target), `--sf-gap`, `--sf-radius`, `--sf-hero-pad`, `--sf-form-max`.
Add a new size or breakpoint override in `styles.scss` first, then use the variable.

## Connection rules (friend requests)
These rules are implemented in `functions/src` and covered by the tests in `functions/test` (see Testing). Change a rule in code AND here AND in a test.

### Structure
- `user-account/{uid}/friend-circle/{circleId}`: one document per circle, `{ name, type }`. Types: `friends` (default, the only one available), `family`, `colleagues`. Every user gets a default circle "My friends" (id `default`).
- `.../friend-circle/{circleId}/friends/{id}`: my friend entries. `user-account/{uid}/friend-request/{id}`: requests that reached me. `user-account/{uid}/incoming-signal/{id}`: pings that somebody added me (see Pings). `user-account/{uid}/messages/{id}`: messages.
- **Seats:** max **7** entries per circle (pending, confirmed and rejected all use a seat). The 8th add is refused (409).
- **One connection, one id:** the requester's entry id = the request id = the other person's entry id (also stored as `connectionId`). Each side can always find the other.

### Adding a friend
- Name is required; **an email or a phone number is required** (so the friend can be found). The add-friend page shows only these two search fields (social accounts are not asked for there; they are only contact info on a Profile). Email and phone are validated.
- Adding writes ONE pending entry in the requester's list. **No request and no seat** is created on the other side (that only happens in their check). If the person already has an account, they also get a **ping** (see Pings).

- **A message can be added** to the request (optional, max 500 characters). It is stored on the entry, copied to the other person's request, and shown with the request on Home and on the waiting-list page. It is also part of the invitation below.

### Inviting somebody who is not a user yet
- When adding a friend, if **nobody has an account** for that email or phone (the same search as the pings), the new entry gets `invite: { to, sentAt: null }` **when an email was given**. **There is no SMS invitation**: text messages are only used for login codes (Firebase sends those itself; there is no SMS provider, no Twilio). A friend added only by phone number gets no invitation offer (`invite` is null; nothing can be sent), and the sender can add an email instead. `Friend.invite` is null for people who already have an account (they get the request in the app) and once the friend has signed up.
- **Nothing is sent when the request is added.** The app opens the verify page (`/friends/:id/invite`); only `POST /circles/default/friends/:id/invite` sends. It is refused (409) when the friend has no invitation, was invited already (**once per friend**), or has signed up in the meantime; 429 after `MAX_INVITES_PER_DAY` (20) invitations in 24 hours; 404 for somebody else's friend.
- Sending writes to an outbox in the same transaction that marks `sentAt`: `mail/{id}` (the format of the Firebase Trigger Email extension), which the `sendMail` function sends through your own mail server (see "Sending email"). The document carries `fromUid`, is closed to clients (no rules) and is **erased with the sender**.
- The text holds the sender's name, the message and where to sign up with that same email address. The friend then finds the request through the normal check once they have signed up with it.
- Known trade-off: the add response tells the sender whether the address already has an account (needed to decide whether to offer an invitation). The 20 per day limit and the verified-sender rule limit abuse.

### People who have not verified their email / phone
- **Everybody is reachable**, verified or not: a request arrives whether the address was verified or not. The cost of that (somebody could sign up with your friend's address without proving it is theirs) is paid by **telling the other side**:
  - **Friend card / request card**: the friend entry carries `unverified: ("email" | "phone")[]` and a request carries `fromUnverified`, from the other person's account (`unverifiedDetails` in `validation.ts`): `[]` as soon as ONE detail is verified (a verified email or an SMS-confirmed phone), otherwise every detail the account has. The card says "{Name} has not verified their email / phone, so we cannot be sure it is really them". It shows for both sides, pending or confirmed, until they verify. No invitation is offered (they are a user already).
  - **Front page banner (for the unverified person themselves)**: shown only when nothing of theirs is verified: "Your email is not verified. You still receive friend requests, but your friends are told that you have not verified, because someone else could be using it", with a Verify button to the Profile.
- Known trade-off: somebody who signs up with an address that is not theirs, without verifying it, receives the requests meant for it; the sender's card shows the warning, so they can drop the friend. The requester also learns whether an account exists for an address.

### How the other person finds the request (the "check")
- Runs when they open/tap Home, or open Friends or Pending, or when a ping arrives while the app is open (`POST /api/notifications/check`; overlapping runs are shared).
- It matches *their* email and phone against everyone's **pending** entries, verified or not (see "People who have not verified"):
  - email: case-insensitive. Phone: last 8 digits (`+47 926 55 195` = `92655195`), from the login (confirmed) or the number typed on the Profile. Social accounts never match anyone.
  - Account fields: `emailLower` (the address, any), `emailVerified`, `phoneKey` (confirmed number, else the typed one, kept up to date by the Profile), `verifiedPhone` (only when confirmed by SMS; then the number cannot be edited on the Profile).
- Ignored: their own entries, entries that are not pending, entries already linked to another user, entries that are themselves seats for an incoming request, and any request that already exists (any status).
- A match creates the request (same id) in their inbox and links the requester's entry (`linkedUid`).

### Pings (incoming signals)
- When a friend is added, the backend looks for accounts the new entry points at (same matching as the check: email and phone, verified or not; the person adding is left out) and writes a ping for each: `user-account/{uid}/incoming-signal/{connectionId}` = `{ connectionId, time }`. **A ping holds no names or details.** An entry that points at two accounts pings both. A refused add (full list) pings nobody.
- The check reads the pings at its start and deletes exactly those when it has finished (if the check failed they stay; a ping that arrives meanwhile stays for the next check). A ping is only a wake-up: the request itself only ever comes from the check.
- A ping goes away with its entry: when the requester deletes the entry, when the entry is merged into a connection (both added each other), and when it is dropped as a duplicate.

### Live updates (one common service in the frontend)
`core/realtime.service.ts` is the only place that listens for changes, with Firestore realtime listeners (`onSnapshot`) under the signed-in user's own account. It starts at login and stops at sign-out. The Firestore SDK is loaded after login (a separate download, not in the first one).
- **A ping** (new document in `incoming-signal`): run the ordinary backend search (the check) and reload the friends, so the request shows in the incoming events on Home (and as a pending seat on Friends).
- **A change in my friend list** (any change of an entry under `friend-circle/default/friends`, after the first snapshot): the friends are reloaded at once (changes arriving together are one reload). This is how the **sender hears the answer**: when the other person confirms or rejects, their entry in my list changes, the Friends page updates live, and a desktop notification says "X accepted / rejected your friend request". The same listener catches a friend deleting me or a request being linked.
- **A friend deleting me** is the same change (my entry disappears): the Friends list loses them live and a desktop notification says "X removed the friendship".
- **Listeners restart themselves**: if a listener breaks (connection lost, rules reloading), it starts again after 5 seconds, so live updates do not silently stop until a page reload.
- **A new message** (new unread document in `messages`):
  - if the feed of the person who wrote is **open**, the Chat page shows the message at once and marks it read (it does not turn up on Home);
  - otherwise the search runs, so the message shows in the incoming events on Home.
- Only **new** documents count; documents going away (the backend deleting a handled ping, a message being marked read) never start a search. What is already there when the listener starts is shown once.

### Sound (stage one: while the app is open)
- `core/sound.service.ts` plays a short sound, made in the browser with the Web Audio API (no sound files). Three events, each with **its own chosen sound** (Settings page): **message** (default Ding), **request**, somebody added me (default Chime), **answer**, the other person confirmed or rejected my request (default Soft note). The choices are Ding, Chime, Bell, Pop, Marimba, Soft note, or No sound (that is also how a sound is turned off).
- Triggered only by the realtime service, for **new** things (what was there at start is not announced), and **not for a message in the conversation that is open**. My own messages never make a sound.
- Browsers only allow sound after a first tap/click/key press on the page; before that the sound is silently skipped (it is unlocked at the first interaction).
- The choices are **per device** (`localStorage`, key `sf-sounds`).
- **Volume**: a 0-100 % slider on the Settings page (default 80 %, louder than the first version; per device, `localStorage` key `sf-volume`). The volume is applied on a curve (`MAX_GAIN * (volume/100)^2`), so the slider feels even; letting go of it plays a sample. The device's own volume still applies on top.
- To add a sound: add it to `TUNES` in `sound.service.ts`; the Settings page lists it by itself.
### No notifications inside the page
- **Notifications are shown on the PC screen (the system's own notification, outside the browser), never as a card or pop-up inside the browser page.** There is no toast component. The page itself just updates (lists, badges, the title count); the sound plays. A new kind of notification goes through `DesktopNoticeService.show` (see below), not through an in-page alert.

### Getting attention while the app is in the background
- **Tab title** (`core/attention.service.ts` + `core/app-title.strategy.ts`): the title shows how many things wait, `(2) Friends – Seven Friends` (unread messages + friend requests that have a seat to confirm). While the tab is in the background it flashes between that and "💬 New in Seven Friends". The page titles still come from the route `title`s; the title strategy hands them to the AttentionService.
- **Desktop notification** (`core/desktop-notice.service.ts` + the app's one service worker `frontend/public/firebase-messaging-sw.js`): the operating system's own notification on the **PC screen** (outside the browser window) with the sender and the message (or "X wants to be your friend", "X accepted your friend request", "X removed the friendship"). It shows when something new arrives and the person is **not looking at the app**: the tab is hidden (another tab selected, window minimized) **or the browser window is not in front** (`document.visibilityState` hidden, or `document.hasFocus()` false). Never while the tab is in view and its window is in front. It is shown through the **service worker** (`registration.showNotification`), which Chrome and Edge handle more reliably than `new Notification` from the page (fallback to `new Notification` when no worker). **Every event has its own unique notification id** (`DesktopNotice.id`, used as the notification's tag): the message id (`message-{id}`), the request id (`request-{id}`), `answer-{connectionId}-{status}`, `removed-{connectionId}`. So a new event is never swallowed by an older notice still waiting (the first version re-used a tag per conversation and only the first one showed), and one event is announced **once**, however often it is reported (a listener restarting, the check and the live listener both seeing it). New kinds of notice must pass the id of their event. A click focuses the tab and opens the right page (the worker posts `{type:'open', url}` to the page, which navigates). If the app plays its own sound for that event the notice is silent (no double sound).
- When the browser **blocks** notifications (permission `denied`, or a refused switch), Settings shows an open "How do I allow notifications?" box with the steps for Chrome/Edge, Android, iPhone and Windows. A page can never change a block itself: the person allows it in the browser, then turns the switch on again.
- Settings page → Notifications: a switch that is **per browser** (`localStorage` `sf-desktop-notices` + the browser's permission, so Chrome and Edge each must be switched on), a test button, the permission state and "Last notification: ..." (shown / why it was not shown), to find out why nothing appeared. Windows must also allow notifications for the browser (Settings → System → Notifications; Focus assist off).
- "Show a test pop-up" is always active: if the switch is still off it asks for permission first, then shows the pop-up.
- A page cannot force the browser to the front (browsers forbid it); the pop-up and the title are the way to get attention.

### Setup reminder on Home
- Home shows a blue banner when **sounds** and/or **notifications** are not set up on this device, with a **Settings** button and a ✕ ("not now", hidden for this visit only: `sessionStorage` `sf-setup-hidden`, so it returns the next time the app is opened). It explains the purpose of the app: **Seven Friends is about being there for the people who matter most, and friends can only reach you if you notice them.** The same sentence opens the Settings page.
- *Sounds are set up* once the person has chosen a sound or opened Settings (`SoundService.defined`; opening Settings counts, the defaults are then kept). *Notifications are set up* when the desktop-notification switch or push is on. The banner waits until push has checked what the browser supports (`PushService.checked`), so it does not flash.

### Settings of the system (environment)
- `functions/src/settings.ts` holds the settings that can change **without touching the code**: environment variables of the backend. Put them in `functions/.env` (loaded by `firebase deploy` and the emulators; **copy `functions/.env.example`**, which lists every setting with its default; `.env` is not committed). **No secrets in `.env`**: SMS provider keys belong in Firebase secrets or `functions/.env.local`. Every setting has a default, so none has to be set; an empty value means the default; a literal `\n` is a new line.
- Settings now: `APP_URL` (the sign-up link in invitations, default `https://sevenfriends.web.app/`), `INVITE_EMAIL_SUBJECT`, `INVITE_EMAIL_TEXT` (templates with `{fromName}` `{message}` `{to}` `{appUrl}`; `{message}` is the sender's message in quotes, or empty with no hole left behind). The templates are filled in by `outbox.ts` (`inviteText`, `inviteSubject`).
- **A new text or link that someone may want to change belongs in `settings.ts` (with a default and a line in `.env.example`), not in the code.** After changing `.env`: restart the emulators / deploy the functions.
- Tests: `invitations.test.ts` (defaults, overriding, empty value).

### Sending email (your own mail server)
- `functions/src/mail-trigger.ts` is a Cloud Function (`sendMail`, Firestore trigger `onDocumentWritten` on `mail/{mailId}`) that sends every document written to the `mail` collection through **your own SMTP server** (`nodemailer`); the logic is in `functions/src/mail.ts` (`deliverMail`, testable with a fake transport). The trigger region must match the Firestore database location: set `MAIL_TRIGGER_REGION` (default `europe-west1`).
- **Settings** (`functions/.env`, see `.env.example`): `SMTP_HOST`, `SMTP_PORT` (default 587), `SMTP_SECURE` (`true` = encrypted from the start, usually 465; empty = decided by the port; 587 uses STARTTLS), `SMTP_USER`, `SMTP_PASS` (login only when a user is given), `MAIL_FROM` (the sender, e.g. `Seven Friends <noreply@yourdomain.com>`). Email is only sent when `SMTP_HOST` and `MAIL_FROM` are set; otherwise the document gets `delivery.state = "ERROR"` saying what is missing. These are plain environment variables (not Firebase secrets): keep `.env` private (it is gitignored). The password is read exactly as written (a `\n` in it is not changed), and is never written to a document or a log.
- **The result is kept in the document**, in the same format as the Firebase Trigger Email extension: `delivery: { state: PROCESSING | SUCCESS | ERROR | RETRY, attempts, startTime, endTime, error, info: { messageId, accepted, rejected, response } }`. No `delivery` = not tried yet. **A document is sent once**: the mail is claimed in a transaction, so a function that runs twice (or several at once) for the same document sends it once. An `ERROR` is not retried by itself: after fixing the settings, set `delivery.state` to `"RETRY"` in the Firestore console and it is sent again.
- A mail needs a valid `to` (an address or up to 10), `message.subject` and `message.text` or `message.html`; a bad document gets `ERROR` with the reason.
- **New dependency**: `nodemailer` (+ `@types/nodemailer`): run `npm --prefix functions install` before building. First deploy of a Firestore trigger may ask to enable the Eventarc API and take a few minutes. **The Firestore emulator runs this trigger too**: with SMTP set in `.env`, an invitation sent while developing is really sent; leave the SMTP settings empty locally to only see the document (`delivery.state = ERROR: Email is not set up`).
- Tests: `functions/test/mail.test.ts` (sent once, settings, password never stored, html / single address, two runs at once, server failure then RETRY, not set up, bad documents, an invitation of the app).

### Push notifications (also when the app is closed)
- The phone's or computer's own notification system wakes the device through **Firebase Cloud Messaging**, so a new message, friend request, answer or removal arrives also when the app is closed or the screen is locked (the page itself cannot listen then). The device plays its own notification sound.
- **Frontend**: `core/push.service.ts` (per device, Settings → Push notifications): turning the switch on asks the browser for permission, gets the device's push token (`getToken` with the VAPID key in `environment.vapidKey`) and registers it with `POST /api/push/devices`; switching off or **logging out** removes it (`DELETE /api/push/devices`; `PushService.forgetDevice()` is called before sign-out, so the next person on the same phone gets nothing; the next login does not turn it on again by itself). Push is only available on the deployed site (not with the emulator demo project: `environment.development.ts` has an empty key) and on iPhone only from the Home Screen app.
- **One service worker** (`public/firebase-messaging-sw.js`, scope `/`; a scope can only have one): on `push` it shows the notification (data-only message: `{ id, title, body, url }`), **unless the app is in view and in front** (then the page itself shows the sound and list); `tag` = the event id, so the same event is shown once, also when the open page shows it too; on click it focuses the app and opens `url`. It caches nothing. `firebase.json` serves it with `Cache-Control: no-cache`.
- **Installable app**: `public/manifest.webmanifest` + `public/icons/` (192, 512, apple-touch) and the tags in `index.html`. iPhone only supports push for a site added to the Home Screen (iOS 16.4+).
- **Backend** (`functions/src/push.ts`): devices are `user-account/{uid}/push-device/{hash of token}` (`{ token, createdAt, updatedAt }`). A token belongs to **one account** (registering it takes it away from any other account; needs the `push-device.token` collection-group index exemption in `firestore.indexes.json`). `sendPush(uid, { id, title, body, url })` sends to all devices of the person (high priority, TTL 1 h, title ≤ 100, body ≤ 120 characters), removes tokens FCM says are gone, and **never throws** (a failing push never fails the request; it is awaited, because the function may stop after the response). Sent when: a message is written (to the receiver), a friend is added who has an account (`request-{id}`, with the message), a request is confirmed or rejected (`answer-{connection}-confirmed|rejected`, to the requester), a **confirmed** friendship is ended (`removed-{connection}`, to the other person). The ids are the same as the desktop notification's.
- Push devices are erased with the account (`erase.ts`). The push text carries the sender's name and the start of the message and passes through Google / Apple: mention this to users.
- **Setup once**: Firebase console → Project settings → Cloud Messaging: the Cloud Messaging API enabled, a Web Push key pair generated (its public key is `vapidKey` in `frontend/src/environments/environment.ts`). Deploy to Firebase Hosting (push needs https). The emulator cannot deliver pushes, so `push.test.ts` replaces `firebase-admin/messaging` with a recorder; real delivery is only checked on the deployed site. If a push never arrives: check the browser's notification permission, that the switch is on in Settings, and the function logs for "Could not send the push notification".
- Tests: `functions/test/push.test.ts` (devices register / remove / move between accounts, what is pushed for message / request / answers / removal and to whom, dead tokens removed, a failing push does not fail the request, erase removes devices).

### Security: user control (`firestore.rules`)
- All data goes through the backend: it checks the login on every route and only touches the caller's own data (the Admin SDK ignores the rules).
- The app may only **read** the live data under the signed-in user's **own** account: `incoming-signal`, `messages` and my own friend list (`friend-circle/{circle}/friends`, read by its path, never by a group query). Nobody reads somebody else's, nobody reads with a collection group query, and **nobody writes from the client**, not even on their own account.
- Everything else (profiles, circles, requests) is closed to the client. A new collection is closed until a rule opens it on purpose.
- `functions/test/rules.test.ts` tests all of this against the rules engine, so it only runs with the emulator (`npm run test:emulator`, skipped in `npm test`).

### Seats and the waiting list
- **Free seat:** the request becomes a *pending seat* in their default circle (Friends page) with Confirm / Reject. Oldest request first.
- **No free seat:** the request goes on their **waiting list**, shown ONLY on the Pending page (Home shows just a count link). The requester is informed: their entry shows **Waiting** (`waitingForSeat`, "Their list is full. You are on their waiting list.").
- When a seat frees up, the oldest waiting request moves into the circle and the Waiting flag is cleared (on the next check, and right after a delete on the Friends page).
- **Mutual add** (they added each other): the two entries are merged into one connection with the shared id; no duplicates.

### One connection per pair of people
- Two people never have two connections. At the check, an entry is a **duplicate** (and is dropped from the owner's list) when the owner already has another entry linked to that person (any status), or the person already has a confirmed connection / incoming seat with the owner. Adding the same person twice, or adding someone you are already friends with, therefore ends up as one connection.
- To ask someone again after a **rejection**: delete the rejected entry first, then add again.
- If *they* then add *you* (they rejected you before), their new request replaces the old rejection: it is merged into one pending connection.
- A confirmed connection is never rewritten or merged.

### Answering a request
- **Confirm:** both entries become `confirmed` (same id, both lists), request `accepted`. Confirming with no free seat changes nothing (stays pending). This is NOT a rejection. In the app, confirming on Home opens the Friends page (where the new friend is); with no free seat you stay on Home and see the warning.
- **Reject:** request `rejected`; the requester's entry shows **Rejected** (they can see it); the recipient's pending seat is freed. A confirmed request cannot be rejected (409). A rejected request is never recreated by later checks. Rejection is not a permanent block: after deleting the rejected entry, the requester can add the person again.

### Deleting
- Either side can close a friendship. **Everything the two share is wiped, for both people:** both entries, the request, the pings not yet handled and the whole message feed (both copies of every message). Nothing of it is kept.
- **It happens in ONE Firestore transaction** (`DELETE /circles/default/friends/:id`): all reads first, then all deletes, committed together. All of it goes or none of it.
- Delete before the other person has checked: nothing exists on their side, so only the requester's entry goes. Deleting a waiting request removes it from the other person's waiting list.
- A friend card is **marked when that friend has sent me a message I have not read**: a blue "New message" / "N new messages" badge by the name and a filled chat button. It comes from the unread messages (kept live by the realtime service) and disappears when the feed is opened.
- A friend card shows a status badge (Pending, Waiting, Rejected) **only for those statuses; a confirmed friend has no badge**.
- UI: the trash icon opens an expandable frame under the card (no browser pop-up). Incoming pending seats show Confirm / Reject instead of the trash icon.

### Deleting my account (erase everything)
- **Rule: when a user is deleted, all information about that user is wiped out**: the account and profile, the login (Firebase Auth), every friendship (both entries on both sides, requests sent and received, pings), and every message they sent or received, including the other person's copy of the conversation, and every invitation email they sent (the `mail` outbox). Other people's entries that only name this person (written for their email or phone, never found yet) go too, because they hold the person's name and contact details. Whatever someone writes in a new feature that stores data about a person must be added to `functions/src/erase.ts`.
- API: `DELETE /api/users/me` with the body `{ "confirm": "DELETE" }` (400 without it, so it cannot happen by accident). Code: `functions/src/erase.ts`. Friends are not told; they just lose the friend.
- **All of it happens in ONE Firestore transaction** (all reads first, then every delete, committed together): either the person is gone from every list or nothing changed. Only the login is outside Firestore, so it is removed right after the commit; if that fails the data is already gone and the request can be repeated (it is safe to run twice).
- UI: a full-screen page `/delete-account` (reached from the red "Delete my account" card at the bottom of Profile): explains what is erased, asks to type `DELETE`, ends with Cancel / Delete everything. After success the app signs out and reloads the front page (a full reload, so nothing of the erased account stays in memory).
- Tests: `functions/test/erase.test.ts` (needs the word, removes account/entries/messages/pings/login on both sides, an unrelated connection survives, repeat is harmless, a new sign-up with the same email gets nothing, erase racing with other actions stays consistent, everybody erased leaves nothing, closing a friendship wipes everything shared).
- Needs the Firestore index exemptions in `firestore.indexes.json` (`friends.linkedUid`, `messages.fromUid`, `messages.toUid`): deploy with `firebase deploy --only firestore`.

### Messages (the feed of a connection)
- Only **confirmed** connections can exchange messages (pending, waiting, rejected or unknown friends: 403/404). The feed of a connection is identified by the connection id (the shared id of the two entries).
- A message has `time`, `fromUid`/`fromName`, `toUid`, `text` (1 to 2000 characters, trimmed) and is stored **twice**, once in each person's `messages` collection, with the same message id. The sender's copy is `read`, the receiver's copy is unread until they open the feed.
- Unread messages show up in the Home check (with their `connectionId`, so Home can open the feed). Opening the feed marks the other person's messages as read; only that connection is affected.
- The feed shows the latest 200 messages, oldest first. It is private: only the two people of the connection can read or write it.
- Deleting a connection deletes its feed on both sides.

### Profile (name, phone, social accounts)
- The **name** is editable. It can never be empty (400) and is at most 100 characters. The name from the login is only the starting point: a name the user chose **stays** at the next login.
- It is the name others see in **new** requests, pending seats and messages. Copies made earlier (a friend's list entry, old messages) keep the old name.
- **Autosave**: the page has no Save button. It saves about 0.8 s after typing stops, when a field loses focus, and when the page is left. Every save sends the whole form (`PUT /api/profile`), so saving twice changes nothing. A status line says "Changes not saved yet", "Saving", "All changes saved" or the error with "Try again" (a failed save is retried on the next change or blur).
- An empty name is not sent (the old name stays) while phone and accounts still save. An invalid value (a bad phone number) is refused and nothing is half-saved. An emptied phone or social account is removed.

### Known gaps
- The other person only sees changes when their next check runs (and the requester when the page reloads).
- Connections created before the shared id only delete on the deleting user's side.
- Live updates only reach an app that is open (the listeners run in the page); there are no push notifications. With the app closed, new requests and messages are found by the next check / the next time the feed opens.

## Testing
`functions/test` holds the tests for the connection rules above. They play the rules out in a **pool of 60 people**, with a mocked login, against the real backend routes.

```
npm --prefix functions install     # once (adds vitest, supertest, the rules-test tools)
npm test                           # all tests, ~40 s, no Java and no emulator needed
STRESS_SEEDS=1,2,3,4,5,6,7,8 npm test      # more random runs (default seeds: 1-4)
npm run test:emulator              # same tests on the real Firestore emulator (needs Java 21+)
```
- `mail.test.ts`: the mail trigger (see Sending email).
- `invitations.test.ts`: (also the unverified-friend warning) the message with a request (kept, trimmed, 500 limit, reaches the other person), who is offered an invitation (email, SMS, nobody if they have an account), sending (outbox content, once only, owner only, not after sign-up, daily limit, erased with the sender).
- `push.test.ts`: push devices and what is pushed (see Push notifications).
- `erase.test.ts`: deleting an account and closing a friendship wipe everything on both sides, in one transaction.
- `verification.test.ts`: unverified people are reachable and their friends are told (`unverified`, `fromUnverified`, gone once one detail is verified, the claimant case, typed phone, clearing it), the confirmed phone (not editable, fills the contact number), social accounts never find anybody and anybody can add a friend, verified or not.
- `connections.test.ts`: focused scenarios: matching (email, phone in every format), confirm, reject, delete, waiting list and promotion order, mutual add, duplicates, validation, unread messages.
- `shared-models.test.ts`: the shared models stay shareable (types only, no outside imports) and the copy script works (copies, only rewrites changes, `--check`, removes stale generated files).
- `signals.test.ts`: the pings: who gets one (all 9 ways of identifying a person, never yourself, both accounts of a double match), what is in it, that the check consumes exactly what it saw, and that a ping goes with its entry (delete, merge, duplicate); in the pool: the ring (180 pings, one check each empties them) and 49 pings to one person.
- `rules.test.ts`: the Firestore security rules (user control): own pings and messages readable, nobody else's, no client writes, everything else closed. Emulator only.
- `profile.test.ts`: the name (change, trim, empty/too long refused, kept at the next login, what others see) and the autosave payloads (saving twice, typing letter by letter, an invalid value saves nothing, clearing a field).
- `chat.test.ts`: the message feed: who may message, both people see the same conversation, privacy, per-connection feeds, the 200 limit, text rules, unread/read, and deleting a connection deletes its feed.
- `pool.test.ts`: everyone at once: a ring (each person adds the next 3, all confirm; then all 60 chat with all 6 friends: 360 messages), one popular person (49 ask 1, only 7 seats), and random runs of 500 mixed actions (seeded, so a failure can be replayed with the same seed).
- `helpers.ts` has `assertConsistent()`, which reads everything straight from the database after each scenario and checks: max 7 seats, one id per connection, both sides linked and in the same status, confirmed = both sides, rejected = requester only, no orphan requests, waiting flags only while really waiting, no duplicate connections, and every message exists exactly twice (sender + receiver) on a confirmed connection.
- By default the tests use an in-memory Firestore (`fake-firestore.ts`), which follows the Firestore rules that matter here (transactions: reads before writes, retry on conflict, all-or-nothing; `update` of a missing document fails). Run `npm run test:emulator` now and then to confirm the real emulator agrees.
- On the real emulator the "everyone at once" steps run one person at a time: the emulator locks documents during a transaction, and a ring of people who all write into each other's lists would wait on each other until "Transaction lock timeout". In production this needs many linked people to act in the same instant (the SDK also retries), but if heavy simultaneous use is expected, avoid reading a whole friends collection inside transactions (for example keep a seat counter on the circle).
- **When you change a connection rule: change the code, the "Connection rules" section above, and a test.** A rule is only done when the pool tests still pass.

## Conventions
- **All interfaces and types live in a `models` folder**, never inside a service, component or router file. Import them from `./models` (backend) / `../models` (frontend).
- **The API types are written once and copied into the frontend.** The source is `functions/src/models/shared/` (Friend, FriendRequest, Circle, Message, ChatMessage, Conversation, Socials, ... everything that crosses the API). `scripts/sync-models.mjs` copies it to `frontend/src/app/models/shared/` before every `npm start` / `npm run build` / `npm test` in the frontend (npm pre-hooks), and by hand with `npm run sync:models`. The copy is generated and not committed (gitignored): **never edit it, edit the source**. Nothing is shared as a module; each project compiles its own copy.
  - A shared model holds **types only** (no `const`, function, class or enum) and imports only from its own folder (`./`). The script refuses anything else (backend packages do not exist in the frontend), and `functions/test/shared-models.test.ts` guards it.
  - Backend-only types stay in `functions/src/models/` (`seats.ts`, `outcome.ts`); frontend-only types (page / form types) in `frontend/src/app/models/` (`view.ts`, `social.ts`). The backend routes are typed with the shared models, so a change to an API shape fails to compile on the backend and, after the copy, on the frontend.
  - If you run `ng serve` / `ng build` directly (not through npm), run `npm run sync:models` first. `npm run check:models` (project root) fails if the copy is out of date.
- Angular 20 (pinned because the dev machine runs Node v22.14.0; do not upgrade to Angular 21+ without upgrading Node to >= 22.22.3).
- Standalone components only, no NgModules. Prefer signals and the new control flow (`@if`, `@for`).
- Backend routes live under `/api` and must be reachable through Hosting rewrites.

## Commands
```
npm run sync:models           # copy the shared models into the frontend (also runs before frontend start/build)
npm --prefix frontend install && npm --prefix functions install
npm --prefix frontend run build && npm --prefix functions run build
npm run dev:emulators         # builds the backend first (predev:emulators), then starts auth + functions + firestore. Use this, not a bare `firebase emulators:start`: the emulator runs the COMPILED backend in functions/lib, so without the build it runs old code (new routes answer 404)
npm run dev:frontend          # copies the shared models, then ng serve (http://localhost:4200)
firebase deploy                # builds the frontend first (hosting predeploy), and the backend (functions predeploy), then deploys; hosting serves frontend/dist/frontend/browser
```

## Login methods and console setup
- Phone sign-in (per the Firebase guide): `localhost` is **not allowed** for real SMS (use the emulator, whose log prints the code with the reCAPTCHA check switched off, or up to 10 **fictional test numbers** with fixed codes under Authentication → Sign-in method → Phone → "Phone numbers for testing"). The deployed domain must be under Authorized domains. Phone alone is less secure than the other methods (a number can change hands), so it is offered next to Google / email; the phone page tells people that a text is sent and message rates may apply.
- Google, email/password, email link, phone SMS. People are reachable by their email or phone even when unverified; their friends are told (see People who have not verified).
- **Nobody has to be verified to add a friend or to be added.** Verification only decides what the other side is told (see People who have not verified). A phone login has no email and is confirmed by the SMS code; Google and email-link logins arrive with a verified email. The account document keeps `emailVerified` and `verifiedPhone`, written from the login token at every login, and `GET /profile` returns `emailVerified` / `phoneVerified`. The Verify buttons only appear for what is not verified yet.
- Firebase console: Authentication → enable **Google**, **Email/Password** (with **Email link** switched on) and **Phone**; add your domain under Authorized domains. Phone sign-in needs the **Blaze plan**, costs per SMS, and SMS region policy should allow your countries.
- Emulator: reCAPTCHA is disabled and SMS codes are printed in the auth emulator log; email links are printed there too.
- After backend changes: `npm --prefix functions install`, restart emulators, `firebase deploy --only firestore` (rules and indexes), then deploy functions.
- Known gap: email-link, SMS and rules tests are not automated in the cloud (needs the emulator); they are build-verified only.
- **Never write `firestore.rules` in place while the emulator runs** (a truncating write can be read as an empty file; the emulator then fails every database request with "Rules content empty"). Save the file in one step; if it happens, save the file again and look for "Rules updated" in the emulator log.
