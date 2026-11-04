import { Router } from "express";
import { DecodedIdToken } from "firebase-admin/auth";
import { DocumentReference, FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import { asyncHandler } from "./auth";
import { conversationRouter } from "./conversation";
import {
  DEFAULT_CIRCLE_ID,
  FRIENDS_SUBCOLLECTION,
  MAX_FRIENDS,
  MAX_INVITES_PER_DAY,
  MAX_REQUEST_MESSAGE,
} from "./constants";
import { invitesSentToday, queueInvite } from "./outbox";
import { Friend, FriendInvite, MediaRef, FriendStatus, NewFriend, ProfilePicture, Socials } from "./models";
import { circleCol, friendRequestCol, messageCol, userDoc } from "./paths";
import { readAvatar } from "./avatar";
import { deleteObjects } from "./sf-cache";
import { tellFriendAsleep } from "./sync";
import { nameOf, sendPush } from "./push";
import { findAccounts, signalRefsOf, writeSignal } from "./signals";
import {
  EMAIL_RE,
  PHONE_RE,
  SOCIAL_NETWORKS,
  unverifiedDetails,
  parseSocials,
  phoneKey,
  presenceOf,
  text,
} from "./validation";

function parseFriend(body: Record<string, unknown>): { data?: NewFriend; nameGiven?: boolean; error?: string } {
  const givenName = text(body.name, 100);
  const email = text(body.email, 200)?.toLowerCase() ?? null;
  const phone = text(body.phone, 25);
  const socials = parseSocials(body);
  const message = text(body.message, MAX_REQUEST_MESSAGE + 1);

  if (message && message.length > MAX_REQUEST_MESSAGE) {
    return { error: `The message can be at most ${MAX_REQUEST_MESSAGE} characters` };
  }
  if (email && !EMAIL_RE.test(email)) return { error: "Email is not valid" };
  if (phone && !PHONE_RE.test(phone)) return { error: "Phone number is not valid" };
  // Only an email or a phone number can find your friend (social accounts are extra contact info),
  // so one of them is needed for the request to ever arrive.
  if (!email && !phone) {
    return { error: "Add an email or a phone number, so your friend can be found" };
  }
  // the name is optional: without it the email or phone number is shown, until the friend confirms (then their own name is shown)
  const name = givenName ?? email ?? phone!;
  return { data: { name, email, phone, message, ...socials }, nameGiven: Boolean(givenName) };
}

function toJson(doc: FirebaseFirestore.DocumentSnapshot): Friend {
  const data = doc.data() ?? {};
  return {
    id: doc.id,
    name: data.name,
    email: data.email ?? null,
    phone: data.phone ?? null,
    ...(Object.fromEntries(SOCIAL_NETWORKS.map((n) => [n, data[n] ?? null])) as Socials),
    status: (["confirmed", "rejected"].includes(data.status) ? data.status : "pending") as FriendStatus,
    invited: Boolean(data.linkedUid), // true = the friend has a Seven Friends account and got a request
    waiting: Boolean(data.waitingForSeat), // true = their list is full: I am on their waiting list
    asleep: data.asleep === true, // true = on my sleep list (no seat)
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
    presence: "offline", // filled in by withUnverified (confirmed friends only)
    icon: null, // filled in by withUnverified (confirmed friends only)
    pictureAt: null,
    pictureId: null,
    unverified: [], // filled in by withUnverified (needs a look at the other accounts)
  };
}

/**
 * Tells me when the friend I am connected to (or have just added) has not verified who they are: they have an
 * account, but neither a verified email nor a confirmed phone. They are still reachable, but I should know.
 */
/** For conversations from before the friendship remembered it: the time of the newest message of the feed (or null). */
async function lastSpoken(uid: string, connectionId: string): Promise<string | null> {
  const feed = await messageCol(uid).where("connectionId", "==", connectionId).get();
  const times = feed.docs.map((d) => d.data().time).filter((t): t is Timestamp => t instanceof Timestamp);
  return times.length ? new Date(Math.max(...times.map((t) => t.toMillis()))).toISOString() : null;
}

async function withUnverified(friend: Friend, entry: FirebaseFirestore.DocumentData | undefined, uid: string): Promise<Friend> {
  if (!entry || friend.status === "rejected") return friend;
  const other = (entry.linkedUid as string | null | undefined) ?? (entry.signaledUids as string[] | undefined)?.[0];
  if (!other) return friend;
  const account = (await userDoc(other).get()).data();
  const unverified = account && entry.trusted !== true ? unverifiedDetails(account) : []; // "this is really them" (trusted) hides the warning
  // the mood is for confirmed friends only
  const mood =
    friend.status === "confirmed" && account
      ? {
          country: (account.country as string | null | undefined) ?? null,
          mood: Number.isInteger(account.mood) ? (account.mood as number) : null,
          moodMessage: (account.moodMessage as string | null | undefined) ?? null,
          presence: presenceOf(account),
          icon: Number.isInteger(account.profileIcon) ? (account.profileIcon as number) : null,
          pictureAt: iso(account.profilePictureAt),
          pictureId: (account.avatarObjectId as string | null | undefined) ?? null,
        }
      : { country: null, mood: null, moodMessage: null, presence: "offline" as const, icon: null, pictureAt: null, pictureId: null };
  // I did not give a name: a confirmed friend is shown by the name of their account
  const name = entry.nameGiven === false && friend.status === "confirmed" ? ((account?.displayName as string | undefined) || friend.name) : friend.name;
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

/** List the friends in a circle. */
friendsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const snap = await friendCol(res).orderBy("createdAt", "asc").get();
    const friends = await Promise.all(snap.docs.map((d) => withUnverified(toJson(d), d.data(), uidOfRequest(res))));
    res.json({ friends, max: MAX_FRIENDS });
  }),
);

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
    // Does the friend already have an account? Then their frontend gets a ping (a signal) to run its search.
    const accounts = await findAccounts(data.email, keys.phoneKey, (res.locals.token as DecodedIdToken).uid);

    const col = friendCol(res);
    const ref = col.doc();
    const added = await getFirestore().runTransaction(async (tx) => {
      const existing = await tx.get(col);
      if (existing.docs.filter((d) => d.data().asleep !== true).length >= MAX_FRIENDS) return false; // friends on the sleep list have no seat
      tx.set(ref, {
        ...data,
        ...keys,
        connectionId: ref.id, // one id for the whole connection: both lists and the request use it
        peerCircleId: DEFAULT_CIRCLE_ID, // where the other person's entry will live
        nameGiven, // false = the name shown is the email / phone I typed
        status: "pending" as FriendStatus,
        linkedUid: null, // set when the other person's check finds this entry
        signaledUids: accounts, // who got a ping for this entry (removed again if the entry is deleted)
        // nobody has an account for this email / phone yet: a friend added by EMAIL can be invited by email, once I confirm
        // the address (a friend added only by phone number cannot: texts are only used for login codes)
        invite: accounts.length || !data.email ? null : { to: data.email, sentAt: null },
        createdAt: FieldValue.serverTimestamp(),
      });
      for (const account of accounts) writeSignal(tx, account, ref.id);
      return true;
    });

    if (!added) {
      res.status(409).json({ error: `This circle is full (max ${MAX_FRIENDS} friends)` });
      return;
    }
    if (accounts.length) {
      // the people who already have an account hear about it at once (their devices), and find the request when they open the app
      const fromName = await nameOf((res.locals.token as DecodedIdToken).uid, res.locals.token as DecodedIdToken);
      for (const account of accounts) {
        await sendPush(account, { id: `request-${ref.id}`, title: `${fromName} wants to be your friend`, body: data.message ?? "Open Seven Friends to answer.", url: "/" });
      }
    }
    const saved = await ref.get();
    res.status(201).json(await withUnverified(toJson(saved), saved.data(), (res.locals.token as DecodedIdToken).uid));
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
      tx.update(ref, { asleep });
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

/** The uploaded picture of a confirmed friend (a data URL), or null when there is none. The list only says WHEN it changed (`pictureAt`). */
friendsRouter.get(
  "/:friendId/picture",
  asyncHandler(async (req, res) => {
    const entry = (await friendCol(res).doc(req.params.friendId).get()).data();
    if (!entry || entry.status !== "confirmed" || !entry.linkedUid) {
      res.status(404).json({ error: "Friend not found" });
      return;
    }
    res.json({ image: await readAvatar(entry.linkedUid as string) } satisfies ProfilePicture);
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
    const fromName = ((await userDoc(token.uid).get()).data()?.displayName as string | undefined) ?? token.name ?? token.email ?? "Someone";

    const sent = await getFirestore().runTransaction(async (tx) => {
      const entry = (await tx.get(ref)).data();
      if (!entry?.invite || entry.invite.sentAt) return null; // changed meanwhile
      queueInvite(tx, {
        fromUid: token.uid,
        fromName,
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

    // The files of the conversation go FIRST, before the transaction: if the database delete fails they are wiped anyway.
    const before = (await ref.get()).data();
    if (before) {
      const people = before.linkedUid ? [uid, before.linkedUid as string] : [uid];
      const feeds = await Promise.all(people.map((p) => messageCol(p).where("connectionId", "==", id).get()));
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
      const feeds = await Promise.all(people.map((p) => tx.get(messageCol(p).where("connectionId", "==", id))));

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
    if (endedWith) {
      const name = await nameOf(uid, res.locals.token as DecodedIdToken);
      await sendPush(endedWith, { id: `removed-${id}`, title: `${name} removed the friendship`, body: "The conversation is deleted for both of you.", url: "/friends" });
    }
    res.status(204).end();
  }),
);
