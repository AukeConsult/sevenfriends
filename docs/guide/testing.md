# Testing

Part of the project guide (moved out of `CLAUDE.md`; text unchanged). Read this before running or changing the backend tests.

## Testing
`functions/test` holds the tests for the connection rules above. They play the rules out in a **pool of 60 people**, with a mocked login, against the real backend routes.

```
npm --prefix functions install     # once (adds vitest, supertest, the rules-test tools)
npm test                           # all tests, ~40 s, no Java and no emulator needed
STRESS_SEEDS=1,2,3,4,5,6,7,8 npm test      # more random runs (default seeds: 1-4)
npm run test:emulator              # same tests on the real Firestore emulator (needs Java 21+)
```
- `preferences.test.ts`: sounds on the account (null at first, saved, replaced, one per person, bad ids / volumes refused and nothing saved, login needed, erased with the account) and that `GET /profile` says whether the email is verified.
- `media.test.ts`: the media cache (see "Media cache").
- `picture.test.ts` / `mood.test.ts`: the uploaded picture (formats, size, first bytes, replace, remove, erase) and the mood (values, who sees it, friends are told).
- `mail.test.ts`: the mail trigger (see Sending email).
- `invitations.test.ts`: (also the unverified-friend warning) the message with a request (kept, trimmed, 500 limit, reaches the other person), who is offered an invitation (email, SMS, nobody if they have an account), sending (outbox content, once only, owner only, not after sign-up, daily limit, erased with the sender).
- `push.test.ts`: push devices and what is pushed (see Push notifications).
- `erase.test.ts`: deleting an account and closing a friendship wipe everything on both sides, in one transaction.
- `verification.test.ts`: unverified people are reachable and their friends are told (`unverified`, `fromUnverified`, gone once one detail is verified, the claimant case, typed phone, clearing it), the confirmed phone (not editable, fills the contact number), social accounts never find anybody and anybody can add a friend, verified or not.
- `connections.test.ts`: focused scenarios: matching (email, phone in every format), confirm, reject, delete, waiting list and promotion order, mutual add, duplicates, validation, unread messages.
- `shared-models.test.ts`: the shared models stay shareable (no outside imports; plain data allowed) and the copy script works (copies, only rewrites changes, `--check`, removes stale generated files).
- `signals.test.ts`: the pings: who gets one (all 9 ways of identifying a person, never yourself, both accounts of a double match), what is in it, that the check consumes exactly what it saw, and that a ping goes with its entry (delete, merge, duplicate); in the pool: the ring (180 pings, one check each empties them) and 49 pings to one person.
- `rules.test.ts`: the Firestore security rules (user control): own pings and messages readable, nobody else's, no client writes, everything else closed. Emulator only.
- `profile.test.ts`: the name (change, trim, empty/too long refused, kept at the next login, what others see) and the autosave payloads (saving twice, typing letter by letter, an invalid value saves nothing, clearing a field).
- `peers.test.ts`: a friendship goes over a list of one other person: one copy for each person with the same id and the right circle, edit and delete reach both copies, delete-several, sleep list and poke. It passes before and after the change to the list.
- `groups.test.ts`: a group as a friend (make, seat rules, sleep list, own feed, not reachable by others, no recovery, safebox keys), leaving and the last member, erasing an account, and the profile of a group: name, description, adding and removing members, a new member reading and writing.
- `group-keys.test.ts`: the key list of a group (every other member), a message locked for every key of every member (a missing, extra or stale copy gives 409), members joining and leaving.
- `chat.test.ts`: the message feed: who may message, both people see the same conversation, privacy, per-connection feeds, the 200 limit, text rules, unread/read, and deleting a connection deletes its feed.
- `pool.test.ts`: everyone at once: a ring (each person adds the next 3, all confirm; then all 60 chat with all 6 friends: 360 messages), one popular person (49 ask 1, only 7 seats), and random runs of 500 mixed actions (seeded, so a failure can be replayed with the same seed).
- `helpers.ts` has `assertConsistent()`, which reads everything straight from the database after each scenario and checks: max 7 seats, one id per connection, both sides linked and in the same status, confirmed = both sides, rejected = requester only, no orphan requests, waiting flags only while really waiting, no duplicate connections, and every message exists exactly twice (sender + receiver) on a confirmed connection.
- By default the tests use an in-memory Firestore (`fake-firestore.ts`), which follows the Firestore rules that matter here (transactions: reads before writes, retry on conflict, all-or-nothing; `update` of a missing document fails). Run `npm run test:emulator` now and then to confirm the real emulator agrees.
- On the real emulator the "everyone at once" steps run one person at a time: the emulator locks documents during a transaction, and a ring of people who all write into each other's lists would wait on each other until "Transaction lock timeout". In production this needs many linked people to act in the same instant (the SDK also retries), but if heavy simultaneous use is expected, avoid reading a whole friends collection inside transactions (for example keep a seat counter on the circle).
- **When you change a connection rule: change the code, the "Connection rules" section above, and a test.** A rule is only done when the pool tests still pass.
