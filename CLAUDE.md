# Seven Friends – project guide

An app for staying in contact with your 7 closest friends.

## Structure
- `frontend/` – Angular app (standalone components, signals, Bootstrap 5 + SCSS), hosted on Firebase Hosting.
- `functions/` – Node.js + TypeScript Express backend, deployed as the Firebase Cloud Function `api` (served at `/api/**`).
- `firebase.json` / `.firebaserc` – Firebase config. Link the project with `firebase use <project-id>`.

## Pages
- `/` **Notifications** (home): a quiet page with incoming friend requests and unread messages. No banner, light styling; shows "All quiet" when empty.
- `/friends` **Friends**: the friend circle (7 slots), add/remove friends, pending/confirmed badges.
- `/friends/add` **Add a friend**: a full-screen form that ends with **Cancel** and **Send friend request** (opened from an empty seat on the Friends page).
- `/friends/:id` **Conversation**: the message feed with one confirmed friend (click a confirmed contact, or the chat icon on its card, or Open on a message on Home). Incoming messages appear at once while the page is open (live, see Live updates); a slow 30-second refresh is only a safety net.
- `/pending` **Pending**: incoming friend requests that wait for a free seat (all 7 seats taken). With a free seat they show as a pending friend on `/friends` instead.
- `/profile` **Profile**: account details, an editable **name**, phone and social accounts, all **autosaved** (no Save button, see Profile); reached from the dropup on the bottom menu (also holds Log out).
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
- Name is required; **an email or a phone number is required** (so the friend can be found). Social accounts (Facebook, Instagram, TikTok, Snapchat, X/Twitter, LinkedIn, Telegram) are optional **contact info only**. Email and phone are validated.
- Adding writes ONE pending entry in the requester's list. **No request and no seat** is created on the other side (that only happens in their check). If the person already has an account, they also get a **ping** (see Pings).

### How the other person finds the request (the "check")
- Runs when they open/tap Home, or open Friends or Pending, or when a ping arrives while the app is open (`POST /api/notifications/check`; overlapping runs are shared).
- It matches *their* **verified** email and **SMS-verified** phone against everyone's **pending** entries (trust model below):
  - email: case-insensitive. Phone: last 8 digits (`+47 926 55 195` = `92655195`). Social accounts never match anyone.
  - The identity comes only from the login token (`verifiedIdentity` in `validation.ts`): `email` counts only when `email_verified` is true, the phone only when it was confirmed by SMS. What someone types on their Profile (phone, social accounts) is contact info and never used for finding people. A verified phone cannot be edited on the Profile.
- Ignored: their own entries, entries that are not pending, entries already linked to another user, entries that are themselves seats for an incoming request, and any request that already exists (any status).
- A match creates the request (same id) in their inbox and links the requester's entry (`linkedUid`).

### Pings (incoming signals)
- When a friend is added, the backend looks for accounts the new entry points at (same matching as the check: verified email and verified phone; the person adding is left out) and writes a ping for each: `user-account/{uid}/incoming-signal/{connectionId}` = `{ connectionId, time }`. **A ping holds no names or details.** An entry that points at two accounts pings both. A refused add (full list) pings nobody.
- The check reads the pings at its start and deletes exactly those when it has finished (if the check failed they stay; a ping that arrives meanwhile stays for the next check). A ping is only a wake-up: the request itself only ever comes from the check.
- A ping goes away with its entry: when the requester deletes the entry, when the entry is merged into a connection (both added each other), and when it is dropped as a duplicate.

### Live updates (one common service in the frontend)
`core/realtime.service.ts` is the only place that listens for changes, with Firestore realtime listeners (`onSnapshot`) under the signed-in user's own account. It starts at login and stops at sign-out. The Firestore SDK is loaded after login (a separate download, not in the first one).
- **A ping** (new document in `incoming-signal`): run the ordinary backend search (the check) and reload the friends, so the request shows in the incoming events on Home (and as a pending seat on Friends).
- **A new message** (new unread document in `messages`):
  - if the feed of the person who wrote is **open**, the Chat page shows the message at once and marks it read (it does not turn up on Home);
  - otherwise the search runs, so the message shows in the incoming events on Home.
- Only **new** documents count; documents going away (the backend deleting a handled ping, a message being marked read) never start a search. What is already there when the listener starts is shown once.

### Security: user control (`firestore.rules`)
- All data goes through the backend: it checks the login on every route and only touches the caller's own data (the Admin SDK ignores the rules).
- The app may only **read** the live data under the signed-in user's **own** account: `incoming-signal` and `messages`. Nobody reads somebody else's, nobody reads with a collection group query, and **nobody writes from the client**, not even on their own account.
- Everything else (profiles, circles, friends, requests) is closed to the client. A new collection is closed until a rule opens it on purpose.
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
- **Confirm:** both entries become `confirmed` (same id, both lists), request `accepted`. Confirming with no free seat changes nothing (stays pending). This is NOT a rejection.
- **Reject:** request `rejected`; the requester's entry shows **Rejected** (they can see it); the recipient's pending seat is freed. A confirmed request cannot be rejected (409). A rejected request is never recreated by later checks. Rejection is not a permanent block: after deleting the rejected entry, the requester can add the person again.

### Deleting
- Either side can delete; the connection (both entries + the request) is removed from **both lists**, whatever its status.
- Delete before the other person has checked: nothing exists on their side, so only the requester's entry goes. Deleting a waiting request removes it from the other person's waiting list.
- UI: the trash icon opens an expandable frame under the card (no browser pop-up). Incoming pending seats show Confirm / Reject instead of the trash icon.

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
- `verification.test.ts`: the trust model: unverified email or typed phone finds nobody, impersonation with an unverified email, stale keys cleared at login, a later verification finds earlier requests, verified phone not editable, social accounts useless for matching.
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
firebase emulators:start      # http://localhost:5000
firebase deploy
```

## Login methods and console setup
- Google, email/password, email link, phone SMS. Only a verified email or an SMS-verified phone lets others find you.
- Firebase console: Authentication → enable **Google**, **Email/Password** (with **Email link** switched on) and **Phone**; add your domain under Authorized domains. Phone sign-in needs the **Blaze plan**, costs per SMS, and SMS region policy should allow your countries.
- Emulator: reCAPTCHA is disabled and SMS codes are printed in the auth emulator log; email links are printed there too.
- After backend changes: `npm --prefix functions install`, restart emulators, `firebase deploy --only firestore` (rules and indexes), then deploy functions.
- Known gap: email-link, SMS and rules tests are not automated in the cloud (needs the emulator); they are build-verified only.
