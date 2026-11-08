# Message encryption: design

Status: proposal. Step 1 is built: `sealText` and `openText` in `core/box-crypto.ts` (they share the key generation, the key locking and `openFileKey` with the safebox) and the `MessageEnc` type in `models/shared/message.ts`, with unit tests in `box-crypto.spec.ts`. Step 2 is built (server, accepts both forms): `parseMessageEnc` in `functions/src/box-encryption.ts` (shares the wrap checks, `wrapsCover` and `wrapsFor` with the safebox), send, edit, the feed, the unread list and delete-by-text in `conversation.ts` and `messages.ts`, tests in `functions/test/message-encrypted.test.ts`. Nothing sends a locked message yet: that is step 3. Nothing else yet. It reuses the key system of the safebox (`docs/design/safebox-encryption.md`): the device keys, the fingerprints, the recovery words and `core/box-crypto.ts`. Date: 2026-11-08.

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
- An edit locks the new text with a NEW message key and replaces `enc`.

## What the server still sees
Who writes to whom, when, the size of the text (roughly), whether a message has a file, and read status. It no longer sees the text.

## Changes by part
**Client** (`core/box-crypto.ts`, `core/messages.service.ts`, `chat/`)
- `lockText` and `unlockText` next to the file functions, with tests (round trip, wrong friendship, wrong part, a changed byte, a missing copy).
- Send: lock when both have a key, else plain. Edit: the same.
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
