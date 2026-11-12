# A lock by default, that the provider cannot open

Status: **step 1 built** (see "Built so far" at the end); the rest is a proposal. Date: 2026-11-11. It replaces the first-use flow and the key checks of `safebox-encryption.md` and `message-encryption.md` (the rest of those documents stays: the item keys, the wraps, the two ways of recovery).

## The requirement
**We, as the provider, must not be able to read what people write and save, and must not be able to act as a user.** Hard rules that follow:

1. **Every key that can unlock data lives only on the person's devices** (non-extractable, never sent anywhere). The only thing on our side that comes near a private key is the backup, which is useless without the 24 words, and the words are never on our side.
2. **Nothing we hold can pass for a person.** A sign-in to the account (which we could fake) must not be enough to be trusted by a friend: messages and items are **signed by the writer's device**, and keys are accepted only through a chain the person's devices sign.
3. **The lock is there from the first day, with no steps** and no word "key" in the app.
4. **A key can be rotated, and a rotation also re-encrypts the old items**, so that a retired or removed key cannot open anything it did not already copy.

What is **not** hidden from us, and is said so in the app: who writes to whom, when, the sizes, names and pictures of friends and groups, moods and presence. And the **web** version cannot be made safe against changed code (see "The code").

## The keys
Per **device**, made silently at the first sign-in, never extractable:
- the **lock key** (RSA-OAEP 3072): unwraps item and message keys (as today);
- the **signing key** (ECDSA P-256): signs. A key cannot get another purpose later, so it is made from the first day.

Per **person**, the **device list**: a signed statement `{ version, devices: [{ keyId, lockKey, signKey, label }], prev, signedBy, signature }`. Version 1 is signed by the first device. **Every later version is signed by a device that was in the previous version.** Friends pin the list and accept a new version only if that signature holds. The list is public data (we store it) and we cannot change it without breaking the chain.

Per **message and item**: inside the locked payload the writer's device puts `{ author, connectionId, time, id }` and a **signature** over the plaintext. The reader checks it against the writer's pinned list. We cannot forge a message from a person, and whoever re-encrypts an item (below) cannot change what it says.

**On paper, at the person's wish**: the 24 words of the recovery key (256 bit random). They unlock the **backup** we store: the private lock key and signing key of one device, wrapped with the recovery key. Without the words the backup is noise; the words are never typed into anything that sends them.

Forbidden because we would see or guess the words: emailing the rescue code (through our mail), saving it in our cloud, or deriving it from a password.

## Meeting a friend: no step for the person
Friends are only added with a **friend link** (the app sends no invitations). The link carries, after the `#` (which a browser never sends to a server):
- the inviter's device-list fingerprint, and
- a one-time **secret**.

The other side opens the link, makes its keys if it has none, and answers with its own list fingerprint plus a **MAC over it with the secret**. The inviter's device checks the MAC and pins that list. The other side already pinned the inviter's from the link. So both lists are authenticated through a channel we do not control, and nobody compares anything.

- If a link is passed on by a channel we control, the pairing is only as safe as that channel. The app says so on "Check keys".
- In a **group** a new member's list is accepted by the others through the member who added them: that member signs "Y's list is H", and the others already trust that member.

## First sign-in (silent)
1. Make the lock key and the signing key. Make device list v1 if this is the person's first device. Publish the public parts.
2. Nothing is shown. The setup wizard loses "Turn on privacy lock".
3. Everything written from now on is locked and signed. A friend without keys yet is waiting; for them the conversation is readable by us until they open the app, and the notice says so.

## More devices of the same person
A new phone makes its keys and **asks for approval**; an existing device of the person shows "Approve a new phone, Pixel 8?" and one tap signs list version n+1 with that device. The new device then gets the history through the existing "Way 1a" (a device gives the new key its copies). Friends accept the new version because an old device signed it.

**All devices lost.** Options in this order: (a) the **rescue code** puts a listed device's keys back on the new phone, so it is the same device and needs no approval; (b) a **friend** reopens the shared history (Way 2) and the person re-pairs by a **new friend link** (the chain is new, and the friend is told plainly: "Anna has a new identity: confirm by link or in person"); (c) otherwise the history is gone, and the app says so.

## Rescue code and rotation
The rescue code can only be made when a key is created (a non-extractable key cannot be backed up afterwards). **"Add a rescue code"** is therefore a rotation, and so is **"Refresh my lock"** (if a device is suspected) and **"Remove a device"**.

A rotation, on a device that has the old keys:
1. Make new lock and signing keys, **extractable** for a moment (only for the rescue code; "Refresh" and "Remove" skip the backup and keep them non-extractable).
2. For the rescue code: wrap them with a new recovery key, store `key-backup/current` (the backup first), show the 24 words once and ask for three of them back.
3. Publish **device list n+1**, signed by the old signing key, with the new keys and without the retired or removed device.
4. **Re-encrypt every old item and message this device can open** (the next section).
5. Import the new keys as non-extractable, delete the extractable copies, mark the old keys retired.

### Re-encrypting old items
Because the retired key must not open anything that is left, each item is **re-encrypted with a new item key**, not merely re-wrapped:
1. Open it with the old key; make a **new random item key**; encrypt the content and its preview again; keep the original author signature (it signs the plaintext, so it stays valid).
2. Wrap the new item key for **the current keys only** (mine and my friends' or my group's).
3. Write the new version, and only when it is stored delete the old ciphertext and old wraps (files: upload the new file, then delete the old). A transaction with the item's `revision` makes two devices working at the same time safe.
4. It runs in the background, in batches, resumes after a stop, shows "Moving your history, 40%", and starts with the newest.
- Items this device cannot open (locked only for another device of mine) are left, listed as "not moved yet", and moved by that device. A device removed from the list **cannot be used for this**; that is one more reason to remove early.
- The copy of a message in the other person's list is rewritten by the same call: a server route that lets a **participant of the connection** replace the locked payload of an item, which we check only for form and revision. Content stays the writer's because of the signature.
- Cost: time and traffic in proportion to the files, so large files take a long time on a slow connection. It runs in the background, can be paused, and continues next time the app is open, on Wi-Fi first when the app can tell.
- **The old key stays on the device, fully working, until nothing is left to move.** "Nothing left" is checked on the server: no item or message in my connections has a wrap for the old `keyId` (each item carries the list of its wrapped `keyIds`, so the count is one query). Only then is the old key marked `retiredAt`, and only then does the device delete its copy.
- An item that fails (damaged, a file that is gone) is retried and listed. The old key is kept while any remain. The person can choose **"Give up on these N items"** (they are deleted or left locked only for the old key) and then the old key is retired. Nothing is dropped without that choice.
- If the phone is lost midway, the items not yet moved are still locked for keys the other devices, or the rescue code, can open.
- **What it cannot do:** take back what somebody already copied and opened. It makes the old key useless for everything not yet copied.

## What we cannot see, and the server features that must change
- **Link previews**: the server fetching a page would learn the link. For locked messages the preview is off, or the sender's device makes it (decision: off by default, one tap to fetch).
- **Push**: a locked message gets a generic push ("New message"); the native app decrypts and shows the text itself (a notification extension; later). The option "hide the text" becomes the rule for locked conversations.
- **File checks** (what a file really is) are on the device already; the server only enforces size.
- **Presence, moods, names, pictures** are not locked. Said so on the privacy page.

## The code
The lock is only as good as the code that runs it, and the web app is fetched from us every time.
- **Android, iPhone, Windows apps**: the app **contains** the web app (Capacitor `webDir`, no `server.url`, no live update; WebView2 mapped to local files). The code comes from the store and a changed deploy cannot reach it. This is the only way to meet the requirement in full.
- **Web**: we **cannot** promise it. Strict CSP, SRI and a published hash of each build make a change visible, not impossible. The app calls it "lower security", says so in plain words, and offers the app.

## What changes in the app
| Where | Change |
|---|---|
| First sign-in | silent keys and device list for people with no key (`core/device-key.ts`, `core/my-key.ts`, new `core/identity.ts`); people with an old key keep it |
| Setup wizard | "Turn on privacy lock" removed |
| Friend link | carries the list fingerprint and a secret after `#`; the accept step pins and checks the MAC |
| Messages, safebox | a signature inside every locked payload; a check on reading |
| `key-changed-band` | becomes the check of the signed chain; a broken chain is a **blocking** warning, a valid new version is silent |
| Settings → Privacy lock | "Lock and rescue code": status ("Lock: older version" or "current"), **Add a rescue code**, **Refresh my lock**, my devices (**Approve**, **Remove**), Check keys |
| Home | "Approve a new phone?" when one asks; a quiet notice to add a rescue code after the first friend |
| New device | "Open your old messages": another device of mine, a friend, my rescue code |
| Native apps | bundled code, no live URL |
| Locked content | no server link preview; generic push |

## Data model
- `user-account/{uid}/key-list/{version}`: the signed device list (append-only; the server refuses a version whose `prev` is not the head and keeps all versions).
- `user-account/{uid}/keys/{keyId}`: public lock and signing keys (as today, plus `signKey`), `retiredAt?`.
- `user-account/{uid}/key-backup/current`: only after "Add a rescue code".
- `user-account/{uid}/device-request/{id}`: a new device asking for approval (public keys, label, a nonce).
- Locked item or message `enc`: as today, `wraps` only for current keys (and `keyIds`, the same ids as a plain array, so "how many still have the old key" is one indexed query), plus `author`, `sig` and the key list version it was signed under inside the locked part.
- The server never verifies a signature; it only keeps the structure sane. Devices verify.

## Existing users: nothing to do, they keep their keys until they rotate
Everything that exists keeps working, with no step for anybody:
- A person with an existing key (and perhaps a backup and 24 words) keeps it. Their friendships, conversations and safebox items stay as they are, locked for the same keys, readable, and writable as today. No signing key is made, no list, no migration, no message to them.
- Such a person is on the **older lock** ("legacy"). Their messages and items carry no signature. A friend's device shows them normally and marks them only softly ("older lock") on Check keys; they are **never** shown as a warning or as "unverified". A friend's pinned fingerprint of a legacy key works as today (saved on the device; a changed key then gets today's question).
- People with **no key yet** get the new kind straight away at the next open (lock key, signing key, list v1).
- The upgrade happens **the day the person rotates** ("Add a rescue code", "Refresh my lock"). The rotation makes the new lock key **and** a signing key, publishes **list v1** that **includes the old lock key** (the one the friends pinned) and the new keys, and re-encrypts the old items as described above. The old key is retired when that is done.
- **How friends accept that first list:** their device sees a list that contains the lock key it has pinned, so it accepts it at once, pins the new keys, and shows the quiet line "Anna upgraded her lock". Every later version is checked by the signature chain, as for everybody. This first step cannot be proven by a signature, because the old lock key cannot sign. It rests on the list containing the pinned key, so it is weaker **for that one step**, and the document says so. A hardening is possible later: the friend's device sends a hidden challenge, locked for the old key, and the rotating device (which still has the old key until it is done) answers it.
- A person who never rotates stays on the older lock for good, and the app shows "Lock: older version. Refresh my lock to upgrade" in Settings, nothing more.

## Tests
- Keys are made on the first sign-in and are not extractable afterwards; the backup restores the keys of one device and nothing else.
- A device list is accepted only if signed by a device of the previous version; a forged list, a wrong `prev`, a reused version are refused.
- A friend-link pairing: the right secret pins both lists; a wrong MAC (a server in the middle) is refused.
- A message with a wrong or missing signature is shown as unverified and is never shown as from that person.
- Approving a device, removing a device, a lost-all-devices re-pair.
- A rotation re-encrypts every old item the device can open; the old key is **kept until the server count of items with a wrap for it is zero**, and opens none of them afterwards; stopped halfway it resumes; two devices at once never lose an item; a failing item keeps the old key until the person gives up on it.
- A locked message has no link preview and a generic push.
- Existing users: with an old key and no rotation, everything keeps working, nothing is flagged, and messages from them show as normal. After a rotation the friends accept the first list because it contains the pinned key, show "upgraded her lock", and check every later version by the chain.

## Build in steps
1. Signing key and device list for **new** keys only; silent keys for people with none; the setup step removed; the privacy text rewritten. Old keys are untouched.
2. Signed payloads for messages and safebox items.
3. Pairing by link secret and the vouch for group members; the blocking warning for a broken chain.
4. Device approval and removal; the new-device screen.
5. Rescue code and rotation with re-encryption.
6. Locked content: previews and push.
7. Bundled code in the apps; CSP and build hashes for the web.
Each step ends with the code, this document and a test. Steps 1 to 3 give the identity guarantees; 5 gives the rotation; 7 closes the code gap.

## Decided
- **The first step of an upgrade from an older lock is accepted as it is** (the list contains the key the friend pinned). No hidden challenge.
- **The web version keeps working for locked data**, with a visible note: "Lower security in the browser: get the app for the full lock" (on Settings → Lock and rescue code, and once on first use). The apps are the full-assurance version.
- **Large files are re-encrypted too**, all of them, in the background. **The old key is not retired and not deleted until every item is re-encrypted** (below).

## Decided (continued)
- **Private keys stay on the device across sessions, and signing out never deletes them.** They are kept in the browser's key store (IndexedDB, non-extractable), as now, in the apps too. A key is deleted only by an explicit "Remove this device" or by deleting the account (today the one delete in the code is the rollback when saving a new key fails). The app keeps asking the browser to protect that data (`navigator.storage.persist()`, `keepDeviceKey`, asked again at every visit); if the browser says no, **Settings → Lock and rescue code** says so ("This browser may clear your lock when it is short of space. Install the app, or add a rescue code") and the install page says it too.
- **Messages sent to a friend who is offline during a rotation need no special screen.** The old key stays on the device until **no item has a wrap for it**, so a message that arrives locked for the old key is simply re-encrypted when it arrives, and the old key is retired when the last one is moved. The friend who was offline learns the new list when they are next online and uses the new key from then on. The person sees nothing. If an offline friend never comes back, the person can choose "Retire the old lock anyway" after 30 days; messages still locked only for the old key then stay readable only through Way 1 or the rescue code.
- **Link previews on locked messages are off by default.** The sender can ask for one with a tap: the apps fetch the page on the device; the browser cannot read other sites, so it asks "Our server will fetch this page and will see this link. Continue?" and the preview is then added to the locked message. A message never gets a preview without that tap.

## Open questions
None at the moment. Open for the build: the exact format of the signed payload and of the device list, the notification extension that decrypts a push on the device, and the build hash page for the web.


## Built so far

**Step 1 (signing key and device list for new keys).**
- Shared model `models/shared/keys.ts`: `SignKeyJwk`, `canonicalSignKey`, `DeviceList`, `DeviceListEntry`, `deviceListText` (the signed text), `deviceListHash` (the next version's `prev`), `checkedDeviceList` (structure only). `PublishedKey.signKey` is optional: missing = older lock.
- Backend `keys.ts`: `POST /keys` takes `signKey` for a NEW key only (a key already published never gets one); `GET /keys/list` (my versions, oldest first); `POST /keys/list` (append-only: next version number, `prev` = hash of the newest, `create` so a version is never replaced; 409 otherwise). The server never checks a signature. Data: `user-account/{uid}/key-list/{version}`. Test: `functions/test/key-list.test.ts`.
- App: `core/device-key.ts` `generateIdentityKey()` (both private keys unextractable; `StoredDeviceKey.signKey` optional), `core/device-list.ts` (`firstDeviceList`, `listSignatureHolds`), `KeysService.makeIdentity()` and `ensureList()` (see `docs/guide/apps-and-login.md`). The setup wizard has no key step. The privacy texts (English) say "locked in the storage" and that the browser lock is weaker than the app.
- Not done yet: pairing and the blocking warning (step 3), the translations of the changed English texts (the other languages still have the old wording).

**Step 2 (signed texts), messages only.**
- A locked message text is written inside the lock as `SIGNED_MARK` + a JSON envelope `{v, a (author uid), c (connection id), t (time), k (signing device's key ID), x (text), s (signature)}` (`models/shared/signed.ts`; signed bytes: `["sf-text-v1", a, c, t, k, x]`). A text without the mark is an older, unsigned one and is read as it is. A device with an older lock (no signing key) sends unsigned, as before.
- `GET .../safebox/key-lists` hands a confirmed friend (or group member) the device lists of the other people of the connection; the server's copy is only a copy, the app checks it. `core/friend-lists.service.ts` checks the chain (versions 1..n, version 1 signed by its own device, each later one linked by hash and signed by a device of the one before) and **pins** the newest version seen in localStorage (`sf-list-pin:<me>:<them>`): a chain that no longer contains the pinned version, or a list that has disappeared, is `broken`.
- `MessageLockService` signs on sealing, resealing (edit) and sealing with a media key, and checks on opening: `ChatItem.signature` is `'ok'`, `'bad'` (shown as a red "Could not check who wrote this message" under the text) or absent (unsigned, or the lists could not be fetched). The check accepts a device from ANY valid version of the writer's lists.
- The server's limit for a locked text rose from 6000 to 7000 bytes to make room for the envelope.
- Known limits for now: an unsigned message from someone who HAS a list is shown as before (a server that strips signatures is not caught yet; step 3 adds the "signed since" mark); only messages are signed, **safebox items (files, notes, objects) are not yet** and follow in a later round; the frontend code has not been compiled or run.

**Step 3 (pairing and the chain warning), first two parts.**
- `DeviceList.since` (version 1 only, part of the signed text, optional so lists made before it still verify): from when the person's texts are signed. An unsigned text from a person with a valid list that is newer than `since`, or any text from a person whose lists are broken, shows the red "Could not check who wrote this message" (`MessageLockService.checked`). `since` is the device clock and the message time is the server's, so a server that both strips a signature and backdates the message is still not caught; this closes the simple case only.
- A **broken chain** (`FriendListsService`, reasons `chain`, `gone`, `pin`) shows `app-lock-chain-band` under the header of the friend's page and **stops sending** (`MessageLockService.guard` on `seal`, `mediaKey`, `sealWith`). `pin` (a valid chain that does not hold the pinned version: a new history, for example after losing every device) can be accepted with "Yes, <name> told me"; a broken signature or lists that went away cannot be accepted, only explained by the person.
- The **friend link** carries `#u=<uid>&v=<version>&h=<first 32 hex of the list hash>` after the `#` (never sent to a server). The joiner keeps it on this device (`core/list-pin.ts`, localStorage `sf-link-pins`, never in the preferences) and the chain check requires the pinned version with that hash from the first time the lists are fetched.
- Not done: the reverse direction (the link owner checking the joiner's list with a secret and a MAC), the vouch for group members, and filtering the recipients of a message to the keys in the pinned list (that waits for step 4, because a second device is only in the list once it is approved). The link copied by the welcome page (`linkText`) does not carry the pin.
- Specs written but not run: `core/list-pin.spec.ts`, `core/friend-lists.spec.ts` (Karma, `npm --prefix frontend test`).

**Step 4 (devices), built.**
- **A new device of a person whose keys were made silently** (published keys, no backup to restore): `KeysService.refresh()` makes its own lock and signing key (`makeIdentity`) and publishes them; the server opens the existing own-recovery request, which the person's other devices show on Home (`own-key-prompt`, now "A new device wants to join your lock", button **Approve**).
- **Approve** (`OwnRecoveryService.allow`) first publishes the next version of the device list with the new device in it (`core/device-list.service.ts`, signed by the approving device, which must be in the newest version and have a signing key), then gives the new key its copies of the old message and item keys, as before. **Not me** and **Remove** (`KeysService.revoke`) publish a version without the device first. A device without a signing key (an older lock) never goes into a list and nothing is published for it. Concurrent versions are retried (409).
- **Backend** (`POST /keys/list`): every device named must be a published key in use of the person with exactly these lock and signing keys, and `signedBy` must be a device of the version before.
- **Locking now follows the list** (`MessageLockService.trusted`): where a person has a signed list, a text is locked only for the keys in its newest version; nothing is sent when a list is broken, when THIS device is not yet in my own list ("not approved yet"), or when the list leaves a person with no key (no silent fall back to plain). The server checks the copies of the message key against the same keys (`recipientKeysOf` in `functions/src/keys.ts`): a key that is published but not yet in the list (a new device waiting for approval) must not block a send. A person without a list is as before. Fetched lists are used for 60 seconds, and fetched again at once when a signature comes from a device that is not in them.
- Not done: the same recipient limit for safebox items and files (they still lock for the keys the server lists), a screen that lists my devices with their approval state, and the rescue code (step 5): if every device is lost nothing can approve a new one.

**Step 5a (rescue code), built; 5b (re-encryption) built for messages without a file and box objects, see below.**
- **"Add a rescue code"** (Settings → Privacy lock, shown when no backup exists; also "Make a new key…" under Advanced) is a rotation: `KeysService.prepare(true)` makes a new lock key AND signing key (`generateDeviceKey`, both extractable only until the backup is made) and the 24 words; the backup holds both keys (`{"v":2,"lock","sign"}` as bytes, `unpackBackup`; an older backup is the lock key alone). `commit()` then: (1) publishes the new key with its backup, (2) the OLD key, still the key of this device, gives the new one its copies of every message and item key (`OwnRecoveryService.allow(target, progress, as)`), (3) publishes list n+1 with the new device in place of the old one, signed by the OLD signing key (`DeviceListService.rotate`; a person with no list gets version 1 signed by the new key), (4) saves the new key on the device, checks it, and retires the old one. If anything fails the device is put back and the new key is retired.
- **Restoring** from the words (`KeysService.restore`) now puts back the lock key and, when the backup has it, the signing key (checked against the published one), so a restored device is the same device in the list and needs no approval.
- **Not built (5b):** re-encrypting every old item with a NEW item key and the server counting wraps for the old key before it is retired. For now a rotation only ADDS copies for the new key (the old key's copies stay on the items). That is enough to bring a lost device back with the words; it does NOT make a stolen old key useless, so "Refresh my lock" for a suspected device is not offered. The server route for a participant to replace a locked payload, the revision transaction, resumable batches and the "Moving your history" progress are all part of 5b.
- The old backup on the server is replaced by the new one (one backup per person).

### Step 5b: re-locking old items (built: messages without a file, and objects of the box)
- A key that is retired leaves its copies of the content key on old items. An item is **stale** when one of MY copies is for a retired key of mine. `GET /reencrypt/todo?part=messages|box&after=` lists my stale items (`functions/src/reencrypt.ts`; a message with a file is not listed yet; files come later).
- The device opens the item with its own key (the rotation of step 5a has already given the new key its copy), locks the same content with a **fresh content key** and sends it back: `PUT /reencrypt/messages/:id` (`{ was, text, enc }`, only my copy, `was` = the iv it started from) and `PUT .../safebox/items/:id/reencrypt` (`{ revision, enc }`, copies for every key in use of every member, `wrapsCover`). The revision of an object goes up, so an edit started with the old key is refused (409) and cannot be saved under the new one.
- The text (with its signature envelope) is kept exactly as it was, so signatures still hold. The server only checks shapes and who the copies are for.
- Client: `core/reencrypt.service.ts` (`run()`, one run at a time, at most every 10 minutes unless forced), started after a rotation (`KeysService.commit`) and whenever `refresh()` sees a retired key. What this device cannot open is skipped (another device of mine may do it) and tried again later. The Encryption page shows a line while it runs.
- Not done: files and messages with a file (a large file needs a streamed re-lock), items other people hold stale copies for (each person's own retired keys are theirs to re-lock), and a final "nothing left, the old backup can go" signal.
- Tests: `functions/test/reencrypt.test.ts`.
