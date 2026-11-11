# Seven Friends

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)

A calm, simple app for staying in touch with the seven people who matter most to you. Seven seats, no feed, no ads, no noise:
you notice your friends, and they notice you.

Live at **https://sevenfriends.io** · made by **Blueboot R&D AS**, Norway.

## Contents

- [What it does](#what-it-does) · [How it works](#how-it-works) · [Pages and screens](#pages-and-screens)
- [Tech](#tech) · [Getting started](#getting-started) · [Documentation map](#documentation-map)
- [Security and privacy](#security-and-privacy) · [Contributing](#contributing) · [Trademarks and brand](#trademarks-and-brand) · [License](#license)

## What it does

Seven Friends is built around one idea: **keep the few people who matter close, and nothing else.** Every feature below follows from that.

### Friends and seats
- **Seven seats.** You have seven seats in each circle. A friend sits in a seat, so the app can never turn into a long list of contacts.
- **Friend requests.** Add a friend by name, email, phone, or with a **friend link** you send yourself (the app sends no invitation email or text). The other person confirms or rejects.
- **Waiting list.** When all your seats are taken, new requests wait on a *Pending* page until you free a seat.
- **Sleep list.** Put a friend to sleep to give the seat back without losing the conversation. A sleeping friend's messages arrive silently, and you wake them up when you have a seat again. The sleep list is a page of its own, styled like the front page.
- **Verified or not.** Nobody has to verify an email or phone to join. The other side is only told when a contact is not verified, and you can mark "this is really them".
- **Deleting.** Deleting a friend, or your whole account, removes what you shared and tells the people it affects.
- Details: [`docs/guide/connections.md`](docs/guide/connections.md), [`docs/invite-install-login.md`](docs/invite-install-login.md)

### Circles
- The same app runs up to four separate **circles**: *Friends*, *Buddies*, *Work* and *Family*. Each has its own seven seats, name, colour, moods and welcome pages, and one app shows one circle at a time. Switching circle rebuilds every page, so nothing leaks between them.
- Preferences (theme, text size, message order, ready-made messages) are saved per circle.
- Details: [`docs/design/circles.md`](docs/design/circles.md), "Push and circles" in [`docs/guide/connections.md`](docs/guide/connections.md)

### Groups
- A **group is a friend with several people in it** (at most seven in a seat, like a friend). It has its own conversation, its own safebox, a name, a description and a picture.
- Any member can add one of their **own confirmed friends**, so every membership rests on a friendship somebody in the group already trusts. People can leave at any time, and the last one out deletes the group and everything in it.
- The profile of a group shows every member as a badge with their picture. In the feed every message shows who wrote it.
- Details: [`docs/design/groups.md`](docs/design/groups.md)

### Messages and media
- **Conversation feed** with each friend or group: text, pictures, video, voice messages and captions, edit and delete, sort order, and a clean-up of old messages.
- **Links** in messages are clickable and show a page preview in a frame.
- **Pings.** A message can be sent as a gentle "poke" that gets through even to a friend who has you on their sleep list.
- **Ready-made messages** you write once and send with a tap.
- **Media cache.** Pictures, video and audio are made small on your device, cached, and shown fast on a slow connection.
- Details: [`docs/guide/messages-and-profile.md`](docs/guide/messages-and-profile.md), [`docs/guide/media-and-safebox.md`](docs/guide/media-and-safebox.md)

### The safebox
- A **safebox** is shared by two friends (or by a group): files and small notes only you see. Nothing is shown to anybody else, and nothing in it is sent unless you choose to tell your friend.
- It holds **files** (pictures, video, audio, documents) and ten kinds of **objects**: note, secret, link, checklist, place, contact, date, ticket, album and case. Items can be **linked** to each other, and a short "tell your friend about this" message points to an item.
- Views: a list and a grid of icons, with search and a size limit per box.
- Details: [`docs/guide/media-and-safebox.md`](docs/guide/media-and-safebox.md), [`docs/design/safebox-objects.md`](docs/design/safebox-objects.md)

### Locked messages and files (end-to-end encryption)
- When both friends (or every member of a group) have a key, messages and safebox items are **locked on the devices** (AES-256-GCM, with each item's key locked for every device key with RSA-OAEP 3072). The server only stores unreadable data.
- Keys never leave the device. A lost key can be restored in three ways: from your **24 recovery words**, from **another device of your own**, or from **your friend's device**. The app tells you when a friend gets a new key.
- If a friend has no key yet, the conversation works as before and the app says plainly that it is not private yet.
- Details: [`docs/design/safebox-encryption.md`](docs/design/safebox-encryption.md), [`docs/design/message-encryption.md`](docs/design/message-encryption.md), [`docs/design/recovery-own-devices.md`](docs/design/recovery-own-devices.md), [`docs/design/recovery-by-friend.md`](docs/design/recovery-by-friend.md)

### Presence, moods and profile
- A small **mood** and a quiet **presence** dot for each friend. Your own **profile** has your name, picture or an icon, phone, social accounts and country, and it saves itself as you type.
- A friend's profile page shows what they chose to share, and holds the actions for that friend (sleep, wake, delete, or leave a group).
- Later: [`docs/design/friend-statistics.md`](docs/design/friend-statistics.md) (considerations only, nothing built).

### Notifications, sound and live updates
- **Live updates** while the app is open: a message, a request or a change by another of your devices appears at once, with a slow refresh as a safety net.
- **Push** to the browser, installed web app and Android, also when the app is closed. You choose what is sent, and can hide the text on the lock screen.
- **Sounds.** Pick a sound for each of three events (new message, friend request, answer to my request): short tones or Seven Friends jingles. The same sound is used in every circle.
- Home is a quiet page: "All quiet" when nothing needs you, otherwise only the requests and unread messages.
- Details: [`docs/notifications.md`](docs/notifications.md), [`docs/guide/live-and-notifications.md`](docs/guide/live-and-notifications.md)

### Signing in and joining
- Sign in with **Google**, **phone (SMS code)**, an **email link**, or **email and password**. Several devices can be signed in at once and stay in sync.
- **Invite by link.** The welcome pages show the right next step for the phone, tablet or computer you open them on, and a request survives sign-up and install.
- A short **setup wizard** guides a new person through name, picture, notifications, privacy lock and the first friend, and the app offers it again if it was skipped.
- Details: [`docs/guide/apps-and-login.md`](docs/guide/apps-and-login.md), [`docs/invite-install-login.md`](docs/invite-install-login.md)

### Apps and languages
- One web app, plus thin **Android**, **iPhone** and **Windows** apps that show it, and an installable browser app (PWA).
- **22 languages**, with English as the source and the others mirroring it.
- Built for the phone first: every function is a full-screen page, there are no pop-ups, the navigation sits at the bottom, and the layout follows one set of font sizes and dimensions.

### Coming: resources
- A **resource** is something of value that can be lent, given, booked or shared inside one friendship or one group: a drill, the cabin in July, a lift to school, eggs from the hens. Each friendship and group gets a **resource pool**. Money is deliberately left out.
- Status: a proposal, nothing is built. See [`docs/design/resources.md`](docs/design/resources.md).

## How it works

```
 Browser / Android / iPhone / Windows
                │   (one Angular app, shown by thin wrappers)
                ▼
       Firebase Hosting  ──/api/**──►  Cloud Function "api" (Express, TypeScript)
                │                                   │
                │                                   ▼
       Firebase Auth, Cloud Messaging ◄──►  Firestore + Storage
```

- The frontend talks to the backend only through `/api/**`. The backend checks who is asking, who may do what, and the rules of seats and connections.
- A **connection** (a friendship or a group) is the key to everything shared: the same id ties the conversation, the safebox and the seats together, and a group is simply a connection with more than one other person.
- With keys in place the server never sees what is written or saved. It only routes, checks sizes and rules, and sends the push.
- The API types are written once and shared with the frontend (see below), so a change to an API shape fails to compile on both sides.

## Pages and screens

| Page | What |
| --- | --- |
| Home (`/`) | Quiet page with requests and unread messages, your seven, the sleep list entry |
| Friends and groups | Seats, add a friend, a friend's profile, the conversation, send a message, send an image / video / voice |
| Safebox | List and grid, new file, note and objects, links between items |
| Locking and recovery | Locking and keys, recovery by words, by own devices, by a friend |
| Sleep list and Pending | Friends who sleep, requests waiting for a seat |
| Settings | Profile, preferences, sounds and notifications, encryption keys, install, privacy, terms, about |
| Sign-in and setup | Login methods, welcome pages, the setup wizard, delete my account |

The full list of routes and the design rules for the pages are in [`CLAUDE.md`](CLAUDE.md).

## Tech

| Part | What |
| --- | --- |
| `frontend/` | Angular 20 (standalone components, signals), Bootstrap 5 + SCSS, Capacitor 8 for Android and iPhone |
| `functions/` | Node.js 22 + TypeScript, Express, deployed as the Firebase Cloud Function `api` (`/api/**`, region `europe-west1`) |
| Firebase | Authentication, Firestore, Storage, Hosting, Cloud Messaging |
| `android/`, `ios/` | Capacitor wrappers around the live web app |
| `windows/` | .NET 8 WPF app with a WebView2 window, plus an Inno Setup installer |
| `scripts/` | Build helpers (shared models, sounds list, Android and iPhone config, release publishing) |
| `docs/` | The project guide and design notes |

The API types are written once in `functions/src/models/shared/` and copied into the frontend by `scripts/sync-models.mjs`
(it runs before every frontend start and build). Edit the source, never the copy.

## Getting started

You need **Node.js 22**, the **Firebase CLI** (`npm i -g firebase-tools`), and **Java 21+** if you run the emulators.

```bash
git clone https://github.com/AukeConsult/sevenfriends.git
cd sevenfriends
npm run install:all           # installs frontend/ and functions/
cp .env.example .env          # fill in what you need (see below); .env is never committed
firebase use <your-project-id>
```

Run it locally:

```bash
npm run dev:emulators         # builds the backend, starts auth + functions + firestore + storage emulators
npm run dev:frontend          # second terminal: ng serve on http://localhost:4200
```

Run the tests (the backend tests need no emulator and no Java):

```bash
npm test                      # the backend tests, ~40 s, a pool of 60 people against the real routes
npm run test:emulator         # the same tests on the Firestore emulator (needs Java 21+)
npm --prefix frontend test    # frontend unit tests
```

Build and deploy (you need your own Firebase project):

```bash
npm run build
npm run deploy                # functions, firestore rules and indexes, storage rules, hosting
```

### Settings and secrets

`.env` holds the Firebase project id, the service account key for the helper scripts, and the Android signing settings. The template is
`.env.example`. **Never commit `.env`, a service account key, a keystore or `google-services.json`**: they are in `.gitignore`.
The backend settings (email texts, `APP_URL`, limits) are listed in `functions/.env.example`.

### The apps

- **Android**: `npm run android:config`, then `npm run android:sync` and `npm run android:open` (Android Studio).
- **iPhone**: `npm run ios:config`, `npm run ios:sync`, `npm run ios:open` (macOS and Xcode only).
- **Windows**: `npm run windows:run`, `npm run windows:publish`, `npm run windows:installer` (.NET 8 SDK; Inno Setup for the installer).

More in [`docs/guide/apps-and-login.md`](docs/guide/apps-and-login.md), `ios/README.md` and `windows/README.md`.

## Documentation map

Start with [`CLAUDE.md`](CLAUDE.md) (the project guide: structure, pages, conventions, commands, design system). Then the area you work in.

### Guides (how the built parts work)

| Document | Covers |
| --- | --- |
| [`docs/guide/connections.md`](docs/guide/connections.md) | Friend requests, seats, the waiting list, deleting a friend or an account, the rules the tests check |
| [`docs/guide/messages-and-profile.md`](docs/guide/messages-and-profile.md) | The message feed, profile, links in messages, friend links, the sleep list, UI preferences |
| [`docs/guide/media-and-safebox.md`](docs/guide/media-and-safebox.md) | The media cache, the safebox, pictures and memory, locked files |
| [`docs/guide/live-and-notifications.md`](docs/guide/live-and-notifications.md) | Pings, live updates, sound, push, email, several devices |
| [`docs/guide/apps-and-login.md`](docs/guide/apps-and-login.md) | Android, iPhone and Windows apps, login methods, first-time setup |
| [`docs/guide/testing.md`](docs/guide/testing.md) | The backend tests, the 60-person pool, the emulator |
| [`docs/notifications.md`](docs/notifications.md) | All the push rules in one place |
| [`docs/invite-install-login.md`](docs/invite-install-login.md) | Invite, install and sign-in strategies |

### Design notes (decisions, plans and proposals)

| Document | Status | Covers |
| --- | --- | --- |
| [`docs/design/groups.md`](docs/design/groups.md) | built | Groups: data, members, leaving, keys, the app |
| [`docs/design/circles.md`](docs/design/circles.md) | data ready | Several friend circles |
| [`docs/design/safebox-objects.md`](docs/design/safebox-objects.md) | built | Notes and the other object types of the safebox |
| [`docs/design/safebox-encryption.md`](docs/design/safebox-encryption.md) | in progress | End-to-end encryption of the safebox: keys, data model, flows |
| [`docs/design/message-encryption.md`](docs/design/message-encryption.md) | in progress | Locked message text |
| [`docs/design/recovery-own-devices.md`](docs/design/recovery-own-devices.md) | built | Recovery with your own devices and your 24 words |
| [`docs/design/recovery-by-friend.md`](docs/design/recovery-by-friend.md) | built | Recovery with a friend's device |
| [`docs/design/friend-statistics.md`](docs/design/friend-statistics.md) | idea | Friend statistics |
| [`docs/design/resources.md`](docs/design/resources.md) | proposal | Resources: lend, give, book and share inside a friendship or group |

Other files: [`PROJECT-NOTES.md`](PROJECT-NOTES.md) (working notes), [`CONTRIBUTING.md`](CONTRIBUTING.md), [`SECURITY.md`](SECURITY.md), [`LICENSE`](LICENSE).

## Security and privacy

Messages and safebox files are locked on the devices when both friends have a key; the server cannot read them.
Please report a security problem privately: see [`SECURITY.md`](SECURITY.md). How data is handled is described in the app under
*Data and privacy*, and the *Terms of use*.

## Contributing

Ideas, bug reports and pull requests are welcome. Read [`CONTRIBUTING.md`](CONTRIBUTING.md) first.

## Trademarks and brand

**The software is free. The brand is not.**

The names **Seven Friends**, **Seven Buddies**, **Seven Work** and **Seven Family**, the domain names, the logos (including the "7" mark), the look of the apps and welcome pages, and the profiles and identity of the circles are trademarks and brand assets of Blueboot R&D AS. They are **not** covered by the GPL, and they may **not** be used freely for other installations, forks or services.

- The GPL v3 licence gives you the right to use, study, change and share the **source code**. It gives no right to the names, logos or brand, and no right to present your installation as the official one or as a service of Blueboot R&D AS.
- If you run your own installation or publish a fork, give it **your own name, logo and look**, and remove ours (see `frontend/public/`, the welcome pages, the app names in `android/`, `ios/` and `windows/`, and the texts in `frontend/public/i18n/`).
- The idea of the product, a small, calm app built around seven seats and its circles, is the work of Blueboot R&D AS and is not offered for free reuse under the Seven names.
- For permission to use the name or to run an official or branded installation, write to [hey@blueboot.ai](mailto:hey@blueboot.ai).

## License

Seven Friends is free software, released under the **GNU General Public License v3.0**. See [`LICENSE`](LICENSE). The licence covers the software only; see [Trademarks and brand](#trademarks-and-brand).

Made by [Blueboot R&D AS](https://blueboot.ai), Norway. Contact: [hey@blueboot.ai](mailto:hey@blueboot.ai).

### Third-party parts

The app builds on open source, each under its own license: Angular, Capacitor, Bootstrap, Express and the Firebase SDKs
(MIT or Apache-2.0), the English BIP-39 word list used for the recovery words (MIT, from `@scure/bip39`).
`npm ls` lists everything that is installed. The jingles in `frontend/public/sounds/` are part of this repository.
