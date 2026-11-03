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
  USER_ACCOUNT_COLLECTION,
} from "./constants";
import { deliverSms, invitesSentToday, queueInvite } from "./outbox";
import { Friend, FriendInvite, FriendStatus, NewFriend, Socials } from "./models";
import { circleCol, friendRequestCol, messageCol, userDoc } from "./paths";
import { nameOf, sendPush } from "./push";
import { findAccounts, signalRefsOf, writeSignal } from "./signals";
import {
  EMAIL_RE,
  PHONE_RE,
  SOCIAL_NETWORKS,
  unverifiedDetails,
  parseSocials,
  phoneKey,
  text,
} from "./validation";

function parseFriend(body: Record<string, unknown>): { data?: NewFriend; error?: string } {
  const name = text(body.name, 100);
  const email = text(body.email, 200)?.toLowerCase() ?? null;
  const phone = text(body.phone, 25);
  const socials = parseSocials(body);
  const message = text(body.message, MAX_REQUEST_MESSAGE + 1);

  if (message && message.length > MAX_REQUEST_MESSAGE) {
    return { error: `The message can be at most ${MAX_REQUEST_MESSAGE} characters` };
  }
  if (!name) return { error: "Name is required" };
  if (email && !EMAIL_RE.test(email)) return { error: "Email is not valid" };
  if (phone && !PHONE_RE.test(phone)) return { error: "Phone number is not valid" };
  // Only an email or a phone number can find your friend (social accounts are extra contact info),
  // so one of them is needed for the request to ever arrive.
  if (!email && !phone) {
    return { error: "Add an email or a phone number, so your friend can be found" };
  }
  return { data: { name, email, phone, message, ...socials } };
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
    incoming: Boolean(data.incomingRequestId), // true = THEY invited ME; I can confirm
    requestId: (data.incomingRequestId as string | undefined) ?? null,
    createdAt: data.createdAt instanceof Timestamp ? data.createdAt.toDate().toISOString() : null,
    message: (data.message as string | null | undefined) ?? null,
    invite: inviteOf(data),
    unverified: [], // filled in by withUnverified (needs a look at the other accounts)
  };
}

/**
 * Tells me when the friend I am connected to (or have just added) has not verified who they are: they have an
 * account, but neither a verified email nor a confirmed phone. They are still reachable, but I should know.
 */
async function withUnverified(friend: Friend, entry: FirebaseFirestore.DocumentData | undefined): Promise<Friend> {
  if (!entry || friend.status === "rejected") return friend;
  const other = (entry.linkedUid as string | null | undefined) ?? (entry.signaledUids as string[] | undefined)?.[0];
  if (!other) return friend;
  const account = (await userDoc(other).get()).data();
  const unverified = account ? unverifiedDetails(account) : [];
  return unverified.length ? { ...friend, unverified } : friend;
}

const iso = (t: unknown) => (t instanceof Timestamp ? t.toDate().toISOString() : null);

function inviteOf(data: FirebaseFirestore.DocumentData): FriendInvite | null {
  const invite = data.invite as { channel: "email" | "sms"; to: string; sentAt?: unknown } | null | undefined;
  if (!invite || data.linkedUid) return null; // once the friend has an account, no invitation is needed
  return { channel: invite.channel, to: invite.to, sentAt: iso(invite.sentAt) };
}

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
    const friends = await Promise.all(snap.docs.map((d) => withUnverified(toJson(d), d.data())));
    res.json({ friends, max: MAX_FRIENDS });
  }),
);

/** Add a friend to the circle (max 7 per circle). */
friendsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const { data, error } = parseFriend(req.body ?? {});
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
      if (existing.size >= MAX_FRIENDS) return false;
      tx.set(ref, {
        ...data,
        ...keys,
        connectionId: ref.id, // one id for the whole connection: both lists and the request use it
        peerCircleId: DEFAULT_CIRCLE_ID, // where the other person's entry will live
        status: "pending" as FriendStatus,
        linkedUid: null, // set when the other person's check finds this entry
        signaledUids: accounts, // who got a ping for this entry (removed again if the entry is deleted)
        // nobody has an account for this email / phone yet: the friend can be invited (email first), once I confirm the address
        invite: accounts.length
          ? null
          : { channel: data.email ? "email" : "sms", to: (data.email ?? data.phone) as string, sentAt: null },
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
    res.status(201).json(await withUnverified(toJson(saved), saved.data()));
  }),
);

/**
 * Send the invitation to a friend who has no account yet (the person has confirmed the address on the
 * verify page first). Email goes through the `mail` outbox, SMS through `sms-outbox` (see outbox.ts).
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
    const invite = first.invite as { channel: "email" | "sms"; to: string; sentAt?: unknown } | null | undefined;
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

    const outbox = await getFirestore().runTransaction(async (tx) => {
      const entry = (await tx.get(ref)).data();
      if (!entry?.invite || entry.invite.sentAt) return null; // changed meanwhile
      const queued = queueInvite(tx, {
        fromUid: token.uid,
        fromName,
        channel: entry.invite.channel,
        to: entry.invite.to,
        message: (entry.message as string | null | undefined) ?? null,
      });
      tx.update(ref, { invite: { ...entry.invite, sentAt: FieldValue.serverTimestamp() } });
      return queued;
    });
    if (!outbox) {
      res.status(409).json({ error: "This friend has been invited already" });
      return;
    }
    if (invite.channel === "sms") await deliverSms(outbox);
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

    let endedWith: string | null = null; // a confirmed friend, who is told
    await getFirestore().runTransaction(async (tx) => {
      endedWith = null;
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
    });
    if (endedWith) {
      const name = await nameOf(uid, res.locals.token as DecodedIdToken);
      await sendPush(endedWith, { id: `removed-${id}`, title: `${name} removed the friendship`, body: "The conversation is deleted for both of you.", url: "/friends" });
    }
    res.status(204).end();
  }),
);
