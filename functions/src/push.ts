import { createHash } from "node:crypto";
import { Router } from "express";
import { DecodedIdToken } from "firebase-admin/auth";
import { DocumentReference, FieldValue, getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { asyncHandler, requireAuth } from "./auth";
import { PUSH_DEVICE_COLLECTION } from "./constants";
import { pushDeviceCol, userDoc } from "./paths";
import { noticesOf } from "./preferences";
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
  /**
   * what kind of event this is: the receiver can switch each kind off (`NoticePreferences`), and the sound they chose for
   * message / request / answer is the one the push plays ("removed" has no sound of its own: the normal one)
   */
  kind: "message" | "request" | "answer" | "removed";
  /** a test from the person's own Settings page: sent whatever the switches say, and with the text shown */
  force?: boolean;
}

/** What `sendPush` did: how many devices the person has registered, and how many of them the push reached. */
export interface PushResult {
  devices: number;
  delivered: number;
  /** the person switched this kind of notification off: nothing was sent */
  off?: boolean;
}

/**
 * The Android app shows a push in a notification channel named `<kind>_<sound>` (made in android/.../Channels.java: the ids must
 * match), so Android's own settings list each kind (messages, requests, answers, removed) with its own on/off. The sound belongs
 * to the channel and Android never changes it on a phone where the channel exists: a changed or new jingle needs a NEW sound key
 * here and in Channels.java. "none" = "silent"; any other choice (a built-in sound, which only the browser can make) = "default"
 * (the phone's own sound).
 */
const SOUND_KEY_BY_JINGLE: Record<string, string> = {
  "SevenFriends_raw1_Drill.mp3": "drill",
  "SevenFriends_raw2_Hyper.mp3": "hyper",
  "SevenFriends_raw3_AcidBreaks.mp3": "acidbreaks",
};

/** The sound this person chose for this kind of push: "none", a built-in sound, or "file:<file name>"; null = not chosen (or "removed"). */
function soundChoice(data: Record<string, any> | undefined, kind: PushMessage["kind"]): string | null {
  if (kind === "removed") return null;
  const choice = (data?.soundPreferences as Record<string, unknown> | undefined)?.[kind];
  return typeof choice === "string" ? choice : null;
}

const channelFor = (kind: PushMessage["kind"], choice: string | null): string => {
  const sound = choice === "none" ? "silent" : choice?.startsWith("file:") ? (SOUND_KEY_BY_JINGLE[choice.slice(5)] ?? "default") : "default";
  return `${kind}_${sound}`;
};

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

/** Sends a push to every device of `uid`. Never throws (the answer says what happened). */
export async function sendPush(uid: string, push: PushMessage): Promise<PushResult> {
  try {
    const account = (await userDoc(uid).get()).data();
    const notices = noticesOf(account);
    if (!push.force && !notices[push.kind]) return { devices: 0, delivered: 0, off: true };

    const devices = (await pushDeviceCol(uid).get()).docs
      .map((d) => ({ ref: d.ref, token: d.data().token as string }))
      .filter((d) => d.token);
    if (!devices.length) return { devices: 0, delivered: 0 };

    const choice = soundChoice(account, push.kind);
    const title = cut(push.title, MAX_TITLE);
    // "hide the text": the sender stays, the text of a message (or of a request) does not go to the lock screen
    const body = notices.hideText && !push.force ? (push.kind === "message" ? "New message" : "") : cut(push.body, MAX_BODY);
    const result = await getMessaging().sendEachForMulticast({
      tokens: devices.map((d) => d.token),
      // data only for the web: the app's service worker shows it (so it can use the event id and open the right page); "silent" = no sound
      data: { id: push.id, title, body, url: push.url, ...(choice === "none" ? { silent: "1" } : {}) },
      webpush: { headers: { Urgency: "high", TTL: "3600" } },
      // the notification block is what lets Android show it in the chosen channel (with its jingle) while the app is closed
      android: { priority: "high", notification: { channelId: channelFor(push.kind, choice), title, body } },
    });

    const dead: DocumentReference[] = [];
    result.responses.forEach((r, i) => {
      if (!r.success && DEAD_TOKEN.has(r.error?.code ?? "")) dead.push(devices[i].ref);
    });
    if (dead.length) await deleteRefs(dead);
    return { devices: devices.length, delivered: result.successCount };
  } catch (err) {
    console.error("Could not send the push notification:", err);
    return { devices: 0, delivered: 0 };
  }
}

export const pushRouter = Router();
pushRouter.use(requireAuth);

const tokenOf = (body: unknown): string | null => {
  const token = (body as { token?: unknown } | undefined)?.token;
  return typeof token === "string" && token.length >= 20 && token.length <= 4096 ? token : null;
};

/** A test: sends a notification to ALL my registered devices now, whatever my switches say, and tells how many were reached. */
pushRouter.post(
  "/test",
  asyncHandler(async (_req, res) => {
    const uid = (res.locals.token as DecodedIdToken).uid;
    const result = await sendPush(uid, {
      id: `test-${Date.now()}`,
      title: "Seven Friends",
      body: "This is a test notification. It works!",
      url: "/sound-and-notifications",
      kind: "message",
      force: true,
    });
    res.json(result);
  }),
);

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
