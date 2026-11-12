# Several friend circles: design

Status: the data is ready, the circle features are not built. For now everything happens in the default circle. Date: 2026-11-07.

## Ready now (so that more circles need no change to the stored data)
- Every friend entry stores `circleId` (its own circle) next to `peerCircleId` (where the other copy lives); the app gets it as `Friend.circleId`.
- Every message stores `circleId` on both copies: the sender's copy has the sender's circle, the receiver's copy the receiver's circle. The list of unread messages carries it too (`Message.circleId`).
- Friend requests already carry `circleId` of the sender.
- **Preferences are per circle:** theme, text size, message order, Enter sends, sleep list, pictures and (no longer shown in the app) ready-made messages are stored in `settings` on the circle's own document (`GET /circles` returns them, `PUT /circles/:circleId/settings` saves them), so each circle can have its own and a new circle starts empty (the app then fills it from the device, never from the defaults). Only what is about the screen or the device stays local.
- What was stored before has no `circleId`: it is read as `default` (`circleIdOf` in `functions/src/constants.ts`), so there is nothing to migrate.
- Seats, the safebox and its keys follow the connection, so they belong to a circle through it. The seat number is per circle because it is stored on the entry.
- Not done yet, on purpose: a query that filters by circle needs an index (`messages(circleId, time)`), added when it is first used; the paths that still name `default` are listed below.

## Goal
A person can have several circles (for example "My friends", "Family", "Work"). The same friend can be in more than one of them, and the conversations stay apart: a message written in one circle is never seen in another. The app has one overall switch for the circle the person is working in.

## What exists today
- Friend entries live under a circle: `user-account/{uid}/friend-circle/{circleId}/friends/{id}`; the API is `/circles/:circleId/friends/...`.
- A message belongs to a **connection** (`connectionId`, the id the two friend entries share), not to a circle.
- Only the circle `default` exists, nothing creates another one, and the server refuses a second connection between the same two people.
- Many places use the default circle directly (accepting and seating requests, sleep, invites, media access, realtime, the frontend).

## Rules
1. **A connection belongs to one circle on each side.** Each circle membership is its own connection: its own id, seat, messages, safebox and safebox keys. The same two people in two circles have two connections that never mix.
2. **One connection per pair of people per circle pair** (it was: per pair of people). Adding someone who is a friend in another circle is allowed.
3. **Seats are per circle:** up to 7 friends in each circle.
4. **Messages need no change to be isolated**: they already follow the connection. What changes is what is listed: unread, Home and notifications say which circle a message belongs to.
5. **Profile things stay per person**, not per circle: name, picture, icon, colour, mood, country, presence, keys.

## The overall switch (client)
- The app has an **active circle**, set in one place (a switch in the top bar, and the choice is remembered in the profile settings, so every device opens in the same circle).
- Everything the person does works inside the active circle: the friend list and its seats, adding a friend, the sleep list, the unread count, Home, and the notification badge.
- Opening a conversation (also from a notification) switches the active circle to the circle that conversation belongs to.
- A friend request that arrives is **pending for the person, not for a circle**: it is shown in the Pending list whatever the active circle is. **Accepting it puts the friend into the circle that is active at that moment**; the person can switch circle first. If that circle has no free seat, the request keeps waiting.
- The sender adds a friend into the circle that is active for them. A request for a person who already is a friend in that circle is refused as today; in another circle it is a new connection.

## Data model
- `friend-circle/{circleId}`: `{ name, type, createdAt }`; ids become random (the default keeps the id `default`).
- Friend entry: `connectionId`, `circleId` (its own circle), `peerCircleId` (where the other copy lives). `peerCircleId` is set when the request is accepted, because the receiver chooses then.
- Friend request: `circleId` of the sender (as now); the receiver's circle is set at accept time.
- `activeCircle` (id): the circle the person works in. It is a choice about the whole person, so it is kept on the account (profile), not on a circle.

## Server changes
- Circles: create, rename, delete (deleting a circle ends its friendships like deleting the friends one by one; the default circle cannot be deleted). At most a handful per person.
- Accept: takes the target circle (`POST /friend-requests/:id/accept { circleId }`), checks its free seat, stores the receiver's entry there.
- Seating of waiting requests, sleep, seat moves, invites, profile matching, media access, safebox access, realtime and erase: use the circle of the entry, never `default`.
- "One connection per pair" check becomes per circle pair.
- Unread and the message list answer with `circleId` for each message (from the connection).

## Client changes
- `FriendsService` keeps the circles and the active one; every path uses `circle().id`.
- The circle switch in the bar; Settings page to make, rename and delete circles.
- Friends, Pending, Sleeping, Home and the badges filter by the active circle (Pending shows all, with the circle a request would join).
- The realtime listeners watch all circles of the person.

## Order of work
1. Circle id in every path (no behaviour change): replace each `DEFAULT_CIRCLE_ID` use with the circle of the entry; tests stay green.
2. Create/rename/delete circles; the active circle in the profile settings.
3. Per-circle pairs: allow the same person in two circles; accept into the active circle.
4. Client: switch, per-circle lists, Home and badges.
5. Tests: two circles with the same friend and separate messages, safebox and seats; the unread count per circle; deleting a circle.

## Open questions
- How many circles at most (suggested: 7, the same as the seats)?
- Is a friend in two circles one person on the Home page (one row) or two (one row per circle)? Suggested: one row per circle, tagged with the circle name.
