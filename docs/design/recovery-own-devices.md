# Recovery with my own devices (Way 1): what exists and the plan

Status: examined, the plan is not built. Way 1 is step 5b in `docs/design/message-encryption.md` ("Recovery: the two ways") plus restoring a key from the 24 words (`docs/design/safebox-encryption.md`). Code: `functions/src/own-recovery.ts`, `core/own-recovery.service.ts`, `own-key-prompt/`, `encryption/`, `key-setup/`, `core/keys.service.ts`.

Way 1 has two parts. **1a: another device of mine gives the new key its copies** ("Allow"). **1b: my 24 recovery words put my old key on the new device** (restore).

## How it works today (checked in the code)

**1a, Allow.** A new device makes its own key (new 24 words are shown and checked). The key is published as *waiting* (`ownShared: false`). A device whose key is *shared* (the first key, a key that was allowed, or for old data the oldest key) shows the card "A new key was added to your account" with the label and the short code, Allow / Not now (`own-key-prompt`, checked at start, every 5 minutes and on focus). Allow reads my own messages and files that have no copy for the waiting key (100 at a time), opens each with this device's key, locks it for the waiting key and files it; `done` marks the key allowed only when nothing lacks a copy. If this device could not open some items the key stays waiting. `trust` lets a device declare itself the shared one.

**1b, the words.** The words open the backup of my old private key (`key-backup/current`); "I already have a key (restore it)" in Settings → Keys puts that same key on the new device. Nothing is copied: everything the old key opened is open at once.

## What is weak today

1. **The new device is left alone.** After "Make my key" it only says the key is ready. Nothing says "your history is locked until another device of yours allows it", nothing shows progress, and nothing tells the new device when it is done. The place that explains it (Settings → Keys → Advanced) is hidden behind a button. The hint in a chat points to Advanced.
2. **The old device is not told.** There is no push: the card appears only when the app is opened on a shared device (every 5 minutes, or on focus). A phone in a pocket never knows.
3. **The only check is "was this you?" with a code to compare by eye.** Somebody with a stolen login can publish a key; an inattentive Allow gives away the whole history. Way 2 gets a typed code (step 7 of `recovery-by-friend.md`); Way 1 should too.
4. **Which device may help is a guess.** "Shared" means first, allowed, or the oldest key. When the oldest device is lost, nobody is eligible and the person must find "This device opens my old messages" (hidden under Advanced, only shown when no Allow button exists). A device can test for itself whether it opens items; it should not need to be told.
5. **One item it cannot open blocks the key for ever.** Allow does not call the key complete when something was skipped, so the card comes back again and again, and the new device never counts as allowed.
6. **No live end.** The new device does not learn that it was allowed. The person has to look again (and reopen the chat).
7. **A restore copies the key instead of making one.** After "restore" two devices hold the SAME key (same id): the list shows one entry, and a lost device cannot be removed without removing the key of the other too. Allow (1a) gives each device its own key that can be removed alone.
8. **The words are fragile to type.** One textarea, one error for everything; no hint which word is wrong, and nothing reminds the person that the words exist or checks that they were kept.
9. **The ways are scattered.** Allow is in Advanced on the old device, restore is in Settings → Keys on the new one, Way 2 is in the friend's menu, and the chat hint names only two of them. No page says "these are your ways, this is the state of each".

## The rules (decided)

1. **A device with locked items says so.** What it cannot open is shown on **Home** (a card under "Needs you") and as a **band under the feed** and on the **friend's (party's) page** and the safebox page, with what the person can do about it. Not a hint hidden in Advanced.
2. **The device makes a request that shows on my other devices.** The request is made by itself when a new key is published next to other keys, and by a button ("Ask my other devices") **at any time** there are locked items, also again and again (a new request replaces the old one). It shows on every other device of mine (a card on Home with Allow and Not me, the banner, a push) and live.
3. **A finished request leaves nothing** (the same as Way 2): the other device tells the asker and the request is deleted once shown.

## The plan, in order

**Step 1: the device knows what is locked.** A core service `LockedItemsService` counts what this device's key cannot open: totals from `GET /own-recovery/status` (messages and files lacking a copy for this key) at start, on focus, after a feed or the safebox is loaded and when a key event arrives; and per friendship from what the feed itself finds locked (a locked message is already known to the feed, `hasShut()`), so the band needs no heavy query.

**Step 2: it shows (rule 1).** A card on Home under "Needs you": "<n> messages and <m> files are locked on this device. Get them back" (to the page of step 3). A band under the feed and on the friend's page: "<n> of your messages with <name> are locked on this device" with the ways (ask my other devices, my 24 words, ask <name>). The same band in the safebox. It replaces the small `recovery-hint` text. It disappears when nothing is locked.

**Step 3: one page "Get my old messages back".** A route that lists the ways with the state of each: *my other devices* (request made / waiting for <device label> / working x%), *my 24 words* (type them here), *ask a friend* (Way 2). Every band, card and the setup of a new device lead here.

**Step 4: the request to my other devices (rule 2).** `own-recovery-request/{keyId}` of the asking key: `label`, locked counts, `status` asked, working, declined, done, `createdAt`. Made when a key is published next to other keys, and by `POST /own-recovery/ask` at any time (it replaces the old request; the counts are read then). It shows on the other devices as a card on Home (**Allow**, **Not me**, with the device label and the counts), the banner as now, and a push to the person's devices ("<label> wants to open your old messages", kind `request`; another circle: "Activity in <circle>"); both sides are live through a stamp (`keysAt` in `sync/state`). Allow works as today (and shows progress on both); **Not me** removes the key at once and tells the asker; finished tells the asker and the request is deleted (rule 3).

**Step 5: the asking device is live.** It shows waiting, working with the progress, declined ("<label> said no: use your words or ask a friend") and finished; when it is finished it returns to the message feed with a note "Your history is open on this device" (as Way 2).

**Step 6: a typed code (shared with Way 2).** The asking device shows a one-time 6-digit code (valid 15 minutes, only a hash on the server, 5 tries); the allowing device asks for it before Allow works. Built once for both ways.

**Step 7: a device proves itself.** A device tests for itself whether its key opens a few messages and files; if it does it is eligible to allow others. No more "oldest key" guess and no hidden "use this device" button; `ownShared` stays as the result of the work done.

**Step 8: partial is allowed.** Items a device cannot open are counted; the key is marked allowed with "n items could not be opened" and the band then offers Way 2 for exactly those friendships. The card does not come back for ever.

**Step 9: after a restore from the words.** The page offers "Give this device its own key" (optional), so every device can be removed alone.

**Step 10: the words are easier to give.** Accept pasted text (numbers, line breaks, capitals), say which word is not on the list, and "Type 3 words to check that you still know them".

**Step 11: tests, texts, documentation.** Tests in `functions/test/own-recovery.test.ts` (the request, who sees it, Allow, Not me, the code, partial); the English texts in `frontend/public/i18n/en/`; `message-encryption.md`, `safebox-encryption.md`, `live-and-notifications.md`.

## Open choices (defaults in brackets)

- The first build is steps 1 to 5 (locked state, the cards and bands, the page, the request to my other devices, the live asking device); then 6 (the code, with Way 2), then 7 to 10 [yes].
- The request is made by itself when a key is published next to other keys [yes], and the person may also ask at any time [yes].
- "Not me" removes the key at once [yes].
- A key may be marked allowed with items left over, when the person agrees [yes].
- After a restore, offer "give this device its own key" [yes, optional].
