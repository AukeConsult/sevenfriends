import { DocumentReference, FieldValue, getFirestore } from "firebase-admin/firestore";
import { DecodedIdToken } from "firebase-admin/auth";
import { Request, Response } from "express";
import { DEFAULT_CIRCLE_ID, FRIENDS_SUBCOLLECTION, SAFEBOX_REMINDERS, MAX_FRIENDS, MAX_GROUP_DESCRIPTION, MAX_GROUP_MEMBERS, MAX_NAME_LENGTH } from "./constants";
import { freeSeat, assignMissingSeats } from "./seats";
import { circleCol, groupDoc, messageCol, userFields } from "./paths";
import { nameOf, sendPush } from "./push";
import { settingsOf } from "./models";
import { parsePicture } from "./avatar";
import { GroupMember, MediaRef } from "./models";
import { touchSync } from "./sync";
import { deleteObjects } from "./sf-cache";
import { deleteBox, deleteItemsOf } from "./safebox";
import { text } from "./validation";

/**
 * Groups (design: docs/design/groups.md). A group is the other end of a connection with several people: every member has a friend entry whose id is the
 * id of the group (`kind: "group"`), in a seat of their list like a friend, and the group is `friend-group/{id}` with `members: { uid: circleId }`.
 * Messages and the safebox use the id of the group as the connection id, so they work as they do between two friends, over the list of the other members.
 */

/** Make a group: `{ name }`. It is a friend entry of mine (a seat) with the id of the group, and I am its first member. */
export async function createGroup(req: Request, res: Response): Promise<void> {
  const name = text((req.body ?? {}).name, MAX_NAME_LENGTH);
  if (!name) {
    res.status(400).json({ error: "Give the group a name" });
    return;
  }
  const uid = (res.locals.token as DecodedIdToken).uid;
  const circle = res.locals.circleRef as DocumentReference;
  const col = circle.collection(FRIENDS_SUBCOLLECTION);
  const ref = col.doc();
  await assignMissingSeats(col);
  const made = await getFirestore().runTransaction(async (tx) => {
    const existing = await tx.get(col);
    if (existing.docs.filter((d) => d.data().asleep !== true).length >= MAX_FRIENDS) return false; // a group needs a seat like a friend
    tx.set(groupDoc(ref.id), { name, createdBy: uid, members: { [uid]: circle.id }, memberOrder: [uid], createdAt: FieldValue.serverTimestamp() });
    tx.set(ref, {
      kind: "group",
      groupId: ref.id,
      name,
      nameGiven: true,
      email: null,
      phone: null,
      ownerUid: uid,
      circleId: circle.id,
      connectionId: ref.id,
      peerCircleId: circle.id, // every member has the group in the circle of the same kind
      status: "confirmed",
      seat: freeSeat(existing.docs),
      linkedUid: null,
      signaledUids: [],
      invite: null,
      members: 1,
      createdAt: FieldValue.serverTimestamp(),
    });
    return true;
  });
  if (!made) {
    res.status(409).json({ error: `This circle is full (max ${MAX_FRIENDS} friends)` });
    return;
  }
  res.status(201).json({ id: ref.id });
}

/**
 * Leave a group (deleting it from my list): my entry and my copies of its messages go; the others keep the group, its messages and its safebox.
 * The last member to leave deletes the group: its safebox and the files of the messages go with it.
 */
export async function leaveGroup(uid: string, entryRef: DocumentReference, groupId: string): Promise<void> {
  const mine = await messageCol(uid).where("connectionId", "==", groupId).select("media").get();
  const group = groupDoc(groupId);
  let last = false;
  await getFirestore().runTransaction(async (tx) => {
    const data = (await tx.get(group)).data();
    const members = { ...((data?.members ?? {}) as Record<string, string>) };
    delete members[uid];
    // nobody is "invited by" a person who has left, and the one who left was invited by nobody any more
    const order = orderOf(data ?? {}).filter((m) => m !== uid);
    const invitedBy = Object.fromEntries(Object.entries((data?.invitedBy ?? {}) as Record<string, string>).filter(([member, by]) => member !== uid && by !== uid));
    last = Object.keys(members).length === 0;
    tx.delete(entryRef);
    mine.docs.forEach((d) => tx.delete(d.ref));
    if (last) tx.delete(group);
    else tx.update(group, { members: { ...members }, invitedBy, memberOrder: order, ...(data?.createdBy === uid ? { createdBy: order[0] } : {}) }); // the owner leaves: the next member of the list is the owner
  });
  if (!last) {
    await syncMemberCount(groupId);
    await deleteItemsOf(groupId, uid);
    await dropReminders(groupId, uid);
  }
  if (last) {
    await deleteObjects(mine.docs.flatMap((d) => (d.data().media as MediaRef | undefined) ?? []));
    await deleteBox(groupId);
  }
}

/**
 * Change a group: `{ name?, description?, picture? }` (see `GroupChange`). Any member can. The group document holds the truth (the picture is a data URL in it);
 * every member's friend entry gets a copy of the name, the description and the time the picture changed, so their lists show it at once.
 */
export async function updateGroup(req: Request, res: Response, groupId: string): Promise<void> {
  const uid = (res.locals.token as DecodedIdToken).uid;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const group = groupDoc(groupId);
  const data = (await group.get()).data();
  const members = (data?.members ?? {}) as Record<string, string>;
  if (!data || !(uid in members)) {
    res.status(404).json({ error: "Group not found" });
    return;
  }
  const change: Record<string, unknown> = {};
  const copy: Record<string, unknown> = {};
  if ("name" in body) {
    const name = text(body.name, MAX_NAME_LENGTH);
    if (!name) {
      res.status(400).json({ error: "Give the group a name" });
      return;
    }
    change.name = name;
    copy.name = name;
  }
  if ("description" in body) {
    const description = text(body.description, MAX_GROUP_DESCRIPTION) ?? "";
    change.description = description;
    copy.description = description;
  }
  if ("picture" in body) {
    if (body.picture === null) change.picture = null;
    else {
      const parsed = parsePicture(body.picture);
      if ("error" in parsed) {
        res.status(400).json({ error: parsed.error });
        return;
      }
      change.picture = body.picture;
    }
    copy.groupPictureAt = change.picture === null ? null : new Date().toISOString();
  }
  if (Object.keys(change).length) {
    await group.update(change);
    for (const [memberUid, circleId] of Object.entries(members)) {
      await circleCol(memberUid).doc(circleId).collection(FRIENDS_SUBCOLLECTION).doc(groupId).update(copy);
    }
  }
  res.status(204).end();
}

/** The picture of a group (a data URL), or null. Only a member gets it. */
export async function groupPicture(uid: string, groupId: string): Promise<string | null> {
  const data = (await groupDoc(groupId).get()).data();
  if (!data || !(uid in ((data.members ?? {}) as Record<string, string>))) return null;
  return (data.picture as string | null | undefined) ?? null;
}

/** Every member's entry says how many people the group has. */
async function syncMemberCount(groupId: string): Promise<void> {
  const members = ((await groupDoc(groupId).get()).data()?.members ?? {}) as Record<string, string>;
  const count = Object.keys(members).length;
  for (const [uid, circleId] of Object.entries(members)) {
    await circleCol(uid).doc(circleId).collection(FRIENDS_SUBCOLLECTION).doc(groupId).update({ members: count });
  }
}

/** The members of a group, for a member: who they are, who made it, and which of them are my own friends. */
export async function listGroupMembers(req: Request, res: Response, groupId: string): Promise<void> {
  const uid = (res.locals.token as DecodedIdToken).uid;
  const data = (await groupDoc(groupId).get()).data();
  const members = (data?.members ?? {}) as Record<string, string>;
  if (!data || !(uid in members)) {
    res.status(404).json({ error: "Group not found" });
    return;
  }
  const mine = await (res.locals.circleRef as DocumentReference).collection(FRIENDS_SUBCOLLECTION).where("status", "==", "confirmed").get();
  const out: GroupMember[] = [];
  for (const memberUid of orderOf(data)) {
    const friend = mine.docs.find((d) => d.data().linkedUid === memberUid && d.data().kind !== "group");
    const account = await userFields(memberUid, "displayName");
    out.push({
      uid: memberUid,
      name: memberUid === uid ? ((account?.displayName as string | undefined) ?? "You") : ((friend?.data().name as string | undefined) ?? (account?.displayName as string | undefined) ?? "Someone"),
      you: memberUid === uid,
      creator: data.createdBy === memberUid, // the owner
      friendId: friend?.id ?? null,
      invitedBy: ((data.invitedBy ?? {}) as Record<string, string>)[memberUid] ?? null,
      canRemove: memberUid !== uid && canRemove(data, uid, memberUid),
    });
  }
  res.json(out);
}

/**
 * Add one of MY confirmed friends to the group: `{ friendId }` (my entry for them). The group takes a seat in their list like a friend would; with no free seat it goes
 * on their sleep list when they use one (`{ asleep: true }`), otherwise 409 and nobody is added. They get a push. From now on messages and safebox items are locked for them too; what was said before is not theirs.
 */
export async function addGroupMember(req: Request, res: Response, groupId: string): Promise<void> {
  const uid = (res.locals.token as DecodedIdToken).uid;
  const group = groupDoc(groupId);
  const data = (await group.get()).data();
  const members = (data?.members ?? {}) as Record<string, string>;
  if (!data || !(uid in members)) {
    res.status(404).json({ error: "Group not found" });
    return;
  }
  const mine = (await (res.locals.circleRef as DocumentReference).collection(FRIENDS_SUBCOLLECTION).doc(String((req.body ?? {}).friendId ?? "")).get()).data();
  const newUid = mine?.linkedUid as string | undefined;
  if (!mine || mine.kind === "group" || mine.status !== "confirmed" || !newUid) {
    res.status(400).json({ error: "Pick one of your confirmed friends" });
    return;
  }
  if (newUid in members) {
    res.status(409).json({ error: "They are in the group already" });
    return;
  }
  if (Object.keys(members).length >= MAX_GROUP_MEMBERS) {
    res.status(409).json({ error: `A group has at most ${MAX_GROUP_MEMBERS} people` });
    return;
  }
  const circleId = (mine.peerCircleId as string | undefined) ?? DEFAULT_CIRCLE_ID; // the circle this friend keeps our friendship in
  const col = circleCol(newUid).doc(circleId).collection(FRIENDS_SUBCOLLECTION);
  await assignMissingSeats(col);
  const sleepListOn = settingsOf((await circleCol(newUid).doc(circleId).get()).data()?.settings).sleepList !== false; // on unless they switched it off
  const mineEntry = (await (res.locals.circleRef as DocumentReference).collection(FRIENDS_SUBCOLLECTION).doc(groupId).get()).data() ?? {};
  const added = await getFirestore().runTransaction(async (tx): Promise<"ok" | "asleep" | "full"> => {
    const existing = await tx.get(col);
    const current = (await tx.get(group)).data() ?? data; // read again here: the order of the list is written back whole
    const full = existing.docs.filter((d) => d.data().asleep !== true).length >= MAX_FRIENDS;
    if (full && !sleepListOn) return "full";
    tx.set(col.doc(groupId), {
      kind: "group",
      groupId,
      name: data.name,
      nameGiven: true,
      description: (mineEntry.description as string | undefined) ?? "",
      groupPictureAt: (mineEntry.groupPictureAt as string | null | undefined) ?? null,
      email: null,
      phone: null,
      ownerUid: newUid,
      circleId,
      connectionId: groupId,
      peerCircleId: circleId,
      status: "confirmed",
      ...(full ? { asleep: true, seat: null } : { seat: freeSeat(existing.docs) }), // no free seat: it is on their sleep list, like a friend whose list is full
      linkedUid: null,
      signaledUids: [],
      invite: null,
      members: Object.keys(members).length + 1,
      createdAt: FieldValue.serverTimestamp(),
    });
    tx.update(group, { [`members.${newUid}`]: circleId, [`invitedBy.${newUid}`]: uid, memberOrder: [...orderOf(current), newUid] });
    return full ? "asleep" : "ok";
  });
  if (added === "full") {
    res.status(409).json({ error: `${mine.name ?? "This friend"} has no free seat and does not use a sleep list, so the group cannot be added to their list. They can free a seat first.` });
    return;
  }
  await syncMemberCount(groupId);
  await touchSync(newUid, "requestsAt");
  const adder = await nameOf(uid, res.locals.token as DecodedIdToken, (res.locals.circleRef as DocumentReference).id);
  await sendPush(newUid, { circleId, id: `group-${groupId}-added-${newUid}`, title: `${adder} added you to ${data.name}`, body: added === "asleep" ? "It is on your sleep list: you have no free seat." : "", url: `/friends/${groupId}`, kind: "request" });
  res.json({ asleep: added === "asleep" });
}

/** Remove a member: `memberUid` is me (leave), or somebody else: the maker of the group can remove anybody, and a person can remove the members they invited (see `canRemove`). Their copies of the messages go; the others keep everything. */
export async function removeGroupMember(req: Request, res: Response, groupId: string, memberUid: string): Promise<void> {
  const uid = (res.locals.token as DecodedIdToken).uid;
  const data = (await groupDoc(groupId).get()).data();
  const members = (data?.members ?? {}) as Record<string, string>;
  if (!data || !(uid in members) || !(memberUid in members)) {
    res.status(404).json({ error: "Group not found" });
    return;
  }
  if (!canRemove(data, uid, memberUid)) {
    res.status(403).json({ error: "Only the owner of the group, or the person who added this member, can remove them. Nobody removes the owner: the owner leaves." });
    return;
  }
  const ref = circleCol(memberUid).doc(members[memberUid]).collection(FRIENDS_SUBCOLLECTION).doc(groupId);
  await leaveGroup(memberUid, ref, groupId);
  await touchSync(memberUid, "requestsAt");
  if (memberUid !== uid) {
    const by = await nameOf(uid, res.locals.token as DecodedIdToken, (res.locals.circleRef as DocumentReference).id);
    await sendPush(memberUid, { circleId: members[memberUid], id: `group-${groupId}-removed-${memberUid}`, title: `${by} removed you from ${data.name}`, body: "The messages and files of the group are no longer on your side.", url: "/friends", kind: "removed" });
  }
  res.status(204).end();
}

/** A person who has left gets no more reminders of the group's safebox items (a reminder keeps the people it is for). */
async function dropReminders(groupId: string, uid: string): Promise<void> {
  const due = await getFirestore().collection(SAFEBOX_REMINDERS).where("connectionId", "==", groupId).get();
  for (const doc of due.docs) {
    const targets = ((doc.data().targets ?? []) as { uid: string }[]).filter((t) => t.uid !== uid);
    if (targets.length) await doc.ref.update({ targets });
    else await doc.ref.delete();
  }
}

/** The members in the order they joined (the owner first); a group made before the order was kept lists them by id. */
const orderOf = (group: FirebaseFirestore.DocumentData): string[] => {
  const members = Object.keys((group.members ?? {}) as Record<string, string>);
  return [...new Set([...((group.memberOrder ?? []) as string[]), ...members])].filter((m) => members.includes(m));
};

/** May `me` remove `memberUid`? Anybody may leave; the owner removes anybody; whoever added a member removes that member. Nobody removes the owner: the owner leaves, and the next member of the list takes over. */
const canRemove = (group: FirebaseFirestore.DocumentData, me: string, memberUid: string): boolean =>
  memberUid === me || (memberUid !== group.createdBy && (group.createdBy === me || (group.invitedBy as Record<string, string> | undefined)?.[memberUid] === me));
