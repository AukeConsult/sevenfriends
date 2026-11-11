# Groups

A group is **a friend with several people in it**. From one member's point of view it is an ordinary entry in the friend list: it sits in a seat, can be put on the sleep list, and is deleted like a friend. It has its own conversation and its own safebox, shared by all members.

Status: built (backend tested in `functions/test/groups.test.ts` and `group-keys.test.ts`; the frontend is built but has not been run through a build or a test). Not built: see "Not done yet".

## The data

| What | Where |
|---|---|
| The group | `friend-group/{groupId}`: `name`, `description`, `picture` (data URL or null), `createdBy`, `members: { uid: circleId }`, `createdAt` |
| A member's entry | `user-account/{uid}/friend-circle/{circleId}/friends/{groupId}`: `kind: "group"`, `groupId`, `name`, `description`, `groupPictureAt`, `members` (the count), `seat`, `asleep`, `status: "confirmed"`, `linkedUid: null` |
| Messages | one copy per member, same id, `connectionId = groupId` (as between two friends, but no `toUid`) |
| Safebox | `safebox/{groupId}/items` |

The id of the group is the id of every member's entry and the connection id. So the message and safebox code works with a group unchanged, over the list of the *other members* (`connection.peers`, see `conversation.ts`: `connectionOf`, `Peer`). A friendship is simply a connection with one peer.

Each member keeps the group in a circle of the same kind as their friendship with the person who added them (`peerCircleId`).

## What a member can do

| Function | API (under `/circles/:circleId/friends`) | Who |
|---|---|---|
| Make a group | `POST /group` `{ name }` | anyone; takes a seat (max 7, like a friend) |
| Change name, description, picture | `PATCH /:id/group` `{ name?, description?, picture? }` (`picture: null` removes it) | any member |
| See the members | `GET /:id/group/members` → `GroupMember[]` | any member |
| Add a member | `POST /:id/group/members` `{ friendId }` | any member, one of **their own confirmed friends** |
| Remove a member | `DELETE /:id/group/members/:memberUid` | the maker removes anybody; whoever added a member removes that member; anybody removes themselves (`canRemove` in the member list) |
| Leave / delete | `DELETE /:id` | the same as removing myself |
| Sleep list, seat, messages, safebox | the same routes as for a friend | any member |
| Picture | `GET /:id/picture` | any member |

### Making a group
Creates `friend-group/{id}` and my entry in one transaction. Refused with 409 when all 7 seats are taken (a group needs a seat). The name is required.

### Adding a member
- No confirmation from the person: they are added at once.
- The group gets an entry in **their** list, in a free seat, with the current name, description and picture. With all their seats taken it goes on their **sleep list** when they use one (the answer says `{ asleep: true }` and the profile says so); when they do not use a sleep list: 409 "has no free seat and does not use a sleep list" and nobody is added.
- The person gets a push ("Anna added you to Club"); a person who is removed by somebody else gets one too. A message to a group is pushed to every member who has not muted it or put the sender on a sleep list, titled "Anna · Club".
- Their circle is the one their friendship with me lives in (`peerCircleId` of my entry).
- Every member's `members` count is updated, and the new member's app is told to reload (`touchSync(..., "requestsAt")`).
- At most `MAX_GROUP_MEMBERS` (7, like the seven of a circle). Already in the group: 409.
- A new member reads what is said **after** they joined, not the history of the messages (each message exists as one copy per member, made at send time). What is in the **safebox** is shared with them (see "History in the safebox").

### Removing a member
- Their entry and their copies of the messages go and they get no more safebox reminders; the others keep the group, the messages (also the ones the removed person wrote) and the safebox.
- Who may remove whom: the maker anybody (not themselves: they leave), a member the people they added, anybody themselves. The group remembers who added whom (`invitedBy` on the group document, shown in the member list as "added by"); when the person who added somebody leaves, that member has no inviter any more. Nobody removes the owner: the owner leaves, and the next member of the list (the order they joined, `memberOrder` on the group document) becomes the owner (`createdBy`). Planned: any member can *request* a removal that the maker confirms (to be designed).
- **Their items in the group's safebox go too**: every safebox item has an owner (the person who saved it, `addedBy`; an edit by someone else does not change it). When a member is removed or leaves, everything they saved is deleted with its files, previews, attachments and reminders (`deleteItemsOf` in `safebox.ts`). What others saved stays, and so does what others attached to their own items. Links between items (relations) are not looked at: they are locked, so the server cannot tell which items they join.
- The **last** member to go deletes the group, its safebox and the files of the messages (`leaveGroup`).
- Deleting my account does the same for every group I am in (`erase.ts`).

### Changing the group
`updateGroup` writes the group document and copies the name, description and the time the picture changed into every member's entry, so every list shows it. The picture is a data URL (JPEG, PNG or WebP, at most `MAX_PICTURE_BYTES`) kept in the group document; the app asks for it once per version (`pictureAt`), like a friend's picture.

## Keys and locking
Same model as a friendship, over all members (see `docs/design/safebox-encryption.md`):
- `GET .../safebox/keys` answers `BoxKeys`: my keys and `others`, every other person with their name and keys in use (a friendship: one person, and `friend` / `friendUid` as before; a group: `friendUid` is empty and `friend` is empty).
- An item or message is locked with its own key, copied once for every key in use of me and every other member (`recipientsOf(me, keys)`, shared model `keys.ts`). The server checks the copies with `wrapsCover` over the current members: a member who joined or left, or a key that changed meanwhile, gives 409 and the app asks again.
- Locking is on only when **everybody** has a key (`keyStatus` is `both`); otherwise the group works as before (readable by the server) and the Locking page names who has no key. A group of only me has nobody to wait for.
- A new member's key is not used for what was written before they joined (they read from the day they joined); a removed member is no longer locked for.
- Pinned by `functions/test/group-keys.test.ts`.

## History in the safebox
Items in the box are locked for the keys that were there when they were saved. When somebody joins (or a member makes a new key) their keys have no copy. The first member's device that has the group open and a key **does it by itself**: `GET .../safebox/share-todo` lists the items that lack a copy for a key in use of a member (with that device's own copies), the device opens each item's key and locks it again for those keys (`SafeboxService.shareWithMembers`), `POST .../safebox/share` files the copies (accepted only for a member and one of their keys in use; nothing is ever taken away). One member is enough; it is quiet and safe to repeat. The trust that allows this is the one described under "Trust". A member with no key yet gets their copies as soon as they have one and somebody opens the group. Messages are not shared this way: no history.

## Trust
A member is only ever added by a member who has **already accepted that person as a friend, with their keys** (the adder's own friendship, with its check of the friend's keys). So every membership rests on a friendship somebody in the group already trusts, and the others trust the adder: nobody can be put into a group by the server, or by a stranger, and nobody joins by asking. Because of this a group needs no pinning of members' keys of its own, and a member who opens the box locks existing items for a new member's keys without asking anybody (see "History in the safebox"). The same limits as for a friendship stay: the server cannot read anything, and a key that changes for somebody you are not friends with is not asked about.

## What a group does not have
A group is not a person: no presence, no mood, no country, no phone/email, no "not verified" warning, no key recovery by a friend (the recovery routes answer 403 for a group), no circle profile. Its picture is the group's own; without one the app shows `icons/friends/group.svg`, never a seat icon.

## In the app
- Add a friend → "A group" → name → the group is made and shown in a seat ("Group · only you" / "Group · N people").
- **The profile of the group** (`friend-profile`): name and description (autosaved), the picture, a badge for **each member** with their picture and a link to the member's feed, **Add a friend to the group** (lists my confirmed friends who are not in it), the rules for who may remove whom, a note that a new member sees only what is written after they joined, and a **Leave the group** button (in a frame under the button, never a pop-up). The sleep / wake / delete buttons are icons in the header of the page.
- **The feed shows who wrote each message** in a group: the writer's picture (or initials) and name in front of every message that is not mine (`ChatMessage.fromUid`, resolved with `MemberPictureService`, which reads each member's picture once).
- **The sleep list** looks like the front page (the same top, a heading, the seats pill, circles that flow left to right or a list of cards). A group on the list shows "Group · N people". Tapping a friend opens the card with wake, open and profile; tapping an empty part of the page goes back.
- Everything else (conversation, safebox, delete) is the page of a friend.

## Leaving and the database
- **Leave** is `DELETE /:friendId` and runs `leaveGroup`: the member's messages, safebox items (`deleteItemsOf`) and reminders are deleted; the owner role passes to the next person in `memberOrder`; the last one out wipes the group and its box. The remaining members get a push.
- **Reads are small**: a group is read with `groupHead(groupId, fields)` (`getAll` with a field mask), so the picture data URL is not read on every call. The fake Firestore enforces field masks, so a test fails when a field that was not asked for is used. New composite indexes are in `firestore.indexes.json`; deploy them with `firebase deploy --only firestore:indexes`.

## Not done yet
1. **Open questions**: "ask to remove" that the owner confirms (only discussed).
2. **Not checked in the app**: the sleeping list, the notification cards and the friend page header for a group; the app does not clear its local copy of a group a member was removed from.
3. The "did you change phone?" check is only between direct friends; a member's new key in a group is not asked about by the others (see "Trust").
