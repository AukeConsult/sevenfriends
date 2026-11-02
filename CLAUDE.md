# Seven Friends – project guide

An app for staying in contact with your 7 closest friends.

## Structure
- `frontend/` – Angular app (standalone components, signals, Bootstrap 5 + SCSS), hosted on Firebase Hosting.
- `functions/` – Node.js + TypeScript Express backend, deployed as the Firebase Cloud Function `api` (served at `/api/**`).
- `firebase.json` / `.firebaserc` – Firebase config. Link the project with `firebase use <project-id>`.

## Pages
- `/` **Notifications** (home): a quiet page with incoming friend requests and unread messages. No banner, light styling; shows "All quiet" when empty.
- `/friends` **Friends**: the friend circle (7 slots), add/remove friends, pending/confirmed badges.
- `/pending` **Pending**: incoming friend requests that wait for a free seat (all 7 seats taken). With a free seat they show as a pending friend on `/friends` instead.
- `/profile` **Profile**: account details; reached from the dropup on the bottom menu (also holds Log out).
- `/login` **Login**: Google and email/password.
- Bottom menu (always visible when signed in): Home, Friends, Profile (dropup: My profile, Log out).

## Mobile first (important)
**The default use of this app is on a mobile phone.** All UI work must follow this:
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
- `.../friend-circle/{circleId}/friends/{id}`: my friend entries. `user-account/{uid}/friend-request/{id}`: requests that reached me. `user-account/{uid}/messages/{id}`: incoming messages.
- **Seats:** max **7** entries per circle (pending, confirmed and rejected all use a seat). The 8th add is refused (409).
- **One connection, one id:** the requester's entry id = the request id = the other person's entry id (also stored as `connectionId`). Each side can always find the other.

### Adding a friend
- Name is required; at least one of email, phone or a social account (Facebook, Instagram, TikTok, Snapchat, X/Twitter, LinkedIn, Telegram). Email and phone are validated.
- Adding writes ONE pending entry in the requester's list and **nothing on the other side**.

### How the other person finds the request (the "check")
- Runs when they open/tap Home, or open Friends or Pending (`POST /api/notifications/check`; overlapping runs are shared).
- It matches *their* email, phone and social accounts against everyone's **pending** entries:
  - email: case-insensitive. Phone: last 8 digits (`+47 926 55 195` = `92655195`). Social: account id (`instagram.com/john.doe` = `@john.doe`).
  - Phone and social accounts must be saved on their Profile first (email is automatic).
- Ignored: their own entries, entries that are not pending, entries already linked to another user, entries that are themselves seats for an incoming request, and any request that already exists (any status).
- A match creates the request (same id) in their inbox and links the requester's entry (`linkedUid`).

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

### Known gaps
- The other person only sees changes when their next check runs (and the requester when the page reloads).
- Connections created before the shared id only delete on the deleting user's side.
- Messages can be received and shown, but not sent yet.

## Testing
`functions/test` holds the tests for the connection rules above. They play the rules out in a **pool of 60 people**, with a mocked login, against the real backend routes.

```
npm --prefix functions install     # once (adds vitest + supertest)
npm test                           # all tests, ~40 s, no Java and no emulator needed
STRESS_SEEDS=1,2,3,4,5,6,7,8 npm test      # more random runs (default seeds: 1-4)
npm run test:emulator              # same tests on the real Firestore emulator (needs Java 21+)
```
- `connections.test.ts`: focused scenarios: matching (email, phone, every social link style), confirm, reject, delete, waiting list and promotion order, mutual add, duplicates, validation, messages.
- `pool.test.ts`: everyone at once: a ring (each person adds the next 3, all confirm), one popular person (49 ask 1, only 7 seats), and random runs of 500 mixed actions (seeded, so a failure can be replayed with the same seed).
- `helpers.ts` has `assertConsistent()`, which reads everything straight from the database after each scenario and checks: max 7 seats, one id per connection, both sides linked and in the same status, confirmed = both sides, rejected = requester only, no orphan requests, waiting flags only while really waiting, no duplicate connections.
- By default the tests use an in-memory Firestore (`fake-firestore.ts`), which follows the Firestore rules that matter here (transactions: reads before writes, retry on conflict, all-or-nothing; `update` of a missing document fails). Run `npm run test:emulator` now and then to confirm the real emulator agrees.
- On the real emulator the "everyone at once" steps run one person at a time: the emulator locks documents during a transaction, and a ring of people who all write into each other's lists would wait on each other until "Transaction lock timeout". In production this needs many linked people to act in the same instant (the SDK also retries), but if heavy simultaneous use is expected, avoid reading a whole friends collection inside transactions (for example keep a seat counter on the circle).
- **When you change a connection rule: change the code, the "Connection rules" section above, and a test.** A rule is only done when the pool tests still pass.

## Conventions
- Angular 20 (pinned because the dev machine runs Node v22.14.0; do not upgrade to Angular 21+ without upgrading Node to >= 22.22.3).
- Standalone components only, no NgModules. Prefer signals and the new control flow (`@if`, `@for`).
- Backend routes live under `/api` and must be reachable through Hosting rewrites.

## Commands
```
npm --prefix frontend install && npm --prefix functions install
npm --prefix frontend run build && npm --prefix functions run build
firebase emulators:start      # http://localhost:5000
firebase deploy
```
