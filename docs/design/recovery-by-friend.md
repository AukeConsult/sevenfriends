# Recovery by my friend (Way 2): the plan

Status: the four rules and steps 1 to 6 are built (backend `functions/src/recovery.ts`, Home `core/recovery-inbox.service.ts` + `notifications/`, the page `friend-recovery/`, tests in `functions/test/recovery.test.ts`). Not built yet: step 7 (the code check), step 8 (the question on the asker's other devices), step 9 (resume, ask all, early warning for the helper). Texts: the new ones are in `frontend/public/i18n/en/`, the other languages fall back to English. What exists is step 5 in `docs/design/message-encryption.md` ("Recovery: the two ways", "Way 2: ask my friend").

Way 2 is for the person who has a new key and **neither** another device of their own **nor** their 24 words (Way 1). Then only the friend can open the shared history, because the friend's copy of every message key and file key is still locked for the friend's key.

## What is weak today

1. **One friendship at a time.** A friendship belongs to one circle, so with 7 friends in up to 4 circles there can be 28 separate requests, each asked and approved by hand.
2. **The check is "compare the short code by phone or in person".** Nothing makes the friend do it, and the code is long to read. Somebody who steals a login can add a key and ask the friend; a friend who taps Approve gives away the whole history.
3. **A request never ends.** No expiry, and the asker's other devices are not told that somebody asked.
4. **The friend may never see it.** Only a push; nothing waits for them on Home.
5. **Both apps must stay open** on the recovery page until it is done. If the helper's app closes, the work stops (Continue is a button on the same page).
6. **A helper whose device has no working key** only finds out after starting; items it cannot open are only counted as "skipped".

## The four rules (decided)

1. **A request shows on the friend's Home.** When I ask, my friend gets a card under "Needs you" (live, with the sound of a friend request, and the push as now). A request in another circle shows as the one note "Activity in <circle>".
2. **A decline is told to the one who asked.** The request is not deleted when the friend declines: it becomes `declined`, the asker gets a push and a card on Home ("<name> declined your request. Ask again / Dismiss") and the recovery page says so.
3. **I can ask at any time, again and again**: also when everything works, and also when an earlier recovery is done (a security matter: I can have my friend re-lock everything for all my keys, or check that we still see the same keys). **A finished recovery is a finished task: nothing is kept as history of it.** The menu item "Recovery" is already always there; what changes is that the page says what happens when nothing is missing, and that asking is limited (see step 6).
4. **When the friend has done it, the asker is told.** When the work is finished the asker gets a push and a notice on Home ("<name> opened your history"), live; the recovery page shows the progress and the end.

## What exists today (checked in the code)

- Ask: `POST .../recovery` stores `recovery-request/{connectionId}` and sends ONE push to the friend (`kind: request`). Nothing is shown on the friend's Home and nothing is live on the friend's screens (no stamp).
- Decline and cancel are the same call (`DELETE`): the document is deleted, the asker is **not** told (the page simply finds no request any more).
- Approve and finish change `status` (asked, approved, done); **nobody is told**: the asker only sees it if the page is open (it polls every 2.5 seconds).
- Asking with nothing missing works (total 0, done at once) but the friend still has to approve.
- The same machinery as friend requests exists and is reused: the live stamp `requestsAt` in `sync/state` (`touchSync`), `refreshEverything()` in the app, the "Needs you" card list on Home, `CircleActivityService` (note for another circle, default sound), fading notices (`Notice.fade`), `sendPush` with the circle logic.

## The plan, in order

**Step 1: the state model.** `status` is asked, approved, **declined** or **done**, and the last two are only news on its way, not records: `done` is set by finish and **deleted as soon as the asker's app has shown it** (`POST .../dismiss`, called by the app itself; at the latest after 1 day, cleaned up whenever the list is read); `declined` stays until the asker dismisses it (or 7 days). There is no "done" list, no count of earlier recoveries and no log. `DELETE` stays "the asker takes it back" (the document goes). A new `POST .../decline` (only the helper) sets `declined` and `declinedAt`. A new request always replaces whatever is there, also a `done` one (so asking again is never blocked). `RecoveryState` (shared model) gets `declined`. Every change calls `touchSync(requesterUid | helperUid, 'requestsAt')` so both people's apps refresh live.

**Step 2: who is told what (backend).** `sendPush`: ask → friend ("<name> needs your help", as now); decline → asker ("<name> declined your recovery request", kind `answer`); finish → asker ("<name> opened your history", kind `answer`). All with the push logic that is there (same circle: the text; another circle: "Activity in <circle>"). One new route, `GET /recovery` (my requests across all my circles: as helper and as asker, status, friend, circle, progress) feeds the Home.

**Step 3: Home, the friend's side (rule 1).** A new service reads that list at start, on `requestsAt` and when a circle is opened. Under "Needs you": a card "<name> asks you to help open their old messages" with **Open** (to `/friends/:id/recovery`) and **Decline**. A request of another circle only marks that circle ("Activity in <circle>"). A new request plays the request sound (current circle) or the default message sound (another circle). A request that is taken back or ends disappears live.

**Step 4: Home, the asker's side (rules 2 and 4).** A declined request shows a card "<name> declined your request" with **Ask again** and **Dismiss**; a finished one shows a fading notice "<name> opened your history", and the app then dismisses it (the request is deleted, nothing stays). Both play the answer sound and appear live, also from another circle (as the activity note).

**Step 5: the recovery page (rules 2, 3, 4).** New states: for the asker `declined` ("<name> said no. You can ask again, or use one of your own devices or words"), `approved` with progress (as now) and `done`; for the friend a **Decline** button next to Approve. When nothing is missing the page says so before asking ("Nothing is locked for you now. Asking makes <name> lock everything again for all your keys, and that takes <name>'s approval") and the friend's page says it is a check, not a loss.

**Step 6: limits.** At most 3 asks per day per account (the setting `RECOVERY_ASKS_PER_DAY`, **0 = no limit, which is the value for now while it is tested**; turn it on with `RECOVERY_ASKS_PER_DAY=3` in `functions/.env`), and one open request per friendship (as now); a request expires after 7 days (a stale one is shown as expired and can be asked again).

**Step 7: the check by a code (security).** The new device shows a one-time 6-digit code (valid 15 minutes, only a hash on the server, bound to the request and the key fingerprint, 5 tries); the friend types it in and Approve works only when it fits. The short fingerprint stays as a second check. When the asker has no new key (rule 3) the code is still asked: the friend must be sure the person is there.

**Step 8: the asker's other devices.** When a request is made they get the question "A recovery request was sent to <name> from <device label>. Not you? Remove that key." (the label comes from `core/device-name.ts`, the same card as a new own key).

**Step 9: the rest of the first plan, later.** Work that survives a closed app (resume from the cursor, from any page), "Ask all my friends" with one overview page, a helper whose device has no working key says so before starting.

**Step 10: texts, tests, documentation.** New texts in `frontend/public/i18n/en/*.json`; the push texts are backend texts and stay English until those are translated. Tests in `functions/test/` (decline, dismiss, who may do what, who is told, the daily limit, expiry, the list across circles, the code check); the docs (`message-encryption.md`, `connections.md`, `live-and-notifications.md`) are changed with each step.

## Open choices (defaults in brackets)

- Rule 3 means: ask again at any time, also right after one that is done, also with nothing missing; the friend approves each time [yes; no shortcut without the friend].
- The friend has **Decline** on the card and on the page [yes]; "Not now" stays as "do nothing yet".
- A finished request: a fading notice, then it is deleted; nothing is kept [yes, your rule].
- Limits: 3 asks per day, 7 days to expire [yes].

## What this does not solve

If both people have lost their keys, the history of that friendship is gone; the app says so. Pinning friends' keys (knowing that a new key really belongs to the friend) is a separate step.
