# Groups

A group is **a friend with several people in it**. From one member's point of view it is an ordinary entry in the friend list: it sits in a seat, can be put on the sleep list, and is deleted like a friend. It has its own conversation and its own safebox, shared by all members.

Status: built (backend tested in `functions/test/groups.test.ts`, 18 tests; the frontend has not been run yet). Not built: see "Not done yet".

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
- The group gets an entry in **their** list, in a free seat, with the current name, description and picture. If all their seats are taken: 409 and nobody is added (**to be handled later**, see below).
- Their circle is the one their friendship with me lives in (`peerCircleId` of my entry).
- Every member's `members` count is updated, and the new member's app is told to reload (`touchSync(..., "requestsAt")`).
- At most `MAX_GROUP_MEMBERS` (7, like the seven of a circle). Already in the group: 409.
- A new member reads what is said **after** they joined, not the history (each message exists as one copy per member, made at send time).

### Removing a member
- Their entry and their copies of the messages go and they get no more safebox reminders; the others keep the group, the messages (also the ones the removed person wrote) and the safebox.
- Who may remove whom: the maker anybody (not themselves: they leave), a member the people they added, anybody themselves. The group remembers who added whom (`invitedBy` on the group document, shown in the member list as "added by"); when the person who added somebody leaves, that member has no inviter any more. Nobody removes the maker. Planned: any member can *request* a removal that the maker confirms (to be designed).
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

## What a group does not have
A group is not a person: no presence, no mood, no country, no phone/email, no "not verified" warning, no key recovery by a friend (the recovery routes answer 403 for a group), no circle profile. Its picture is the group's own; without one the app shows `icons/friends/group.svg`, never a seat icon.

## In the app
- Add a friend → "A group" → name → the group is made and shown in a seat ("Group · only you" / "Group · N people").
- The profile of the group (`friend-profile`) has the name and description (autosaved), the picture, the list of people with **Remove** (only for the maker) and **Add a friend to the group** (lists my confirmed friends who are not in it).
- Everything else (conversation, safebox, sleep list, delete) is the page of a friend.

## Not done yet
1. **Full seats when adding**: the person is refused (409). Options: a waiting list, a pending entry they accept, or the sleep list.
2. **Pinning of members' keys**: a group has no "did you change phone?" check yet (`friendFingerprints` is empty for a group), so a member's key is trusted when first seen, and members you are not friends with are not verified by you.
3. **Open questions**: who may add and remove (now: anyone adds, the maker and the one who added a member remove), the size limit (now 20), whether joining needs consent or a key, history for new members (now: none).
4. Push and sleep per member, the translations of the new texts (English only), and a check that a group a member is added to opens correctly on their device.
