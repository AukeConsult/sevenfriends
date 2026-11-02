# Seven Friends

An app for staying in contact with your 7 closest friends.

- `frontend/` – Angular app (hosted on Firebase Hosting)
- `functions/` – Node.js/Express backend (Firebase Cloud Functions, exposed at `/api/**`)

## Setup
1. Run `firebase use <project-id>` to link your Firebase project.
2. `npm --prefix frontend install && npm --prefix functions install`

## Run locally
```
npm --prefix frontend run build
npm --prefix functions run build
firebase emulators:start
```
Open http://localhost:5000 and http://localhost:5000/api/health

## Deploy
```
npm --prefix frontend run build
firebase deploy
```
(Functions require the Blaze plan.)

## Google login
1. Firebase console > Authentication > Sign-in method > enable **Google**.
2. Firebase console > Project settings > add a **Web app** and copy its config into `frontend/src/environments/environment.ts`.
3. Enable **Firestore** (Build > Firestore Database). Signed-in users are saved to the `user-account` collection (doc id = uid) by `POST /api/users/sync`, which verifies the Google ID token on the backend. `firestore.rules` blocks direct client access.
4. Deploy rules with `firebase deploy --only firestore`.

## Local development (emulators, no real Firebase project needed)
Requires: Node 22, Firebase CLI (`npm i -g firebase-tools`) and Java (JDK 21+) for the Firestore emulator.

Open 3 terminals in the project root:
```
npm run install:all      # once
npm run dev:functions    # terminal 1: compiles the backend on change
npm run dev:emulators    # terminal 2: Auth, Functions, Firestore (UI at http://localhost:4000)
npm run dev:frontend     # terminal 3: Angular at http://localhost:4200
```
Sign-in uses the Auth emulator's fake Google account chooser. Saved users appear in the emulator UI under Firestore > `user-account`. Data is kept in `.emulator-data/`.

## Data model (Firestore)
```
user-account/{uid}                                  user profile (synced at login) + phone + social accounts
  friend-circle/{circleId}                          one document per circle: { name, type, createdAt }
    friends/{friendId}                              { name, email, phone, <social accounts>, status, linkedUid, createdAt }
  friend-request/{friendId}                         incoming requests: { fromUid, fromName, circleId, friendId, status }
  messages/{messageId}                              incoming messages: { time, fromUid, fromName, text, read }
```
Circle `type` is `friends` (default), `family` or `colleagues`; only `friends` can be created for now. Every user gets a default circle (`default`, "My friends"). Max 7 friends per circle.

API: `GET/POST /api/circles`, `GET/POST /api/circles/:circleId/friends`, `DELETE /api/circles/:circleId/friends/:friendId`.

More API: `GET /api/friend-requests`, `POST /api/friend-requests/:id/accept`, `GET /api/messages` (unread), `POST /api/messages/:id/read`.
Profile: `GET/PUT /api/profile` (phone + social accounts).

Social accounts (one shared list, `SOCIAL_NETWORKS` in `functions/src/validation.ts` and `frontend/src/app/core/social.ts`): Facebook, Instagram, TikTok, Snapchat, X (Twitter), LinkedIn, Telegram. Each is matched on its account id, so a link and a plain username are the same (`instagram.com/john.doe` = `@john.doe`). To add a network, add it to both lists and to `firestore.indexes.json`.

**Home check** (`POST /api/notifications/check`, fired when Home is opened or clicked): 1) finds friend entries that point at you (matched on email, phone number or Facebook/TikTok account) and creates incoming friend requests for them, 2) returns pending (unread) messages. Phone numbers are compared on their last 8 digits; social links are compared on the account id (`facebook.com/john.doe` = `john.doe`).

**Confirming a request** (`POST /api/friend-requests/:id/accept`): the requester's entry becomes `confirmed` and the requester is added as a confirmed friend in *your* default circle (mutual). If your circle has no free seat (7/7), nothing changes: the request stays `pending` until you free a seat, or until the requesting user deletes the friend (which withdraws the request).

**Where an incoming request shows up**
- *Free seat:* it becomes a **pending friend in your regular circle** (Friends page, with a Confirm button; `incomingRequestId` on the friend entry).
- *All seats taken:* it waits on the separate **Pending page** (`/pending`; request has no `seatFriendId`). When a seat frees up (checked on Home / Friends / Pending), the oldest waiting request moves into the circle.
- Removing such a pending seat yourself = declining: the request is hidden for you and stays pending for the requester.
- Home lists all incoming requests either way.

**One connection, one id.** When A adds B, A's friend entry gets an id (the connection id). B's entry in B's circle and the request in B's inbox use that same id (`connectionId` on both entries), so each side can always find the other. If A and B added each other, the two entries are merged into one connection with A's id.

**Reject / delete**
- `POST /api/friend-requests/:id/reject`: the request becomes `rejected`, the requester's entry shows **Rejected**, and the recipient's pending seat is freed.
- `DELETE /api/circles/:circleId/friends/:id`: deletes the connection from **both** lists and removes the request (works for pending, rejected and confirmed connections).
- No free seat on Confirm is *not* a rejection: the request stays pending (Pending page) until a seat is free.

**A request lives only in the requester's list until the other person checks.** Adding a friend writes one pending entry in *your* list and nothing else: no request or seat is created for the other person. It reaches them when *they* run their check (Home / Friends / Pending): their email, phone number or social accounts are matched against everyone's pending entries, and the request then appears in their list (as a pending seat if they have a free seat, otherwise on the Pending page). If you delete the entry before they check, they never see it. If you both added each other, the two entries are merged into one connection when the first of you checks.

**Waiting list (no free seat).** If you have no free seat when an invite is found, the request goes on your waiting list: it is listed only on the Pending page (Home shows just a link with the count). The requester is informed: their entry shows **Waiting** ("Their list is full. You are on their waiting list.", `waitingForSeat` on their entry). When you free a seat the oldest waiting request moves into your circle and the flag is cleared. If the requester deletes the entry, the request is removed from your waiting list too.

## Tests
`npm --prefix functions install` once, then `npm test` runs the connection tests (a pool of 60 people, no emulator or Java needed). `npm run test:emulator` runs the same tests on the real Firestore emulator. See "Testing" in CLAUDE.md.
