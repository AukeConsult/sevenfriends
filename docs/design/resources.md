# Resources

Status: **proposal**. Nothing is built. This is the first draft, to be argued with before any code is written.

A **resource** is a piece of value that can be passed, lent, used, booked or shared between the people of one friendship or one group. It can be a thing (a drill, a book, a car), a piece of time or a place (the cabin in July, Tuesday's lift to school), a skill or a favour (an hour of help), a thing of value that is not physical (a subscription seat, a file, a recipe), or a small amount of something countable (eggs, points, tickets).

The point is the same as for the rest of Seven Friends: the people closest to you can help each other without anything leaving the circle. Resources add **what can be given and taken** to what the app already has: messages (what is said) and the safebox (what is kept).

Each friendship and each group has a **resource pool**: everything that is offered inside it, seen and used by its members. A resource always lives inside **a connection**: a friendship (two people) or a group (several). It is never public and never visible to anybody outside that connection. Groups and friendships are the same thing for resources, as they are for messages and the safebox (the id of the connection is the key).

## The words

| Word | Meaning |
|---|---|
| **Resource** | The thing itself: name, description, picture, kind, how many. |
| **Owner** | Who the resource belongs to: **a person** or **the group**. Only the owner can give it away or delete it. |
| **Holder** | Who has it right now. Equal to the owner unless it is lent. |
| **Share** | Where the resource is offered: with one friend, or with a whole group. A resource can be offered in several connections at once (see "One resource, many connections"). |
| **Pass** | One step in the life of a resource (offered, asked for, handed over, returned, ...). Every pass is written down as an **event**. |

## The five things you can do

Everything is one of these. A user of 90 IQ must understand them from the buttons alone, so the app shows these words and nothing else:

1. **Offer / share**: "This is here for you to use." The owner says who can see the resource and what they may do with it.
2. **Ask**: a member asks for a resource ("Can I borrow the drill on Saturday?"). The owner (or, for a group resource, any member with the right) answers yes or no. Asking is the only way to take something; nobody takes it by themselves.
3. **Lend**: the holder hands it to somebody for a time (or for no fixed time). The person who gets it **accepts**, so both agree it was handed over. It has a due date or "no date".
4. **Give**: the owner hands it over for good. The new owner accepts. History stays.
5. **Use / book**: for a resource that is not handed over (a cabin, a car, a lift), the member books a **time slot**; two slots cannot overlap. For a resource that is used up (eggs, tickets), the member **takes** an amount and the count goes down.

A sixth, **return**, is the end of a lend: the borrower says "I returned it" and the owner confirms (or the owner marks it returned by themselves).

## Kinds

The kind decides which of the five things make sense. It is chosen when the resource is made and does not change.

| Kind | Example | Lend | Give | Book (time slots) | Take an amount |
|---|---|---|---|---|---|
| `item` | drill, book, bike | yes | yes | no | no |
| `place` | cabin, garage, parking space | no | no | yes | no |
| `time` | a lift, an hour of help, babysitting | no | no | yes (the slot is the resource) | no |
| `supply` | eggs, firewood, tickets, points | no | yes (an amount) | no | yes |
| `digital` | a subscription seat, a file | yes (a seat, a copy) | yes | yes | no |

`digital` can **link to a safebox item** (the same linking the safebox already has between items). The safebox stays the place where the file is; the resource says who may use it and when.

## Where it lives

Like the safebox, a resource belongs to a connection id. The ledger is **one document per resource plus an append-only list of events**, so the history can never be silently rewritten.

| What | Where |
|---|---|
| The resource | `resource/{resourceId}`: `connectionIds` (the friendships / groups it is offered in), `kind`, `name`, `description`, `picture`, `ownerType` (`user` or `group`), `ownerId`, `holderId`, `quantity` (for `supply`), `status`, `rules`, `createdBy`, `createdAt`, `updatedAt` |
| The events | `resource/{resourceId}/events/{eventId}`: `type`, `byUid`, `toUid`, `amount`, `from`, `to` (slot), `due`, `note`, `at`, `status` |
| A member's list | a small mirror, `user-account/{uid}/resource-index/{resourceId}`: `name`, `connectionId`, `status`, `holderId`, `dueAt`, `unread`. It is what the Home page and the notification list read, so they never scan every resource. |
| Bookings | `resource/{resourceId}/slots/{slotId}`: `from`, `to`, `byUid`, `status` (a separate collection so a clash check is one range query) |

`connectionIds` is an array so that "one resource, many connections" (below) needs no copy; every query by connection uses `array-contains`.

### Event types

`offered`, `unoffered`, `asked`, `declined`, `lent`, `accepted`, `rejected`, `returned_by_borrower`, `returned_confirmed`, `given`, `taken` (an amount), `booked`, `booking_cancelled`, `note`, `deleted`.

State of a resource is **derived from the events** and cached in `status`. A mistake is corrected with a new event, never by editing an old one.

### Statuses

`available` → `asked` → `lent` (has `holderId` and `due`) → `return_pending` → `available`. And `given` ends the owner's part. `deleted` hides it for everybody but keeps the events for 90 days so a dispute can still be settled.

## One resource, many connections

A drill may be offered to three friends and to the family group. The resource is one document with several `connectionIds`; **one** borrower at a time holds it. When it is lent, everybody who sees it sees "Anna has it until Friday". This is the whole point: nobody asks the same drill from two friends at once.

A group-owned resource (`ownerType: "group"`) belongs to the group: any member can lend it on, the maker of the group and the person who added it can delete it. It is for the shared things: the cabin of the family, the club's projector.

## Who can do what

| Action | Who |
|---|---|
| Offer, change, delete a resource | the owner. For a group-owned one: the member who made it, and the maker of the group |
| See it | the people in the connections it is offered in (see open question 3 for people on the sleep list) |
| Ask | a member of a connection it is offered in |
| Answer an ask, lend | the owner, or for a group-owned resource any member (first answer wins; the others see who answered) |
| Accept a lend or a gift | the person it was handed to, and only them |
| Return, confirm return | the holder says "returned", the owner confirms. The owner can also confirm without the holder |
| Book | any member the resource is offered to, if the slot is free |

The server checks all of this. The client only hides buttons.

## Rules the owner can set

On the resource, all optional:
- **Maximum time** of a lend (e.g. 7 days).
- **Who may ask**: everyone in the connection, or only people the owner answers one by one.
- **Needs confirmation to return**: on by default for `item`.
- **Amount per take** (for `supply`).
- **Booking window**: how far ahead a slot can be booked and the longest slot.

## Trust, reminders and notifications

- A lend with a due date sends **one reminder** to the borrower the day before and **one to the owner** the day after it passes. Never more: the app must not nag friends.
- A push is sent for: an ask, an answer, a lend / a gift to accept, a return to confirm, a booking made or cancelled on something I own. They go through the same sound settings as messages (a new event type, `resource`, with its own sound).
- The Home page shows "Needs you" for an ask or a lend that waits for me, and "On loan" for what I lent or borrowed (the quiet list under the notices).
- No score, no rating, no "trust level" of a friend. A history of passes is shown as a plain list, nothing is summed up.

## Keys and locking

A resource has a name, a description and a picture. When both people of a friendship (or all members of a group) have an encryption key, those **text fields and the picture are locked** exactly as safebox items are (see `safebox-encryption.md`): the server stores them as locked data and cannot read them. What the server needs to do its job stays plain: `kind`, `status`, `ownerId`, `holderId`, `due`, slots and amounts, because it must check clashes and send reminders. The reminder push says "A resource is due", not its name, for a locked connection.

When keys are missing the resource is stored unlocked, with the same notice as for messages ("Not private yet"). The locked / unlocked state is per resource and is shown on it.

## What happens when people go away

| Event | What happens to the resources |
|---|---|
| A friend is deleted | Resources offered **only** in that friendship disappear from both lists. A resource that is **lent** is not silently dropped: both people get "Anna still has your drill" on Home until it is marked returned or the lend is closed by the owner. Events are kept 90 days, then deleted. |
| A person leaves a group | Their group-owned resources they made stay with the group. The ones they own personally and offered in the group are unoffered in that group. A lend to or from them is closed with a notice to the owner. |
| The account is deleted | Their resources are deleted, with a notice to every holder ("Anna deleted her account: her drill is no longer in the app"). Open lends are listed on the delete page before the person confirms, so nobody deletes an account while holding a friend's drill without knowing it. |
| A friend is put on the sleep list | Nothing changes for lends in progress. New asks from a sleeper are held as for messages. |
| A group has its last member leave | The group, its safebox and its resources are wiped together. |

## In the app

Following the rules of the app: every function is a full-screen page, no pop-ups, a confirmation is an expandable frame under the thing it is about.

| Page | What |
|---|---|
| `/friends/:id/resources` | The resources of this friend or group: a list with a chip for each state (Available, On loan, Waiting for me). The tab sits next to Send, Messages and Safebox in the friend header, with its own icon. |
| `/friends/:id/resources/new` | Make a resource: kind first (five big choices with a picture), then name, description, picture, who it is offered to, rules. Ends with Cancel and Save. |
| `/friends/:id/resources/:resourceId` | One resource: picture, name, who has it, the buttons that fit the state (Ask, Lend, Give, Book, Return) and the history of passes underneath. |
| `/resources` | **All my resources** across friends and groups: what I own, what I have borrowed, what is booked. Reached from the Home page ("On loan") and from Settings. |
| Home | "Needs you" shows asks and lends that wait for me; "On loan" shows what is out and what is due soon. |

The "Tell X about this" button of the safebox is reused as **Tell X** on a resource (a short message into the conversation with a link). A message can link to a resource the same way it links to a safebox item.

## API

Under `/circles/:circleId/friends/:friendId` (the connection is the friend or group id; `friendId` is the connection id):

| Function | Route | Who |
|---|---|---|
| List | `GET /resources?status=&mine=` | any member |
| Make | `POST /resources` `{ kind, name, description?, picture?, quantity?, rules?, offeredIn: connectionId[] }` | any member |
| Change | `PATCH /resources/:id` | the owner |
| Delete | `DELETE /resources/:id` | the owner |
| Offer / unoffer | `POST /resources/:id/offer` `{ connectionId }` · `DELETE /resources/:id/offer/:connectionId` | the owner |
| Ask | `POST /resources/:id/ask` `{ from?, to?, note? }` | a member it is offered to |
| Answer | `POST /resources/:id/answer` `{ askId, yes, note? }` | the owner (or any member, group-owned) |
| Lend | `POST /resources/:id/lend` `{ toUid, due? }` | the owner / holder |
| Accept | `POST /resources/:id/accept` `{ eventId }` | the person handed to |
| Return | `POST /resources/:id/return` · `POST /resources/:id/return/confirm` | holder · owner |
| Give | `POST /resources/:id/give` `{ toUid, amount? }` | the owner |
| Book | `POST /resources/:id/slots` `{ from, to }` · `DELETE /resources/:id/slots/:slotId` | any member · the one who booked, or the owner |
| Take | `POST /resources/:id/take` `{ amount }` | any member (a `supply`) |
| History | `GET /resources/:id/events` | any member |
| Mine, everywhere | `GET /resources/mine` (top level, not per friend) | me |

Every change is **one transaction** that writes the event, updates the cached `status`, writes the member mirror (`resource-index`) and, for a booking, checks the clash. A repeat of the same request (same `requestId` from the client) is answered with the first result, so a flaky phone connection never lends a drill twice.

## Database and cost

Written with the lessons of groups in mind (field masks, no big fields in lists, no scans):

- **List of a connection**: one query on `resource` with `array-contains` on `connectionIds` and an order by `updatedAt`; **field mask** `name, kind, status, holderId, ownerId, due, thumb` so the picture data URL is not read for a list. Composite index `connectionIds` (array) + `updatedAt` desc.
- **A thumb** (64 px) is stored next to the full picture, so a list never reads the big one.
- **Home** reads only `resource-index` of the user (a small document each), never the resources.
- **Clash check** for a booking: range query on `slots` by `from`, in the same transaction as the write. Index `from` asc.
- **Reminders**: a scheduled function reads `resource-index` where `dueAt` falls in the next day, in pages, using a collection group query with an index on `dueAt`. It never scans resources.
- **Events** are small (no pictures, no long text); the history is read newest first with a limit of 30 and a cursor.
- Size limits: 200 resources per person, 100 per group, 500 events kept live per resource (older ones are summed into a single `archived` event).

## Tests

A backend test file `functions/test/resources.test.ts` in the style of `groups.test.ts` (the fake Firestore with field masks):
- the five things, one test each, and the refusal for each who-can-do-what row
- a lend cannot be made twice; a second ask while lent is queued, not refused
- two bookings that overlap: the second is refused; one that touches is accepted
- `supply` never goes below zero (two takes at once)
- a resource offered in two connections has one holder
- a friend deleted while a lend is open leaves a notice, not a hole
- the same `requestId` twice makes one event
- a locked connection stores no plain name, description or picture
- the pool test (60 people) gets a rule "events are never edited or removed except by the 90-day cleanup"

## Build in steps

1. **Items only, in one friendship**: make, offer, ask, lend, accept, return, the page and the Home notice. Plain (unlocked) first. This is the smallest thing that is useful and proves the model.
2. **Groups and many connections** (`connectionIds`, group-owned, `answer` by any member).
3. **Give** and **time slots** (`place`, `time`).
4. **Supply** (amounts) and **digital** (link to a safebox item).
5. **Locking** of text and picture with the connection keys.
6. Reminders, the `/resources` page, the sound for `resource`.

Each step is shippable on its own and ends with the code, this guide and a test (the same routine as the connection rules).

## Open questions

1. **Money.** Decided for now: **no money** in resources. No price, no payment, no "I owe you", no accounting. Money brings payments, debts, currencies, disputes and legal questions, and would make the feature far more complicated than it is meant to be. A countable `supply` (eggs, tickets, points) stays, because it is only a number the group agrees on. Money can be looked at again later as a separate feature, on top of resources, if it is ever needed.
2. **Reservation vs. ask.** Is "ask" for an `item` the same step as "book a slot", with a date? A simple rule: an `item` asked for **now** is an ask; an `item` asked for **a date** is a booking with an answer from the owner. One mechanism or two?
3. **Sleeping people.** Does a person on my sleep list see my resources? Proposal: no. A sleeper sees nothing new and cannot ask, in the same way as a message from a sleeper is held.
4. **Pictures.** Same as the group picture (a data URL at 256 px) or the media cache of the safebox? A resource wants more than one picture (the drill from two sides). Proposal: one in step 1.
5. **Return of a gift.** Is a `give` ever undone? Proposal: no. The new owner can give it back as a new `give`.
6. **Damage and loss.** A borrower says "it broke". Proposal: a plain `note` event and a closing of the lend as `lost` or `damaged`, with no judgement or amount. The friends sort it out between themselves.
7. **A resource in a friendship that becomes a group** (people added to a friend entry)? Today a friend is not turned into a group; groups are made from scratch. Resources follow that.
8. **Visibility for a friend of a group member.** Never: a resource is only seen by the connections it is offered in.

## Not in the first version

Prices and payment, ratings and trust scores, public or "nearby" resources, resources shared between people who are not friends, recurring bookings, photos of the condition on handing over, and a calendar view (the list of slots is enough).
