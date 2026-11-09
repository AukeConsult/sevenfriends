# Safebox encryption: design

Status: proposal. Steps 1 and 2 are built: the local key (`frontend/src/app/core/device-key.ts`), the fingerprint (`models/shared/keys.ts`), publishing the public key and the recovery backup (`functions/src/keys.ts`, `core/keys.service.ts`), the 24-word recovery code (`core/recovery-code.ts`) the setup step that ties them together (step 3 of `/setup`), and the Settings → Keys tab (`encryption/`): this device's key and its code, the list of devices with Remove, a new key (retires the old one and gives new words), and restoring a key from the 24 words. Both use the `key-setup` component. Step 3 is built for the safebox upload: when both friends have a key the app locks the file on the device (`core/box-crypto.ts`, `SafeboxService`), sends it in ONE request to `POST .../safebox/encrypted` (`box-encryption.ts` checks the shape and that every key of both friends has its copy of the file key), shows the real name from `enc.meta` to both friends, and opens (decrypts) the file, the preview and video/sound in the browser. Renaming locks the new name with the file key. "Encrypt existing files" is built too (`?replaces=`, see `docs/guide/media-and-safebox.md`). Not built yet: pinning friends' keys, moving message pictures, multi-device sharing.

**Differences from the first sketch:** the additional data of each lock is `connectionId + part` (file, thumb, meta), not `itemId + fingerprints` (the item id does not exist before the upload, and pinning is not built); the file type ending is not kept visible; the upload is one request (4-byte header length, header JSON, locked file, locked preview). Date: 2026-11-07.

## Goals and limits
- Files in the safebox are encrypted on the device, so the server and the storage only hold unreadable data.
- Only the two friends of a confirmed friendship can open a file.
- Out of scope for the first version: encrypting messages, and hiding file names and sizes from the server.

## Keys
| Key | Where it lives | What it does |
|---|---|---|
| Device key pair, RSA-OAEP 3072 / SHA-256 | the private key stays on the device, non-extractable, in IndexedDB; the public key goes to Firestore | wraps and unwraps file keys |
| File key, AES-256-GCM, random per file | only inside the wrapped copies | encrypts the file and its preview |
| Recovery key, 256-bit random, shown as 24 words | the user keeps it; only a wrapped private key is stored | restores access on a new device |

**Key ID and fingerprint.** The ID of a key is its fingerprint: the SHA-256 hash of the public key in a fixed (canonical) JWK form, written as hex. It is made from the key itself, so it cannot be given a false value. The first 16 bytes (32 hex characters) are the key ID that is stored and compared; the full hash is what two friends compare, shown as groups of digits or a QR code. The random `id` that `device-key.ts` gives a device stays as a local name only and is not stored with files.

For the recovery backup the private key must be extractable once, only to export it: generate it extractable, back it up, then import it again as non-extractable and discard the extractable copy.

Each safebox item already carries who saved it: `addedBy` in Firestore (sent to the app as `ownerId`) and `savedBy` on the stored file. The encryption builds on that.

## Data model (Firestore)
- `user-account/{uid}/keys/{keyId}`: `publicKey` (only `e`, `kty`, `n`), `fingerprint`, `createdAt`, `label` (the kind and the device, made by `core/device-name.ts`; in the Android app the phone comes from the wrapper (`NativeNotices.deviceModel()` and `deviceName()`: the model, and the name the owner gave the phone; the Windows app sends the computer name in its user agent as `SevenFriendsDevice/<name>`, so a key reads "Android app · Leif's Pixel (Google Pixel 8)"): "Browser · Chrome on Windows", "Browser app · Chrome on Android" (the web app installed from the browser), "Android app · SM-S918B", "iPhone app · iPhone", "Windows app · Windows"; the key of the device in use gets it on the first visit, an older key that was only "Browser, <date>" is renamed that way), `revoked`. The document id is the key ID, worked out by the server from the key, so publishing a key twice is one key. At most 10 per person.
- `user-account/{uid}/key-backup/current`: the private key scrambled with the recovery key (AES-256-GCM, `{ v: 1, iv, data }` in base64, the purpose is bound as additional data). The recovery key is random, so it is used as the AES key itself.
- `safebox/{connectionId}/items/{itemId}` gains:
  - `enc: { v: 1, iv, metaIv, meta, wraps: [{ uid, keyId, wrappedKey }], fingerprints: { owner, friend } }`
    - `meta` is the encrypted record `{ name, mime }` (see "What is encrypted"), made with the file key and its own `metaIv`.
    - each wrap names the key it was locked with (`keyId`), so the app finds its copy directly.
    - `fingerprints` are the full fingerprints of the owner's and the friend's key as they were when the file was saved.
  - `ownerId` (already stored as `addedBy`)
  - the stored file is `iv + ciphertext`, and the preview is encrypted the same way.
- Extra authenticated data: every AES-GCM encryption (file, preview, meta) binds `itemId + owner fingerprint + friend fingerprint` as additional data, so a server that changes any of them, or moves a file to another item, makes decryption fail.

## Flows
1. **First use (setup, built):** the app generates a key pair (extractable for a moment), scrambles the private key with a new recovery key, stores that backup on the server, publishes the public key (the backup first: a key is published only when its backup is safe), and shows the 24 words once (BIP-39 list, 8 bits of check). The person must type back three asked-for words before moving on. The words are never stored; closing the page before that loses them, and the key can then not be restored (a reset is a later step).
2. **Saving a file:**
   1. Resize the picture or read the document as today.
   2. Create a random file key and encrypt the file and its preview.
   3. Fetch the public keys of all of the owner's devices and of the friend's devices, and compare the friend's fingerprint with the one pinned on this device (see "Checking keys"): a changed key stops the save with a warning.
   4. Wrap the file key once per key, and record each key's `keyId`.
   5. Encrypt the name and type (`meta`), and upload the ciphertext and the `enc` block.
3. **Opening a file:** download the ciphertext, find the wrap whose `keyId` equals the fingerprint of this device's key, unwrap the file key with the private key, and decrypt in memory (the file, then `meta` for the name). With no matching `keyId` the app says: "This file was locked for another device. Ask someone with access to share it again." The viewers already work from a blob, so they need little change.
4. **Moving a message picture to the box:** done in the client, because the server can no longer encrypt. The app downloads the picture, encrypts it and uploads it.
5. **New device:** a new key pair is created. There are two ways to get the old history back (see `docs/design/message-encryption.md`, "Recovery: the two ways"): **Way 1, my own devices**: a device of mine that already has access wraps each file key for the new key, or I enter the recovery code and restore the old key. **Way 2, ask my friend**: when I have neither, my friend's device opens the keys of our friendship and locks them again for my new key.
6. **Lost access:** if both the device and the recovery code are gone, the files can't be opened. The app says so plainly.
7. **Friendship ends:** the box is deleted, as now.

## Checking keys
- A key is trusted on first use: the first time a device sees a friend's fingerprint it pins it locally (IndexedDB, next to the key).
- A later key from the same friend with another fingerprint is NOT used silently. The app asks the person to compare the new code with the friend (in person, by phone) and only then pins it. This also covers a friend's new device.
- A person can open "Check keys" at any time: both full fingerprints are shown, to read out or scan.
- The fingerprints stored with an item are evidence for later: they show which keys a file was locked for. Alone they prove nothing, because the server could write any value; they are checked against the pinned ones, and are bound into the encryption (extra authenticated data above).

## What is encrypted, and what stays visible
- Encrypted: the file, its preview picture, the file name without its type, and the mime type, all with the file key. Renaming a file encrypts a new name with the same file key, which either friend can unlock.
- Visible to the server: the kind (picture, video, sound, document), the file type ending (kept so the app can choose icons and viewers), the size, the time, and who saved it. The size is needed for the quota. Padding sizes is possible later if hiding them matters.
- The plain file name is no longer stored with the stored file (today `putObject` keeps it as `fileName` in the object metadata and the server sends it as the download name): with encryption the app sets the download name.
- The server can no longer look inside a file, so the check of what a file really is (`checkSafeboxFile`) moves to the app; the server only enforces the size limit. Anything the server must know about a file has to be asked of the client.

## Changes by part
- **New client module (`core/crypto.ts`):** key generation, IndexedDB storage, wrap and unwrap, file encryption and decryption.
- **Safebox service and pages:** upload encrypts and download decrypts. The server serves ciphertext as it does now.
- **Backend:** new endpoints to publish and list public keys, store the backup, and accept the `enc` block. The server checks that the wraps cover every device of both friends (by `keyId`), and no longer stores or sends a plain file name.
- **Rules and docs:** Storage and Firestore rules stay closed; `docs/guide/media-and-safebox.md` gets a section.
- **Old files:** they stay unencrypted until an app offers "encrypt now", which re-uploads them.

## Rollout
1. The crypto module, with tests.
2. Key setup, fingerprint, public key upload, pinning and the recovery screen.
3. Encrypted upload and open, behind a setting.
4. Move-from-message and "encrypt existing files".
5. Multi-device sharing and the recovery restore.

## Risks and open choices
- Lost key and lost recovery code means lost files, so the recovery screen is the key part of the feature.
- Scripts running in the page could still ask the key to decrypt, so strict page security matters.
- The server can still see file names, sizes and who saved what. Hiding names would mean encrypting them too.
- Browser storage can be cleared (iPhone Safari after a week of no use). Ask for persistent storage with `navigator.storage.persist()`.
- Algorithm: RSA-OAEP works everywhere. ECDH on X25519 is smaller, but older browsers lack it.
