import { createHash } from "node:crypto";
import { Router } from "express";
import { DecodedIdToken } from "firebase-admin/auth";
import { DocumentReference, FieldValue, getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { asyncHandler, requireAuth } from "./auth";
import { PUSH_DEVICE_COLLECTION } from "./constants";
import { pushDeviceCol, userDoc } from "./paths";
import { deleteRefs } from "./signals";

/**
 * Push notifications: the phone's or browser's own notification system wakes the device (Firebase Cloud Messaging),
 * so a message, a friend request or an answer arrives also when the app is closed or the screen is locked.
 *
 * A device registers with `POST /push/devices { token }` (when the person turns push on in Settings) and is removed
 * with `DELETE /push/devices { token }` (switch off, log out). The backend sends the push when the thing is written
 * (message, request, answer, removal), to every device of the person that gets it. A push carries the SAME id as the
 * desktop notification of that event, so a device that shows both shows one.
 * Best effort: a push that fails never fails the request that caused it.
 */
export interface PushMessage {
  /** the unique id of the event (message-{id}, request-{id}, answer-{connection}-{status}, removed-{connection}) */
  id: string;
  title: string;
  body: string;
  /** the page a tap opens */
  url: string;
  /** which of the person's three sound choices applies (none: the normal sound) */
  sound?: "message" | "request" | "answer";
}

/**
 * The Android app plays a jingle through a notification channel (one per jingle, made in android/.../MainActivity.java:
 * the ids must match). Android never changes the sound of a channel that already exists on a phone: a changed or new
 * jingle needs a NEW channel id here and in MainActivity.java. Any other choice (a built-in sound, no sound) uses the "default" channel.
 */
const CHANNEL_BY_JINGLE: Record<string, string> = {
  "SevenFriends_raw1_Drill.mp3": "sound_drill",
  "SevenFriends_raw2_Hyper.mp3": "sound_hyper",
  "SevenFriends_raw3_AcidBreaks.mp3": "sound_acidbreaks",
};

/** The channel for the sound this person chose for this kind of push ("file:<file name>" on their account). */
async function channelFor(uid: string, kind: PushMessage["sound"]): Promise<string> {
  if (!kind) return "default";
  const choice = ((await userDoc(uid).get()).data()?.soundPreferences as Record<string, unknown> | undefined)?.[kind];
  return typeof choice === "string" && choice.startsWith("file:") ? (CHANNEL_BY_JINGLE[choice.slice(5)] ?? "default") : "default";
}

const MAX_BODY = 120;
const MAX_TITLE = 100;
/** FCM answers that mean "this token will never work again": the device is removed. */
const DEAD_TOKEN = new Set(["messaging/registration-token-not-registered", "messaging/invalid-registration-token"]);

const deviceId = (token: string) => createHash("sha256").update(token).digest("hex").slice(0, 40);
const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** The name friends know this person by. */
export async function nameOf(uid: string, token?: DecodedIdToken): Promise<string> {
  const data = (await userDoc(uid).get()).data();
  return (data?.displayName as string | undefined) ?? token?.name ?? token?.email ?? "Someone";
}

/** Sends a push to every device of `uid`. Never throws. */
export async function sendPush(uid: string, push: PushMessage): Promise<void> {
  try {
    const devices = (await pushDeviceCol(uid).get()).docs
      .map((d) => ({ ref: d.ref, token: d.data().token as string }))
      .filter((d) => d.token);
    if (!devices.length) return;

    const channelId = await channelFor(uid, push.sound);
    const result = await getMessaging().sendEachForMulticast({
      tokens: devices.map((d) => d.token),
      // data only: the app's service worker shows it (so it can use the event id and open the right page)
      data: { id: push.id, title: cut(push.title, MAX_TITLE), body: cut(push.body, MAX_BODY), url: push.url },
      webpush: { headers: { Urgency: "high", TTL: "3600" } },
      // the notification block is what lets Android show it in the chosen channel (with its jingle) while the app is closed
      android: { priority: "high", notification: { channelId, title: cut(push.title, MAX_TITLE), body: cut(push.body, MAX_BODY) } },
    });

    const dead: DocumentReference[] = [];
    result.responses.forEach((r, i) => {
      if (!r.success && DEAD_TOKEN.has(r.error?.code ?? "")) dead.push(devices[i].ref);
    });
    if (dead.length) await deleteRefs(dead);
  } catch (err) {
    console.error("Could not send the push notification:", err);
  }
}

export const pushRouter = Router();
pushRouter.use(requireAuth);

const tokenOf = (body: unknown): string | null => {
  const token = (body as { token?: unknown } | undefined)?.token;
  return typeof token === "string" && token.length >= 20 && token.length <= 4096 ? token : null;
};

/** Register this device. A token belongs to ONE account: it is taken away from any other account (same phone, new login). */
pushRouter.post(
  "/devices",
  asyncHandler(async (req, res) => {
    const token = tokenOf(req.body);
    if (!token) {
      res.status(400).json({ error: "A push token is needed" });
      return;
    }
    const uid = (res.locals.token as DecodedIdToken).uid;
    const mine = pushDeviceCol(uid).doc(deviceId(token));

    const others = (await getFirestore().collectionGroup(PUSH_DEVICE_COLLECTION).where("token", "==", token).get()).docs
      .map((d) => d.ref)
      .filter((ref) => ref.path !== mine.path);
    await deleteRefs(others);

    const existing = await mine.get();
    await mine.set(
      { token, updatedAt: FieldValue.serverTimestamp(), ...(existing.exists ? {} : { createdAt: FieldValue.serverTimestamp() }) },
      { merge: true },
    );
    res.status(204).end();
  }),
);

/** Remove this device (push switched off, or logged out). */
pushRouter.delete(
  "/devices",
  asyncHandler(async (req, res) => {
    const token = tokenOf(req.body);
    if (!token) {
      res.status(400).json({ error: "A push token is needed" });
      return;
    }
    await pushDeviceCol((res.locals.token as DecodedIdToken).uid).doc(deviceId(token)).delete();
    res.status(204).end();
  }),
);
