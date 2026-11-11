# Seven Friends – project guide

An app for staying in contact with your 7 closest friends.

## Where the rest of the guide is (read the file BEFORE changing that area)
The long parts of this guide live in `docs/guide/`. Read only the file for the area you are working on:
- `docs/guide/connections.md`: friend requests, seats, waiting list, deleting a friend / account, the rules the pool tests check. **Only a change to a connection rule needs the "change code + this guide + a test" routine.**
- `docs/guide/live-and-notifications.md`: pings, live updates, sound, push, email, several devices, system settings.
- `docs/notifications.md`: **the push rules** (delivery, TTL, one sound for all circles, Android channels, browser limits) and the Android notification screen. Read it before changing a push or a sound.
- `docs/guide/messages-and-profile.md`: the message feed, profile, links in messages, friend links, sleep list, UI preferences.
- `docs/guide/media-and-safebox.md`: the media cache, the safebox, pictures and memory.
- `docs/design/safebox-objects.md`: notes, secrets, links, checklists, places, contacts and dates in the safebox next to files: locked payload, revision, routes, pages. All are built.
- `docs/design/default-key.md`: the proposed lock by default that the provider cannot open: silent device keys and a signed device list, signed messages, pairing by link secret, a rotation that re-encrypts old items, the rescue code, and bundled app code. Step 1 (silent keys, signing key, signed device list) is built; the rest is a proposal.
- `docs/design/resources.md`: the proposed Resources (something of value that is lent, given, booked or shared inside a friendship or a group): words, data model, the five things, rules, API, steps. Proposal only; nothing is built.
- `docs/design/safebox-encryption.md`: the proposed end-to-end encryption of the safebox (keys, data model, flows, rollout). Steps 1 and 2 are built. The lock by default (`docs/design/default-key.md`) now makes keys silently.
- `docs/design/recovery-by-friend.md`: the plan for key recovery by a friend (Way 2; Way 1 is the own devices and the 24 words, both in `docs/design/message-encryption.md`, "Recovery: the two ways"). Nothing of the plan is built yet.
- `docs/design/recovery-own-devices.md`: Way 1 of key recovery (my own other device "Allow", and my 24 words): how it works, what is weak, and the plan. Not built yet.
- `docs/design/groups.md`: groups (a friend with several people): data, the functions (make, change, add and remove members), what is not done yet. Built and tested on the backend.
- `docs/guide/apps-and-login.md`: Android / iPhone / Windows apps, login methods, first-time setup.
- `docs/guide/testing.md`: the backend tests (`npm test`, the 60-person pool, the emulator). A UI-only change needs no backend test run.

## Structure
- `frontend/` – Angular app (standalone components, signals, Bootstrap 5 + SCSS), hosted on Firebase Hosting.
- `functions/` – Node.js + TypeScript Express backend, deployed as the Firebase Cloud Function `api` (served at `/api/**`).
- `firebase.json` / `.firebaserc` – Firebase config. Link the project with `firebase use <project-id>`.

## Pages
- `/` **Notifications** (home): a quiet page with incoming friend requests and unread messages. No banner, light styling; shows "All quiet" when empty.
- `/friends` **Friends**: the friend circle (7 slots), add/remove friends, pending/confirmed badges.
- *(removed)* The `/friends/:id/invite` page is gone: the app sends no email or SMS invitations. People are invited with a friend link (see Friend links).
- `/friends/add` **Add a friend**: a full-screen form that ends with **Cancel** and **Send friend request** (opened from an empty seat on the Friends page).
- `/friends/:id` **Conversation**: the message feed with one confirmed friend (click a confirmed contact, or the chat icon on its card, or Open on a message on Home). Incoming messages appear at once while the page is open (live, see Live updates); a slow 30-second refresh is only a safety net.
- `/friends/:id/image` **Send an image** and `/friends/:id/video` **Send a video** (one page, `add-media`, the route has `data: {kind}`): full-screen page opened from the image or video icon in the message field of a conversation: **Take a photo** / **Record a video** and **Choose an image** / **Choose a video**, a preview (picture or a video with controls) with its name, size in pixels, length and bytes, an optional text (the caption), **Cancel** and **Send**. See "Media cache" (app side).
- `/friends/:id/audio` **Send a voice message** (the same `add-media` page, `data: {kind: 'audio'}`): opened from the microphone icon in the message field: **Record a voice message** (the recorder is on the page, on phones too) and **Choose an audio file**, a player to listen before sending, name · length · bytes, an optional text, **Cancel** and **Send**.
- `/media/:ownerId/:objectId` **Image, video or audio**: full-screen viewer of an image, a video or an audio message of a message (opened from a friend's image in the feed, from the **⤓** button on a video or an audio message, or **Open** on any of my own); the title is the file name, under it the type and size, and a **Download** button that saves the file on the device under its file name (an `<a download>` on the bytes already read from the server; an extension is added from the type if the name has none).
- Recovery has no page of its own: **Settings → Privacy lock** (`/settings/encryption`) shows whether this device has locked items or no working key, and the ways to get them back (my other devices, my 24 words, my friends). The band under the header of a friend's page leads there (`?from=` is where to go when it is done). Home shows nothing about it. See `docs/design/recovery-own-devices.md`.
- `/friends/:id/safebox` **Safebox**: files and notes in one list; `/friends/:id/safebox/link/:itemId` **Link with…** (pick another item to link it with; see the safebox design), `/friends/:id/safebox/note` **New note** and `/friends/:id/safebox/new/file` **New file** (upload: choose, drop or take a photo; opened by the File pill of the New frame or the header menu), `/friends/:id/safebox/note/:itemId` **Note** (read and change, a full-screen page of the friend page), and `/friends/:id/safebox/new/:type` / `/friends/:id/safebox/object/:itemId` for a secret, link, checklist, place, contact, date, ticket, album or case (one page, `safebox-object/`; see `docs/design/safebox-objects.md`). Every object can have attachments (`safebox-attachments/`). The safebox list has a **New** frame to pick the kind, and a List / Icons switch.
- `/pending` **Pending**: incoming friend requests that wait for a free seat (all 7 seats taken). With a free seat they show as a pending friend on `/friends` instead.
- `/settings/profile` **Profile** (the FIRST tab of Settings; `/profile` redirects there; the bottom menu has no Profile button): account details, an editable **name**, phone and social accounts, all **autosaved** (no Save button, see Profile); reached from the dropup on the bottom menu (also holds Log out).
- `/profile/picture` **Your picture**: full-screen page to upload a profile picture (see "My own picture").
- `/sound-and-notifications` **Sound and notifications** (the page is called this everywhere in the app; the component folder is still `frontend/src/app/settings/`): full-screen page (dropup menu on Profile → "Sound and notifications") with desktop notifications on/off and where the user picks the sound for each of the three events (new message, friend request, answer to my request). Each event shows its chosen sound as a row that opens the full-screen page `/sound-and-notifications/:event` (`frontend/src/app/sound-picker/`; never a drop-down, which can open outside the screen) listing No sound, Ding, Chime, Bell, Pop, Marimba, Soft note and the jingles (the jingles are listed first, under "Seven Friends jingles"). Choosing a sound plays it; every row has one Play button that becomes a Stop button while its tune plays (one tune at a time: pressing it again stops the tune, another tune replaces it); the choices and the volume are saved on the account.
- `/delete-account` **Delete my account**: full-screen page that erases the user and everything shared with others (see Deleting my account).
- After **creating an account** (any login method) the app opens `/settings/profile` so the person can fill in their details; later logins go to Home. (`AuthService.landingPath()`.)
- `/login` **Login**: Google, phone (SMS code, `/login/phone`), email link (`/login/email`, finished at `/login/link`) and email/password (a verification email is sent at sign-up). `/verify-phone` lets a signed-in user verify a phone by SMS (Profile).
- Bottom menu (always visible when signed in): Home, Friends, Profile, Settings (all four are plain links; there is no drop-up). **Log out** and Delete my account are in the "Account" card at the bottom of the Profile page. **Settings is ONE page with a tab for each part** (`settings-shell/`: Display and chat (route `preferences`), Notifications, Privacy lock, Install (browser only), About and rules (About, Terms, Privacy); each tab is a child route `/settings/<tab>` that shows the existing page; the sound picker is `/settings/sounds/:event`; `/privacy`, `/terms`, `/about` also exist without tabs for someone who is signed out, and `/sound-and-notifications` redirects to `/settings/sounds`).

## Mobile first (important)
**The default use of this app is on a mobile phone.** All UI work must follow this:
- **Every function is a full-screen page.** This is a mobile app, so the standard is: a function (adding a friend, a conversation, the profile, ...) gets its own page and route that fills the screen, not a pop-up.
  - **No pop-ups:** no modals, dialogs, bottom sheets, overlays or `window.confirm` / `alert` / `prompt`. A quick confirmation (like delete) is an **expandable frame inside the page**, under the thing it is about.
  - A sub-page has a **sticky top bar** with a back arrow and the title (see `chat` and `add-friend`). A form page **ends with Cancel and the main action** (for example "Send friend request"). Leave room at the bottom for the bottom menu.
  - There is no floating menu any more: the bottom menu has four plain links.
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
- **Only 4 font sizes exist** (`src/styles.scss`, `:root`): `--sf-fs-description` (the smallest: descriptions, hints, notes, labels, badges, small buttons), `--sf-fs-text` (normal text, inputs), `--sf-fs-title` (titles of sections, cards, pages) and `--sf-fs-heading` (big headings). They scale with the view size (the root font size). **Never write another font size**: use one of the four variables or the classes `.sf-fs-description`, `.sf-fs-text`, `.sf-fs-title`, `.sf-fs-heading` (Bootstrap's `small`, `h1`–`h6`, `btn-sm`/`btn-lg`, badges and form texts are already mapped to them). Big decorative glyphs (the logo "7", the back arrow ‹, the moon, a big initial) are pictures, not text, and may have their own size. Changing the look of all small texts means changing ONE variable.
- **Section headings inside a page use `.sf-section-title`** (`<h2 class="sf-section-title m-0">`): the normal text size, bold, as big as the page title and never bigger. Do not size such headings with `h5`, `fs-*` or per-page CSS; change the one class in `styles.scss` to change them all.
- Use **Bootstrap 5** (CSS only, loaded in `angular.json` before our styles; no Bootstrap JS) for layout and components: grid (`row` / `col-*`), `btn`, `form-control`, `alert`, `badge`, `card`, `nav`, utilities (`d-flex`, `gap-*`, `text-secondary`, ...). Prefer Bootstrap classes over hand-written CSS.
- **`frontend/src/styles.scss` is the overall stylesheet** (loaded after Bootstrap). Brand colours, font sizes, dimensions and the Bootstrap theme overrides live there as CSS variables. Change values there, not per component. Radio buttons, checkboxes and switches that are not selected have a dark 2px border (`.form-check-input:not(:checked)`), so they are always visible.
- **No page-local or component-local CSS.** There are no component `.scss` files and components have no `styleUrl`: ALL styles live in `styles.scss`, as the standard `sf-*` layout classes, and templates only use those plus Bootstrap utilities. Standard classes: `sf-bar`/`sf-back`/`sf-bar-title` (sub-page top bar), `sf-narrow` (form column), `sf-page` (+`sf-page-first` when no bar above), `sf-content`, `sf-feed`, `sf-landing`, `sf-page-head`, `sf-hero`, `sf-heading`, `sf-section`, `sf-hint`, `sf-field`, `sf-actions`, `sf-list`/`sf-list-item`/`sf-list-text`, `sf-avatar`(`-sm`, `-empty`), `sf-photo`, `sf-choices`/`sf-choice`, `sf-summary`, `sf-expand`, `sf-card`, `sf-profile`, `sf-menu*`, `sf-composer`. A new page reuses these; a new look is added to `styles.scss` as a new standard class (rem units and the variables only, never fixed `px` for sizes or fonts). Every routed page is `display:block; min-height:100dvh` (one rule on `router-outlet + *`); the page classes keep room for the always-visible bottom menu.
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

## Words in the app (one word per idea)
Use plain words and ONE word for each idea: **seat** (one of the 7 places), **sleep** (a friend who keeps the chat but gives up the seat; never "silent"), **friend**, **safebox**, **poke** (makes a friend's phone ring even when you sleep on their list). Do not show **circle** to users (it is an internal app type), nor "connection" or "contact" for a friend. A new word is explained once, in one line, where it first appears.

## Conventions
- **All interfaces and types live in a `models` folder**, never inside a service, component or router file. Import them from `./models` (backend) / `../models` (frontend).
- **The API types are written once and copied into the frontend.** The source is `functions/src/models/shared/` (Friend, FriendRequest, Circle, Message, ChatMessage, Conversation, Socials, ... everything that crosses the API). `scripts/sync-models.mjs` copies it to `frontend/src/app/models/shared/` before every `npm start` / `npm run build` / `npm test` in the frontend (npm pre-hooks), and by hand with `npm run sync:models`. The copy is generated and not committed (gitignored): **never edit it, edit the source**. Nothing is shared as a module; each project compiles its own copy.
  - A shared model holds **types and plain data** (constants and small pure functions, like `languages.ts`) and imports only from its own folder (`./`). The script refuses any other import (backend packages do not exist in the frontend), and `functions/test/shared-models.test.ts` guards it.
  - Backend-only types stay in `functions/src/models/` (`seats.ts`, `outcome.ts`); frontend-only types (page / form types) in `frontend/src/app/models/` (`view.ts`, `social.ts`). The backend routes are typed with the shared models, so a change to an API shape fails to compile on the backend and, after the copy, on the frontend.
  - If you run `ng serve` / `ng build` directly (not through npm), run `npm run sync:models` first. `npm run check:models` (project root) fails if the copy is out of date.
- **All text the user reads is translated (Transloco, `@jsverse/transloco`).** English is the source; the other languages mirror it.
  - The texts are files: `frontend/public/i18n/<language>/<scope>.json` (one scope per page, named like its folder, for example `login`), and `common.json` for the texts every page uses (`common.*`, `nav.*`, `errors.*`). The file has no scope wrapper; the key in code is `<scope>.<key>`.
  - A component declares its file with `providers: [provideTranslocoScope('login')]`, imports `TranslocoDirective` and wraps its template in `*transloco="let t"`.
  - **Always write the English text next to the key:** `{{ t('login.signIn') || 'Sign in' }}`, `[attr.placeholder]="t('login.email') || 'Email'"`. A missing text is `''` (`EmptyMissingHandler`), so the English text shows for a language or key that has no translation yet. Variables: `t('login.friendLink', { one: w.one })` with `{{ one }}` in the file.
  - TypeScript: `tr('login.enterEmail', 'Enter your email first.')` from `core/i18n.ts`. Never write a user-visible English string without a key.
  - When you add or change text, change the key in `public/i18n/en/<scope>.json` in the same change.
  - The language comes from `core/language.service.ts`: the account's language, else its country's, else this device (`UiPreferences.language`), else the browser, else English. It also sets `<html lang>` and `dir`. `useAccount()` is called after Profile or Setup saves.
  - `npm run check:i18n` (project root, `scripts/check-i18n.mjs`) fails when a key used in the code is missing in English, or when another language lacks a file or key that English has (`--unused` also lists English keys nobody uses). Run it after changing any text.
- Angular 20 (pinned because the dev machine runs Node v22.14.0; do not upgrade to Angular 21+ without upgrading Node to >= 22.22.3).
- **Never inject the `Router` straight into a core service that the Router itself depends on.** The Router needs the title strategy, which needs `AttentionService`, which needs `MessagesService`, `FriendsService` and so `ApiService`: `ApiService` injecting `Router` is a circular dependency (NG0200) that builds fine but leaves a **blank page**. Fetch it when needed with `inject(Injector).get(Router)` (as `ApiService` does). A build does not catch this: open the app after changing what a core service injects.
- **Safebox code layout:** the list page is `frontend/src/app/safebox/safebox.ts`; every other safebox component is a sub-folder of it (`safebox/safebox-note/`, `safebox-object/`, `safebox-view/`, `safebox-upload/`, `safebox-attachments/`, `safebox-capture/`, `safebox-link/`, `safebox-link-new/`, `safebox-links/`). A new safebox sub-page goes there too; its routes stay in `app.routes.ts`.
- **Safebox texts are ONE translation scope:** `frontend/public/i18n/<lang>/safebox.json`, grouped as `common` (texts used by several pages: cancel, back, takeItOut, allItems ...), `list`, `object`, `note`, `view`, `upload`, `attachments`, `link`, `linkNew`, `links`, `capture`. Keys are written `t('safebox.common.cancel')`, `t('safebox.note.title')`; every safebox component (and `core/safebox-objects.ts`) uses `provideTranslocoScope('safebox')` / `tr('safebox....')`. A text a second page needs goes in `common`, not copied. Add a new text to English first, then every language.
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

## Design system (all pages share it)

- Colours (tokens in `styles.scss`): navy `--sf-primary #2f4b7c` (Norwegian, soft), flag red `--sf-red #ba0c2f` for small accents and danger, page `--sf-bg #fffbe9` (slightly yellow), header `--sf-header #fde6c6`, cards/fields white with warm border `--sf-border`. Bootstrap's own blue is overridden everywhere (outline buttons, focus rings, checkbox, range).
- One size per control: buttons and fields 3rem (`--sf-control`), `.btn-sm` 2.25rem; all buttons are pills. Do not use btn-lg, form-control-lg, rounded-pill, shadow-sm or per-page padding utilities.
- **Buttons are small by default.** The 3rem `.btn` is only for the ONE main action of a page or form (Sign in, Next, Save, Add a friend). Every other button (secondary actions, buttons inside cards, notices and alerts, lists of choices, the buttons of a card on the friends or sleep list) is `btn-sm`, and several together share the row (`d-flex gap-2`, `flex-fill`) instead of one full-width 3rem button each. When unsure, use `btn-sm`.
- **Every page except Home and Login starts with `<app-page-bar>`** (`frontend/src/app/page-bar/`; it renders the sticky tinted `.sf-bar`): `[title]`, optional `[subtitle]`, a back arrow only on sub-pages (`[backTo]` = link, or `[backButton]` + `(backClick)`), page actions projected as `.sf-bar-icon` buttons (`.sf-bar-danger` for delete), an icon with the `barIcon` attribute. Pages of a friend (profile, safebox, locking, recovery) sit under the friend's own bar and use `[sub]="true"` (not sticky, no tint). Settings shows one bar and the tabs under it; the pages inside do not show their own. Never write a page header by hand (`sf-page-head`, `sf-back-row` and `sf-head-*` are gone). Home has no header; Login has the `.sf-hero` band (logo, name, tagline, seven dots).
- Chat header actions use `.sf-tool-btn` (icon + label). The cleanup panel puts the match count and the delete button on one `.sf-cleanup-row` (wraps only on very narrow screens).
- Youthful touches: press feedback (scale .96), gradient own bubbles, pill nav highlight. Bottom nav and composer stay white.
- Not done: PWA icon files in `public/icons` still use the old purple gradient.

## Secrets (`.env`)
`.env` (in `.gitignore`, template in `.env.example`) holds the Firebase service account key and the Android settings. `npm run android:config`
(`scripts/android-config.mjs`) uses the key to make `android/app/google-services.json` (also in `.gitignore`). Never commit or print the key.
