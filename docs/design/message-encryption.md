# Message encryption: design

Status: proposal. Step 1 is built: `sealText` and `openText` in `core/box-crypto.ts` (they share the key generation, the key locking and `openFileKey` with the safebox) and the `MessageEnc` type in `models/shared/message.ts`, with unit tests in `box-crypto.spec.ts`. Step 2 is built (server, accepts both forms): `parseMessageEnc` in `functions/src/box-encryption.ts` (shares the wrap checks, `wrapsCover` and `wrapsFor` with the safebox), send, edit, the feed, the unread list and delete-by-text in `conversation.ts` and `messages.ts`, tests in `functions/test/message-encrypted.test.ts`. Step 3 is built: `core/message-lock.service.ts` (lock on send, open the feed, `ChatItem`), `core/chat.service.ts`, the message screen (lock mark, "locked for another device", the padlock frame with the switch), the live notice and the draft link preview skip locked texts. Step 4 is built: pictures, video and voice in messages are locked with the same message key as the caption (see "Pictures, video and voice" below). Step 5 is built: recovery (see "Recovery" below). Not built: moving a locked picture or video to the safebox, link previews for locked messages. It reuses the key system of the safebox (`docs/design/safebox-encryption.md`): the device keys, the fingerprints, the recovery words and `core/box-crypto.ts`. Date: 2026-11-08.

## Goals and limits
- The text of a message is locked on the device of the sender. The server and the database only hold unreadable text.
- Only the two friends of a confirmed friendship can read it. Not even we can.
- Locking is used only when BOTH friends have a key. Otherwise the message goes as plain text, as now. Old messages stay as they are.
- Out of scope for version 1: pictures, video and voice in messages (a later step), hiding who writes to whom and when, and the old messages.

## How a message is locked
Same as a safebox file:
1. The sender's browser makes a random AES-256-GCM key for THIS message (the message key).
2. The text is locked with it. The additional data binds the friendship and the part: `sevenfriends-box-v1:<connectionId>:text` (the same lock as a safebox file, with the part `text`). The server cannot move a message to another conversation, or swap parts, without the opening failing.
3. The message key is locked (RSA-OAEP, 3072 / SHA-256) once for every key in use of both friends. With one key each that is two locked copies: one for me (so I can read what I sent) and one for my friend. With more devices, one copy per device key.
4. The browser sends the locked text, the IV and the locked copies. The server checks the shape and that every key in use of both friends has its copy (like `wrapsCover` in `box-encryption.ts`).

The reader finds the copy for its own key, unlocks the message key, and unlocks the text. A device without a copy shows a short "locked for another device" line, like a safebox file.

## Data model (Firestore)
`user-account/{uid}/messages/{id}` gets an optional `enc`:
```
enc: { v: 1, iv, wraps: [{ uid, keyId, wrappedKey }] }   // text = the locked text, base64
```
- A locked message has `enc` and its `text` field holds the ciphertext. A message without `enc` is plain text (old messages, or no key on one side).
- Each friend's copy of the message keeps only their own wraps (like `wrapsFor`), so nobody gets the other's copies.
- An edit locks the new text with the SAME message key (opened with this device's copy) and a new iv. The app sends only the text and the iv (`parseRelock`); the copies of the key stay as they are, so the same keys, and nobody else, can read the edited message. A plain message may become a locked one by an edit (a new key, as for a new message); a locked one never becomes plain.

## What the server still sees
Who writes to whom, when, the size of the text (roughly), whether a message has a file, and read status. It no longer sees the text.

## Changes by part
**Client** (`core/box-crypto.ts`, `core/messages.service.ts`, `chat/`)
- `lockText` and `unlockText` next to the file functions, with tests (round trip, wrong friendship, wrong part, a changed byte, a missing copy).
- Send: lock when both have a key, else plain. Edit: a locked message is locked again with the key it has; a plain one is sent like a new message.
- Show: unlock the text of loaded messages; a lock mark on locked messages; the "locked for another device" line.
- Search: on the device only, over the loaded messages.

**Server** (`functions/src/conversation.ts`, `push.ts`, `notifications.ts`)
- Send and edit accept the `enc` shape and check it. Plain text from a conversation where both have keys is still accepted (an old client), but the answer says so.
- The server never reads the text of a locked message:
  - push: "🔒 New message" with the friend's name, no text;
  - the unread list: "🔒 Message" instead of the text;
  - the server-side search skips locked messages;
  - no link preview for locked messages (version 1).

## Rules and defaults (to confirm)
1. Push text is "🔒 New message" from the friend's name, no message text.
2. Link previews are dropped for locked messages in version 1 (later: the sender's device makes the preview and locks it inside the message).
3. Search in locked messages works on the device only, over the messages already loaded.
4. Old messages stay plain text.
5. Pictures, video and voice in messages are locked in a later step.

## Rollout
1. Client crypto and its tests.
2. Server fields, the check, and the push and unread-list changes (accept both forms).
3. The message screen: send, show, edit, lock mark, search on the device.
4. Test with two accounts: both have keys (locked), one has none (plain), a second device, a lost key.
5. Later: message pictures, video and voice; previews; the "friend unlocks it for you" function, which also covers a message locked before a new device had a key.

## Risks and open choices
- A message is readable only on devices whose key was in use when it was sent. A new device sees "locked for another device" for earlier messages until the unlock function exists. This is the same limit as in the safebox.
- A lost key without the 24 words means the locked history cannot be read again.
- Push without text is less handy; it is the price of the lock.
- Search on the device covers only the loaded part of the history.
- An old client that sends plain text in a conversation where both have keys: the message is not locked. The app should refuse to send plain in that case once all clients are updated.

## Pictures, video and voice (step 4)

A message with a file has one message key for the text and the file. The device makes the key first, locks the file (part `file`), its small preview (`thumb`) and
a `meta` (name, type, size in pixels, length) with it, and uploads only the locked file (`POST /api/sf-cache?kind=...&locked=1`, the preview `PUT .../thumb?locked=1`).
The server checks only the size (the plain limit plus the 16 bytes of the lock) and stores binary data with no name. When the message is sent, the caption (empty is fine)
is locked with the same key and the copies of the key are made for the keys in use at that moment; `enc.media` carries the three ivs and the locked meta.

- The server refuses a locked file in a plain message, a plain file in a locked message, and a preview that does not fit (`enc.media.thumbIv`).
- The server knows the kind and the number of bytes; it does not know the name, the real type, the pixels or the length (those fields are empty in the message it keeps).
- The reader opens the key once, then the text and the meta; the media service opens the file when it is read (`MediaService.registerLocked`, kept in the session storage of the tab so the full-size page works after a reload).
- An edit of the caption uses the same key (the file stays readable). A file cannot be locked by an edit.
- A locked picture or video cannot be moved to the safebox yet (the server answers 409 and the button is hidden).

## Recovery (step 5)

A person with a NEW key (the old one and the 24 words are gone) cannot open messages and safebox files locked for the old key. The friend can: each message and each safebox file
keeps a copy of its key for every key in use of both people, and the friend's copy is still locked for the friend's key. The friend's device opens that key and locks it again for the new key.
Only keys move; no text, file or key is readable on the server.

- **Menu:** friend page, "Recovery" (`/friends/:id/recovery`, `friend-recovery/`). The same page is the explanation and the button for the one who asks, and the approval and the progress for the friend.
- **Request:** `POST .../recovery` stores `recovery-request/{connectionId}` (`requesterUid`, `helperUid`, the newest key and its fingerprint, `status` asked, approved, done, `total`, `added`) and wakes the friend with a push.
- **Approve:** the friend sees the short code of the new key and is asked to check it with the person ("Approve and start"). `POST .../approve` counts the messages and files that need a copy (`total`).
- **Work** (`core/recovery.service.ts`, `rewrapKey` in `box-crypto.ts`): the friend's app reads `GET .../todo?part=messages|box&after=` (100 at a time, newest first; the friend's own copies of each key), opens each with the friend's key, locks it for the new key and sends `POST .../wraps`. Then `POST .../finish`.
- **Server checks** (`recovery.ts`): only the friend who was asked may approve and work; a copy is accepted only for the asker and for the key of the request (still in use); it is added to the asker's copy of the message, or to the shared safebox item, only when that has no copy for the key yet.
- **Both pages stay open** until it is done (the asker's page polls every 2.5 seconds). Cancel or decline: `DELETE .../recovery`.
- **Limits:** if both lose their keys, the history is gone. Messages the helper's device cannot open (locked for a key it does not have) are skipped and counted. The approval depends on the friend comparing the code of the new key; pinning friends' keys is not built.
