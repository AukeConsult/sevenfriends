# Key recovery and keys: the fixed rules

**These rules are decided. Do not change them, in code, tests or documents, unless the owner of the project specifically orders it.** If a task seems to need a change to one of them, stop and ask. Everything else in `recovery-by-friend.md`, `recovery-own-devices.md` and `message-encryption.md` ("Recovery: the two ways") builds on these rules; if a text there disagrees with this file, this file is right.

## 1. What a re-open is

1. **A re-open locks the KEYS again, never the content.** The device that helps opens the content key of an item with its own key and locks that same content key again for the keys that must be able to open it. Ciphertext, IV and signature never change. Only the list of copies (`enc.wraps`) of the item changes.
2. **What is covered:** every message the two people have in common (Way 2) or every message of mine (Way 1), and every safebox item of the friendship (Way 2) or of all my friendships (Way 1): files, notes and every other object. Files are re-locked the same way: only the key, never the bytes.
3. **Both copies.** A message has one copy for each person, each holding only the copies of its owner; the helper writes the asker's copy and (Way 2) its own copy. A safebox item is one list for both people. A copy of somebody else's in a shared list is never touched.
4. **A copy for a key that is gone is dropped** when an item is changed by a re-open (see rule 4).

## 2. Which keys get copies

5. **Way 2 (my friend helps):** every key in use of the person who asks AND every key in use of the helper. A re-open covers all the devices of both people.
6. **Way 1 (my own other device helps, "Allow"):** only the key being allowed now, the keys allowed before (`ownShared`) and the keys in my signed device list. **A key that still waits for its own Allow gets nothing**, so a key added by somebody who stole my login gets no history because I allowed my own new phone.
7. The keys are **read again on every pass**, so a device that gets a key while the work runs is covered. The work runs in passes until a pass does nothing.

## 3. Who must be there

8. **Only the helper's app has to stay open** while it works. The asker's page is only a view; the asker is told by a push and on Home when it is done. (Way 1: the device that does the Allow.)
9. **Approval stays.** Way 2: the friend approves each request. Way 1: a person taps Allow on a device that works for each new key; nothing is copied before. Declining and "Not me" stay as they are.

## 4. Removed keys do not exist

10. **A removed key is deleted** (`POST /keys/:id/remove`, "Not me", a new beginning of the signed list). There is no "retired" or "revoked" state, no "Removed" badge and no list of removed keys. Nothing is kept of a removed key except what the other rules say about copies.
11. **Items still locked for a deleted key** are found by the re-lock step (`reencrypt.ts`): an item is stale when one of MY copies is for a key that no longer exists. It is then locked again with a fresh content key for the keys in use. This is the only place where a fresh content key is made on purpose, and it is not a recovery.
12. **A device that still holds a removed key** publishes it again as a new key that waits for an Allow. Nothing is opened without that Allow (rule 6). This is accepted.

## 5. Finishing and telling

13. **A request is finished only when nothing lacks a copy for a key that must have one.** Way 2: `finish` is refused (409) while the server's own count is more than what the helper's device says it could not open (`skipped`). Way 1: a key is marked allowed only when nothing of mine lacks a copy for it; `done` is refused otherwise.
14. **What could not be opened is counted and told** (`skipped` on the request), shown on the helper's device and to the asker. It is never silently dropped and never counted as done.
15. **A finished recovery leaves nothing behind**: the asker's app shows it once and the request is deleted (at the latest after 1 day; an unanswered one after 7).

## 6. Writing the copies

16. **One transaction per batch.** The list of copies of an item is read and written together, so two batches at once never lose a copy.
17. A list is never left empty and never longer than `MAX_WRAPS`; a copy is accepted only for a person and key the rules above allow (the server checks shape and who it is for; it cannot check that a copy is a real one).
18. Nothing readable passes the server: no key, no text, no file.

## 7. A member who leaves a group

19. **What a member saved in a group stays.** When a member leaves or is removed, none of their safebox items are deleted (the item keeps `addedBy`; an item they attached to, and what others attached to their items, all stay).
20. **Their KEYS are taken out of every item of the box**: every copy of an item's key that is for that person is removed from the item's list of copies (`removeMemberKeys`), so none of their devices can open anything of the box any more. Nothing else about the item changes; the content is never touched.
21. **An item that is left with no copy at all** (the leaver held the only copies, so nobody can open it) is deleted with its file, preview and reminders. This is the only case where an item of a leaver goes.
22. **Deleting an account is a different case and stays as it is:** a person whose account is deleted takes EVERYTHING they saved out of the boxes of their groups (the items, with their files, previews, attachments and reminders), because deleting an account wipes everything about the person (`docs/guide/connections.md`). That is `deleteItemsOf`, called by `eraseUser` through `leaveGroup(..., wipe = true)`. Rules 19 to 21 are for a member who leaves or is removed and keeps their account.
23. Each list of copies is changed in one transaction. The leaver's own copies of the messages go as before (each member has their own copies); the members that stay keep the group, its messages and its safebox, and get a push ("What they saved in the safebox stays. They can no longer open it.").

## 8. A member who joins a group gets the earlier messages

24. **Every member has the whole conversation of a group, also what was written before they joined** (also a member who was added earlier, before this rule: they are caught up the same way). A message exists as one copy for each member, so a late member has none until another member's device gives it to them. The adder, and later any member whose device has the copy, does it quietly when the group is open; one device is enough.
25. **Only copies are made, the content is never touched.** A text that is not locked is copied by the server. A locked message is opened by the member's device with its own key and locked again for the keys of the member who lacks a copy: the same locked text, the same iv, only the copies of the message key are new (a copy for a member holds only that member's keys). A file of a message stays under its sender and is readable through the member's copy.
26. **Quiet and safe to repeat:** a copy that exists is never replaced, nothing is ever taken away, the copies are marked read (history is not news, no push), and the member's feed reloads. A copy is accepted only for a current member and one of their keys in use, and never for the person who wrote the message (who deleted their own copy).
27. A member with no key yet gets the texts that are not locked at once and the locked ones when they have a key. (A member who leaves loses their copies; see rules 19 to 23.)

## Where it is in the code

- Way 2: `functions/src/recovery.ts` (`messageNeeds`, `boxNeeds`, `relocked`, `countMissing`), `frontend/src/app/core/recovery.service.ts` (`help`), page `frontend/src/app/friend-recovery/`. Tests: `functions/test/recovery.test.ts`.
- Way 1: `functions/src/own-recovery.ts` (`allowedOf`, `relocked`, `countLacking`), `frontend/src/app/core/own-recovery.service.ts` (`allow`). Tests: `functions/test/own-recovery.test.ts`.
- A member who joins a group gets the earlier messages: `functions/src/group-history.ts`, `frontend/src/app/core/group-history.service.ts` (called from `friend-context.ts`, and with `force` after adding a member in `friend-profile.ts`). Tests: `functions/test/group-history.test.ts`.
- A member who leaves a group: `functions/src/groups.ts` (`leaveGroup`), `functions/src/safebox.ts` (`removeMemberKeys`). Tests: `functions/test/group-keys.test.ts`.
- Removed keys: `functions/src/keys.ts` (`/:id/remove`, `startOver`), `functions/src/reencrypt.ts` (`staleFor`). Tests: `functions/test/keys.test.ts`, `key-churn.test.ts`, `key-list.test.ts`, `reencrypt.test.ts`.
