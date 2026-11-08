# Seven Friends

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)

A calm, simple app for staying in touch with the seven people who matter most to you. Seven seats, no feed, no ads, no noise:
you notice your friends, and they notice you.

Live at **https://sevenfriends.io** · made by **Blueboot R&D AS**, Norway.

## What it does

- **Seven seats.** Your closest friends sit in seven seats; a waiting list and a silent "sleep" list cover everybody else.
- **Circles.** The same app runs several separate circles: Friends, Buddies, Work and Family, each with its own people, name, colour and mood.
- **Messages and media.** Text, pictures, video and voice messages, link previews, and a shared **safebox** for files only the two of you see.
- **Locked messages and files.** When both friends have a key, messages and safebox files are end-to-end encrypted on the devices
  (AES-256-GCM, with the message key locked for each device key with RSA-OAEP 3072). The server only stores ciphertext.
  A lost key can be restored from 24 recovery words, from the friend's device, or from another device of your own.
- **Presence and moods.** A small mood and a status for each friend, and jingles you pick for new messages, requests and answers.
- **Push and live updates.** Web push, Android push, and live updates while the app is open.
- **Easy to join.** Invite by link; the welcome pages show the right next step for the phone, tablet or computer you open them on.
- **Apps.** One web app, plus thin Android, iPhone and Windows apps that show it.

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

## Documentation

Start with [`CLAUDE.md`](CLAUDE.md) (the project guide: structure, pages, conventions, commands), then the area you work in:

- [`docs/guide/connections.md`](docs/guide/connections.md): friend requests, seats, the waiting list, deleting friends and accounts
- [`docs/guide/messages-and-profile.md`](docs/guide/messages-and-profile.md): the message feed, profiles, friend links
- [`docs/guide/media-and-safebox.md`](docs/guide/media-and-safebox.md): pictures, video, the safebox
- [`docs/guide/live-and-notifications.md`](docs/guide/live-and-notifications.md): live updates, sounds, push, email
- [`docs/guide/apps-and-login.md`](docs/guide/apps-and-login.md): apps, login methods, first-time setup
- [`docs/guide/testing.md`](docs/guide/testing.md): the tests
- [`docs/design/`](docs/design): the design of circles, message and safebox encryption (keys, recovery), and friend statistics

## Security and privacy

Messages and safebox files are locked on the devices when both friends have a key; the server cannot read them.
Please report a security problem privately: see [`SECURITY.md`](SECURITY.md). How data is handled is described in the app under
*Data and privacy*, and the *Terms of use*.

## Contributing

Ideas, bug reports and pull requests are welcome. Read [`CONTRIBUTING.md`](CONTRIBUTING.md) first.

## License

Seven Friends is free software, released under the **GNU General Public License v3.0**. See [`LICENSE`](LICENSE).

Made by [Blueboot R&D AS](https://blueboot.ai), Norway. Contact: [hey@blueboot.ai](mailto:hey@blueboot.ai).

### Third-party parts

The app builds on open source, each under its own license: Angular, Capacitor, Bootstrap, Express and the Firebase SDKs
(MIT or Apache-2.0), the English BIP-39 word list used for the recovery words (MIT, from `@scure/bip39`).
`npm ls` lists everything that is installed. The jingles in `frontend/public/sounds/` are part of this repository.
