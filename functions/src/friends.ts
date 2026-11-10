import { Router } from "express";
import { DecodedIdToken } from "firebase-admin/auth";
import { DocumentReference, FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import { asyncHandler } from "./auth";
import { conversationRouter } from "./conversation";
import { recoveryRouter } from "./recovery";
import { deleteBox, safeboxRouter } from "./safebox";
import {
  DEFAULT_CIRCLE_ID,
  FRIENDS_SUBCOLLECTION,
  MAX_FRIENDS,
  MAX_INVITES_PER_DAY,
  MAX_REQUEST_MESSAGE,
  circleIdOf,
  circleTypeOf,
} from "./constants";
import { inviteCodeOf } from "./invite";
import { invitesSentToday, queueInvite } from "./outbox";
import { Friend, FriendInvite, MediaRef, FriendStatus, NewFriend, ProfilePicture, profileColorKey, pronounKey } from "./models";
import { circleProfileOf, friendNameOf } from "./circle-profile";
import { circleCol, friendRequestCol, messageCol, missingIndex, userFields } from "./paths";
import { avatarOf, readAvatar } from "./avatar";
import { deleteObjects } from "./sf-cache";
import { tellFriendAsleep, touchSync } from "./sync";
import { nameOf, sendPush } from "./push";
import { findAccounts, signalRefsOf, writeSignal } from "./signals";
import { addGroupMember, createGroup, groupPicture, leaveGroup, listGroupMembers, removeGroupMember, updateGroup } from "./groups";
import { assignMissingSeats, freeSeat, seatOf, stampOwner } from "./seats";
import {
  EMAIL_RE,
  PHONE_RE,
  unverifiedDetails,
  phoneKey,
  presenceOf,
  text,
} from "./validation";

function parseFriend(body: Record<string, unknown>): { data?: NewFriend; nameGiven?: boolean; error?: string } {
  const givenName = text(body.name, 100);
  const email = text(body.email, 200)?.toLowerCase() ?? null;
  const phone = text(body.phone, 25);
  const message = text(body.message, MAX_REQUEST_MESSAGE + 1);

  if (message && message.length > MAX_REQUEST_MESSAGE) {
    return { error: `The message can be at most ${MAX_REQUEST_MESSAGE} characters` };
  }
  if (email && !EMAIL_RE.test(email)) return { error: "Email is not valid" };
  if (phone && !PHONE_RE.test(phone)) return { error: "Phone number is not valid" };
  // Only an email or a phone number can find your friend, so one of them is needed for the request to ever arrive.
  if (!email && !phone) {
    return { error: "Add an email or a phone number, so your friend can be found" };
  }
  // the name is optional: without it the email or phone number is shown, until the friend confirms (then their own name is shown)
  const name = givenName ?? email ?? phone!;
  return { data: { name, email, phone, message }, nameGiven: Boolean(givenName) };
}

function toJson(doc: FirebaseFirestore.DocumentSnapshot): Friend {
  const data = doc.data() ?? {};
  return {
    id: doc.id,
    circleId: circleIdOf(data),
    name: data.name,
    email: data.email ?? null,
    phone: data.phone ?? null,
    status: (["confirmed", "rejected"].includes(data.status) ? data.status : "pending") as FriendStatus,
    invited: Boolean(data.linkedUid), // true = the friend has a Seven Friends account and got a request
    waiting: Boolean(data.waitingForSeat), // true = their list is full: I am on their waiting list
    asleep: data.asleep === true, // true = on my sleep list (no seat)
    seat: seatOf(data),
    sleepsMe: data.theyAsleep === true, // true = this friend has ME on their sleep list (copied here when they put me to sleep or wake me)
    incoming: Boolean(data.incomingRequestId), // true = THEY invited ME; I can confirm
    requestId: (data.incomingRequestId as string | undefined) ?? null,
    createdAt: data.createdAt instanceof Timestamp ? data.createdAt.toDate().toISOString() : null,
    message: (data.message as string | null | undefined) ?? null,
    invite: inviteOf(data),
    lastSpokenAt: iso(data.lastMessageAt),
    country: null, // filled in by withUnverified (confirmed friends only)
    mood: null, // filled in by withUnverified (confirmed friends only)
    moodMessage: null,
    pronoun: null,
    presence: "offline", // filled in by withUnverified (confirmed friends only)
    icon: null, // filled in by withUnverified (confirmed friends only)
    color: null,
    pictureAt: null,
    pictureId: null,
    unverified: [], // filled in by withUnverified (needs a look at the other accounts)
    ...(data.kind === "group" ? { group: true, members: (data.members as number | undefined) ?? 1, description: (data.description as string | undefined) ?? "", pictureAt: (data.groupPictureAt as string | undefined) ?? null } : {}),
  };
}

/**
 * Tells me when the friend I am connected to (or have just added) has not verified who they are: they have an
 * account, but neither a verified email nor a confirmed phone. They are still reachable, but I should know.
 */
/** For conversations from before the friendship remembered it: the time of the newest message of the feed (or null). */
async function lastSpoken(uid: string, connectionId: string): Promise<string | null> {
  // the newest message only (index messages(connectionId, time desc)), not the whole feed
  const feed = messageCol(uid).where("connectionId", "==", connectionId);
  try {
    const time = (await feed.orderBy("time", "desc").limit(1).select("time").get()).docs[0]?.get("time");
    return time instanceof Timestamp ? time.toDate().toISOString() : null;
  } catch (err) {
    if (!missingIndex(err)) throw err; // the index is not built yet: the old way (slower, the same answer)
    const times = (await feed.select("time").get()).docs.map((d) => d.get("time")).filter((t): t is Timestamp => t instanceof Timestamp);
    return times.length ? new Date(Math.max(...times.map((t) => t.toMillis()))).toISOString() : null;
  }
}

async function withUnverified(friend: Friend, entry: FirebaseFirestore.DocumentData | undefined, uid: string): Promise<Friend> {
  if (!entry || friend.status === "rejected") return friend;
  const other = (entry.linkedUid as string | null | undefined) ?? (entry.signaledUids as string[] | undefined)?.[0];
  if (!other) return friend;
  // only what is shown here: the verification, the mood, the presence and the picture of the other person
  const account = await userFields(other, "emailLower", "emailVerified", "phoneKey", "verifiedPhone", "country", "mood", "moodMessage", "pronoun", "presence", "lastSeenAt", "profileIcon", "profileColor", "profilePictureAt", "avatarObjectId", "displayName");
  const unverified = account && entry.trusted !== true ? unverifiedDetails(account) : []; // "this is really them" (trusted) hides the warning
  // how the other person shows in the circle I am in (their name, colour and mood there): the circle their side of the friendship lives in
  const peerCircle = (entry.peerCircleId as string | undefined) ?? DEFAULT_CIRCLE_ID;
  const profile = circleProfileOf(peerCircle, peerCircle === DEFAULT_CIRCLE_ID ? undefined : (await circleCol(other).doc(peerCircle).get()).data(), account ?? {});
  const picture = await avatarOf(other, peerCircle); // the picture they show in that circle
  // the mood is for confirmed friends only
  const mood =
    friend.status === "confirmed" && account
      ? {
          country: (account.country as string | null | undefined) ?? null,
          mood: profile.mood,
          moodMessage: profile.moodMessage,
          pronoun: pronounKey(account.pronoun),
          presence: presenceOf(account),
          icon: profile.icon,
          color: profile.color,
          pictureAt: iso(picture.at),
          pictureId: picture.id,
        }
      : { country: null, mood: null, moodMessage: null, pronoun: null, presence: "offline" as const, icon: null, color: null, pictureAt: null, pictureId: null };
  // I did not give a name: a confirmed friend is shown by the name of their account
  // the real name of the other person, always once they are connected (see `friendNameOf`)
  const name = friendNameOf(entry, friend.status, profile.name, account?.displayName as string | undefined, friend.name);
  const lastSpokenAt = friend.lastSpokenAt ?? (friend.status === "confirmed" ? await lastSpoken(uid, friend.id) : null);
  return { ...friend, name, ...mood, lastSpokenAt, ...(unverified.length ? { unverified } : {}) };
}

const iso = (t: unknown) => (t instanceof Timestamp ? t.toDate().toISOString() : null);

function inviteOf(data: FirebaseFirestore.DocumentData): FriendInvite | null {
  const invite = data.invite as { to: string; sentAt?: unknown } | null | undefined;
  if (!invite || data.linkedUid) return null; // once the friend has an account, no invitation is needed
  return { to: invite.to, sentAt: iso(invite.sentAt) };
}

const uidOfRequest = (res: { locals: Record<string, unknown> }) => (res.locals.token as DecodedIdToken).uid;

const friendCol = (res: { locals: Record<string, unknown> }) =>
  (res.locals.circleRef as DocumentReference).collection(FRIENDS_SUBCOLLECTION);

// Mounted by circles.ts under /:circleId/friends (auth + circle lookup already done)
export const friendsRouter = Router({ mergeParams: true });

// The message feed of a connection: /circles/:circleId/friends/:friendId/messages
friendsRouter.use("/:friendId/messages", conversationRouter);
friendsRouter.use("/:friendId/safebox", safeboxRouter);
// recovery by a friend is between two people: not for a group
friendsRouter.use(
  "/:friendId/recovery",
  (req, res, next) => {
    friendCol(res)
      .doc(req.params.friendId)
      .get()
      .then((entry) => {
        if (entry.data()?.kind === "group") res.status(403).json({ error: "A group has no recovery by a friend" });
        else next();
      })
      .catch(next);
  },
  recoveryRouter,
);

/** List the friends in a circle. */
friendsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const snap = await friendCol(res).orderBy("createdAt", "asc").get();
    await stampOwner(snap.docs, uidOfRequest(res));
    // every friend in a seat has a seat number: older entries get theirs now (and keep it)
    const seats = await assignMissingSeats(friendCol(res));
    const friends = await Promise.all(
      snap.docs.map((d) => withUnverified({ ...toJson(d), seat: seats.get(d.id) ?? null }, d.data(), uidOfRequest(res))),
    );
    res.json({ friends, max: MAX_FRIENDS });
  }),
);

/** What a person in each circle is called (for the messages of the server). */
const ONE_PERSON: Record<string, string> = { default: "friend", buddies: "buddy", work: "contact", family: "family member" };

/** Make a group instead of adding a person: `{ name }` (see groups.ts). It sits in a seat of the circle like a friend. */
friendsRouter.post("/group", asyncHandler(async (req, res) => createGroup(req, res)));
/** Change a group (name, description, picture): any member. */
friendsRouter.patch("/:friendId/group", asyncHandler(async (req, res) => updateGroup(req, res, req.params.friendId)));
friendsRouter.get("/:friendId/group/members", asyncHandler(async (req, res) => listGroupMembers(req, res, req.params.friendId)));
friendsRouter.post("/:friendId/group/members", asyncHandler(async (req, res) => addGroupMember(req, res, req.params.friendId)));
friendsRouter.delete("/:friendId/group/members/:memberUid", asyncHandler(async (req, res) => removeGroupMember(req, res, req.params.friendId, req.params.memberUid)));

/** Add a friend to the circle (max 7 per circle). */
friendsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const { data, nameGiven, error } = parseFriend(req.body ?? {});
    if (!data) {
      res.status(400).json({ error });
      return;
    }

    // The request stays ONLY in my list. It reaches the other person when THEY run their check
    // (Home / Friends / Pending), which matches their VERIFIED email or phone number against it.
    const keys = { phoneKey: phoneKey(data.phone) };
    // not myself: my own email or phone number (from the login, or on my account) cannot be added as a friend
    const token = res.locals.token as DecodedIdToken;
    const mine = await userFields(token.uid, "emailLower", "phoneKey");
    const myEmails = [token.email, mine?.emailLower].filter(Boolean).map((e) => String(e).toLowerCase());
    const myPhones = [phoneKey(token.phone_number), mine?.phoneKey].filter(Boolean);
    if ((data.email && myEmails.includes(data.email.toLowerCase())) || (keys.phoneKey && myPhones.includes(keys.phoneKey))) {
      res.status(400).json({ error: "That is you. Add the email or phone number of a friend." });
      return;
    }
    // Does the friend already have an account? Then their frontend gets a ping (a signal) to run its search.
    const accounts = await findAccounts(data.email, keys.phoneKey, (res.locals.token as DecodedIdToken).uid);

    const col = friendCol(res);
    // already in this circle (same email, same phone number, or the same person's account)? Then say so, and send nothing
    const sameKey = (d: FirebaseFirestore.DocumentData) =>
      (data.email && String(d.email ?? "").toLowerCase() === data.email.toLowerCase()) ||
      (keys.phoneKey && d.phoneKey === keys.phoneKey) ||
      (d.linkedUid && accounts.includes(d.linkedUid as string));
    const already = (await col.get()).docs.map((d) => d.data()).find((d) => d.status !== "rejected" && sameKey(d));
    if (already) {
      const who = (already.name as string | undefined) || data.email || "This person";
      res.status(409).json({
        error: already.status === "confirmed" ? `${who} is already your ${ONE_PERSON[(res.locals.circleRef as DocumentReference).id] ?? "friend"}.` : `You have already added ${who}: the request waits for them.`,
      });
      return;
    }
    const ref = col.doc();
    await assignMissingSeats(col); // friends from before the seat numbers get theirs first, so the new friend takes a really free seat
    const added = await getFirestore().runTransaction(async (tx) => {
      const existing = await tx.get(col);
      if (existing.docs.filter((d) => d.data().asleep !== true).length >= MAX_FRIENDS) return false; // friends on the sleep list have no seat
      tx.set(ref, {
        ...data,
        ...keys,
        ownerUid: uidOfRequest(res), // whose list this entry is in: the app listens to all its own entries across the circles with this field
        circleId: (res.locals.circleRef as DocumentReference).id, // my circle
        connectionId: ref.id, // one id for the whole connection: both lists and the request use it
        peerCircleId: (res.locals.circleRef as DocumentReference).id, // where the other person's entry will live: the circle of the same kind
        nameGiven, // false = the name shown is the email / phone I typed
        status: "pending" as FriendStatus,
        seat: freeSeat(existing.docs),
        linkedUid: null, // set when the other person's check finds this entry
        signaledUids: accounts, // who got a ping for this entry (removed again if the entry is deleted)
        // nobody has an account for this email / phone yet: a friend added by EMAIL can be invited by email, once I confirm
        // the address (a friend added only by phone number cannot: texts are only used for login codes)
        invite: accounts.length || !data.email ? null : { to: data.email, sentAt: null },
        createdAt: FieldValue.serverTimestamp(),
      });
      for (const account of accounts) writeSignal(tx, account, ref.id, (res.locals.circleRef as DocumentReference).id);
      return true;
    });

    if (!added) {
      res.status(409).json({ error: `This circle is full (max ${MAX_FRIENDS} friends)` });
      return;
    }
    if (accounts.length) {
      // the people who already have an account hear about it at once (their devices), and find the request when they open the app
      const myCircle = (res.locals.circleRef as DocumentReference).id;
      const fromName = await nameOf((res.locals.token as DecodedIdToken).uid, res.locals.token as DecodedIdToken, myCircle);
      for (const account of accounts) {
        await sendPush(account, { circleId: myCircle, id: `request-${ref.id}`, title: `${fromName} wants to be your friend`, body: data.message ?? "Open Seven Friends to answer.", url: "/", kind: "request" });
      }
    }
    const saved = await ref.get();
    res.status(201).json({ ...(await withUnverified(toJson(saved), saved.data(), (res.locals.token as DecodedIdToken).uid)), onApp: accounts.length > 0 });
  }),
);

/** "This is really them": I confirm an unverified friend myself, the warning goes away (`{ trusted: true }`; `false` brings it back). */
friendsRouter.post(
  "/:friendId/trust",
  asyncHandler(async (req, res) => {
    const trusted = (req.body ?? {}).trusted;
    if (typeof trusted !== "boolean") {
      res.status(400).json({ error: "trusted must be true or false" });
      return;
    }
    const ref = friendCol(res).doc(req.params.friendId);
    if (!(await ref.get()).exists) {
      res.status(404).json({ error: "Friend not found" });
      return;
    }
    await ref.update({ trusted });
    const saved = await ref.get();
    res.json(await withUnverified(toJson(saved), saved.data(), uidOfRequest(res)));
  }),
);

/**
 * Put a friend to sleep or wake them up: `{ asleep: true | false }`. A sleeping friend has no seat (the seat is free for somebody
 * else, also for a request that waits for one), but the connection, the conversation and its files are kept. Waking needs a free seat.
 */
friendsRouter.post(
  "/:friendId/sleep",
  asyncHandler(async (req, res) => {
    const asleep = (req.body ?? {}).asleep;
    if (typeof asleep !== "boolean") {
      res.status(400).json({ error: "asleep must be true or false" });
      return;
    }
    const col = friendCol(res);
    const ref = col.doc(req.params.friendId);
    await assignMissingSeats(col);
    const result = await getFirestore().runTransaction(async (tx) => {
      const all = await tx.get(col);
      const entry = all.docs.find((d) => d.id === ref.id);
      if (!entry) return "missing" as const;
      if ((entry.data().asleep === true) === asleep) return "ok" as const; // nothing to change
      if (!asleep && all.docs.filter((d) => d.data().asleep !== true).length >= MAX_FRIENDS) return "full" as const;
      // the friend's own entry (same id) is told: `theyAsleep` (their app listens to its list and shows it at once)
      const linked = entry.data().linkedUid as string | null | undefined;
      const theirs = linked
        ? circleCol(linked).doc((entry.data().peerCircleId as string | undefined) ?? DEFAULT_CIRCLE_ID).collection(FRIENDS_SUBCOLLECTION).doc(ref.id)
        : null;
      const theirsExists = theirs ? (await tx.get(theirs)).exists : false;
      // asleep: the seat is free for somebody else; awake again: the lowest free seat
      tx.update(ref, { asleep, seat: asleep ? null : freeSeat(all.docs.filter((d) => d.id !== ref.id)) });
      if (theirs && theirsExists) tellFriendAsleep(tx, theirs, asleep);
      return "ok" as const;
    });
    if (result === "missing") {
      res.status(404).json({ error: "Friend not found" });
      return;
    }
    if (result === "full") {
      res.status(409).json({ error: "All your seats are taken. Free a seat first." });
      return;
    }
    const saved = await ref.get();
    res.json(await withUnverified(toJson(saved), saved.data(), uidOfRequest(res)));
  }),
);

/**
 * Move a friend to another seat: `{ seat: 1-7 }`. A free seat is simply taken; a seat that another friend sits in is swapped
 * (that friend gets the seat this one had). Only friends in a seat (not the sleep list) can be moved.
 */
friendsRouter.post(
  "/:friendId/seat",
  asyncHandler(async (req, res) => {
    const seat = (req.body ?? {}).seat;
    if (!Number.isInteger(seat) || seat < 1 || seat > MAX_FRIENDS) {
      res.status(400).json({ error: `The seat is a number from 1 to ${MAX_FRIENDS}` });
      return;
    }
    const col = friendCol(res);
    await assignMissingSeats(col);
    const result = await getFirestore().runTransaction(async (tx) => {
      const all = await tx.get(col);
      const entry = all.docs.find((d) => d.id === req.params.friendId);
      if (!entry) return "missing" as const;
      if (entry.data().asleep === true) return "asleep" as const;
      const other = all.docs.find((d) => d.id !== entry.id && seatOf(d.data()) === seat);
      const mine = seatOf(entry.data());
      if (mine === seat) return "ok" as const;
      tx.update(entry.ref, { seat });
      if (other) tx.update(other.ref, { seat: mine ?? freeSeat(all.docs.filter((d) => d.id !== other.id && d.id !== entry.id)) });
      return "ok" as const;
    });
    if (result === "missing") {
      res.status(404).json({ error: "Friend not found" });
      return;
    }
    if (result === "asleep") {
      res.status(409).json({ error: "A friend on the sleep list has no seat. Wake them up first." });
      return;
    }
    res.json({ seat });
  }),
);

/** The uploaded picture of a confirmed friend (a data URL), or null when there is none. The list only says WHEN it changed (`pictureAt`). */
friendsRouter.get(
  "/:friendId/picture",
  asyncHandler(async (req, res) => {
    const entry = (await friendCol(res).doc(req.params.friendId).get()).data();
    if (entry?.kind === "group") {
      res.json({ image: await groupPicture((res.locals.token as DecodedIdToken).uid, req.params.friendId) } satisfies ProfilePicture);
      return;
    }
    if (!entry || entry.status !== "confirmed" || !entry.linkedUid) {
      res.status(404).json({ error: "Friend not found" });
      return;
    }
    res.json({ image: await readAvatar(entry.linkedUid as string, (entry.peerCircleId as string | undefined) ?? DEFAULT_CIRCLE_ID) } satisfies ProfilePicture);
  }),
);

/**
 * Send the invitation to a friend who has no account yet (the person has confirmed the address on the
 * verify page first). The email goes through the `mail` outbox (see outbox.ts).
 * It is sent once per friend, at most MAX_INVITES_PER_DAY per person per day, and never when the
 * friend has an account by now (they get the request in the app instead).
 */
friendsRouter.post(
  "/:friendId/invite",
  asyncHandler(async (req, res) => {
    const token = res.locals.token as DecodedIdToken;
    const ref = friendCol(res).doc(req.params.friendId);
    const first = (await ref.get()).data();
    if (!first) {
      res.status(404).json({ error: "Friend not found" });
      return;
    }
    const invite = first.invite as { to: string; sentAt?: unknown } | null | undefined;
    if (!invite || first.linkedUid) {
      res.status(409).json({ error: "This friend does not need an invitation" });
      return;
    }
    if (invite.sentAt) {
      res.status(409).json({ error: "This friend has been invited already" });
      return;
    }
    if (await findAccounts(first.email ?? null, first.phoneKey ?? null, token.uid).then((a) => a.length)) {
      res.status(409).json({ error: "Your friend is on Seven Friends already: they get the request in the app" });
      return;
    }
    if ((await invitesSentToday(token.uid)) >= MAX_INVITES_PER_DAY) {
      res.status(429).json({ error: "You have sent many invitations today. Try again tomorrow." });
      return;
    }
    const [fromName, code] = await Promise.all([nameOf(token.uid, token, (res.locals.circleRef as DocumentReference).id), inviteCodeOf(token.uid)]);

    const sent = await getFirestore().runTransaction(async (tx) => {
      const entry = (await tx.get(ref)).data();
      if (!entry?.invite || entry.invite.sentAt) return null; // changed meanwhile
      queueInvite(tx, {
        fromUid: token.uid,
        fromName,
        code,
        circle: circleTypeOf((res.locals.circleRef as DocumentReference).id),
        to: entry.invite.to,
        message: (entry.message as string | null | undefined) ?? null,
      });
      tx.update(ref, { invite: { ...entry.invite, sentAt: FieldValue.serverTimestamp() } });
      return true;
    });
    if (!sent) {
      res.status(409).json({ error: "This friend has been invited already" });
      return;
    }
    res.json(toJson(await ref.get()));
  }),
);

/**
 * Close a friendship. Everything the two share is wiped, for BOTH people, in ONE transaction:
 * both entries (they share the same id), the request, the pings that were not handled yet and the
 * whole message feed. Either all of it goes or none of it.
 */
friendsRouter.delete(
  "/:friendId",
  asyncHandler(async (req, res) => {
    const uid = (res.locals.token as DecodedIdToken).uid;
    const id = req.params.friendId;
    const ref = friendCol(res).doc(id);

    // a group: deleting it from my list is leaving it (the others keep it), see groups.ts
    const entryData = (await ref.get()).data();
    if (entryData?.kind === "group") {
      await leaveGroup(uid, ref, id);
      await touchSync(uid, "requestsAt");
      res.status(204).end();
      return;
    }

    // The files of the conversation go FIRST, before the transaction: if the database delete fails they are wiped anyway.
    const before = (await ref.get()).data();
    if (before) {
      const people = before.linkedUid ? [uid, before.linkedUid as string] : [uid];
      const feeds = await Promise.all(people.map((p) => messageCol(p).where("connectionId", "==", id).select("media").get()));
      await deleteObjects(feeds.flatMap((feed) => feed.docs.flatMap((d) => (d.data().media as MediaRef | undefined) ?? [])));
    }

    let endedWith: string | null = null; // a confirmed friend, who is told
    let files: MediaRef[] = []; // files of messages that arrived while the transaction was being prepared (a second sweep)
    await getFirestore().runTransaction(async (tx) => {
      endedWith = null;
      files = [];
      // ---- reads first ----
      const data = (await tx.get(ref)).data();
      if (!data) return; // already gone
      if (data.status === "confirmed" && data.linkedUid) endedWith = data.linkedUid as string;
      const people = data.linkedUid ? [uid, data.linkedUid as string] : [uid];
      const feeds = await Promise.all(people.map((p) => tx.get(messageCol(p).where("connectionId", "==", id).select("media"))));

      // ---- writes ----
      tx.delete(ref);
      tx.delete(friendRequestCol(uid).doc(id)); // a request I received for this connection
      signalRefsOf(id, data.signaledUids).forEach((r) => tx.delete(r)); // pings that were not handled yet
      if (data.linkedUid) {
        tx.delete(friendRequestCol(data.linkedUid).doc(id)); // a request I sent for it
        tx.delete(
          circleCol(data.linkedUid)
            .doc(data.peerCircleId ?? DEFAULT_CIRCLE_ID)
            .collection(FRIENDS_SUBCOLLECTION)
            .doc(id), // the other person's entry (same id)
        );
      }
      feeds.forEach((feed) => feed.docs.forEach((d) => tx.delete(d.ref))); // its message feed, on both sides
      files = feeds.flatMap((feed) => feed.docs.flatMap((d) => (d.data().media as MediaRef | undefined) ?? []));
    });
    await deleteObjects(files);
    await deleteBox(id); // the files the two shared in their safebox go too
    // the other person may have my request on their Home: their devices drop it at once (a request I received is gone from my own devices too)
    await Promise.all([before?.linkedUid ? touchSync(before.linkedUid as string, "requestsAt") : undefined, touchSync(uid, "requestsAt")]);
    if (endedWith) {
      const name = await nameOf(uid, res.locals.token as DecodedIdToken, circleIdOf(before));
      await sendPush(endedWith, { circleId: (before?.peerCircleId as string | undefined) ?? DEFAULT_CIRCLE_ID, id: `removed-${id}`, title: `${name} removed the friendship`, body: "The conversation is deleted for both of you.", url: "/friends", kind: "removed" });
    }
    res.status(204).end();
  }),
);
