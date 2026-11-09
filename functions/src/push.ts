import { createHash } from "node:crypto";
import { Router } from "express";
import { DecodedIdToken } from "firebase-admin/auth";
import { DocumentReference, FieldValue, getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { asyncHandler, requireAuth } from "./auth";
import { DEFAULT_CIRCLE_ID, PUSH_DEVICE_COLLECTION, circleIdForType, circleTypeOf } from "./constants";
import { CIRCLE_TYPES } from "./models";
import { circleCol, pushDeviceCol, readFields, userFields } from "./paths";
import { noticesOf } from "./preferences";
import { deleteRefs } from "./signals";
import { circleProfileOf, activeCircleOf } from "./circle-profile";

/**
 * Push notifications: the phone's or browser's own notification system wakes the device (Firebase Cloud Messaging),
 * so a message, a friend request or an answer arrives also when the app is closed or the screen is locked.
 *
 * A device registers with `POST /push/devices { token, app?, circle? }` (`app`: `all` by default, or one circle type for an app made for that circle; `circle`: the id of the circle the
 * app is in at that device; when the person turns push on in Settings), tells when the person changes circle with `PUT /push/devices/circle { token, circle }`, and is removed
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
  /** the circle of the receiver this is about: their devices that handle it are woken (see `devicesFor`); none = the first circle */
  circleId?: string;
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
 * The Android app shows a push in a notification channel named `<circle>_<kind>_<sound>`, where the circle is always `friends`: the ONE app has ONE set of
 * channels, whichever circle a push is about (android/.../Channels.java makes them: the ids must
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

/** One channel for each kind and sound: `friends_<kind>_<sound>` (friends_message_drill ...); the Android app makes them (Channels.java). The same set serves every circle. */
const channelFor = (kind: PushMessage["kind"], choice: string | null): string => {
  const sound = choice === "none" ? "silent" : choice?.startsWith("file:") ? (SOUND_KEY_BY_JINGLE[choice.slice(5)] ?? "default") : "default";
  return `friends_${kind}_${sound}`;
};

/** The page a tap opens, told which circle it is for: the app asks before it opens a page of another circle (only when it is not in that circle already). */
const withCircle = (url: string, circleType: string): string => `${url}${url.includes("?") ? "&" : "?"}incircle=${circleType}`;

/** The page a tap opens for a push about ANOTHER circle than the one the device is in: the app switches to that circle at once and opens the page (a tap is a clear wish). */
const withOpen = (url: string, circleType: string): string => `${url}${url.includes("?") ? "&" : "?"}opencircle=${circleType}`;

/** What a circle is called in a push about it that does not say what happened. */
const CIRCLE_LABEL: Record<string, string> = { friends: "Friends", buddies: "Buddies", work: "Work", family: "Family" };

const MAX_BODY = 120;
const MAX_TITLE = 100;
/** FCM answers that mean "this token will never work again": the device is removed. */
const DEAD_TOKEN = new Set(["messaging/registration-token-not-registered", "messaging/invalid-registration-token"]);

const deviceId = (token: string) => createHash("sha256").update(token).digest("hex").slice(0, 40);
const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** The name friends know this person by; with a circle: the name they have in that circle. */
export async function nameOf(uid: string, token?: DecodedIdToken, circleId: string = DEFAULT_CIRCLE_ID): Promise<string> {
  const data = await userFields(uid, "displayName");
  const shown = circleId === DEFAULT_CIRCLE_ID ? null : circleProfileOf(circleId, await readFields(circleCol(uid).doc(circleId), "profile"), data ?? {}).name;
  return shown ?? (data?.displayName as string | undefined) ?? token?.name ?? token?.email ?? "Someone";
}

/** One FCM send to some devices; the devices FCM says are gone are removed. Returns how many were reached. */
async function deliver(devices: Device[], message: { data: Record<string, string>; android: { priority: "high"; notification: { channelId: string; title: string; body: string } } }): Promise<number> {
  const result = await getMessaging().sendEachForMulticast({
    tokens: devices.map((d) => d.token),
    // data only for the web: the app's service worker shows it (so it can use the event id and open the right page)
    data: message.data,
    webpush: { headers: { Urgency: "high", TTL: "3600" } },
    // the notification block is what lets Android show it in the chosen channel (with its jingle) while the app is closed
    android: message.android,
  });
  const dead: DocumentReference[] = [];
  result.responses.forEach((r, i) => {
    if (!r.success && DEAD_TOKEN.has(r.error?.code ?? "")) dead.push(devices[i].ref);
  });
  if (dead.length) await deleteRefs(dead);
  return result.successCount;
}

/**
 * Sends a push to every device of `uid`. Never throws (the answer says what happened).
 * A device that is in the circle the push is about gets it as it is (the text, the sound the person chose for this kind). A device that is in ANOTHER circle
 * (the app tells the server which one it is in) gets only "Activity in <circle>", with the default message sound and no text: what happened in a circle
 * is shown in detail only while the person is in it. A tap on that one switches the app to the circle (`opencircle`).
 */
export async function sendPush(uid: string, push: PushMessage): Promise<PushResult> {
  try {
    const circleId = push.circleId ?? DEFAULT_CIRCLE_ID;
    // the switches and the devices are read at the same time (one wait, not two)
    const [account, devices] = await Promise.all([userFields(uid, "noticePreferences", "soundPreferences"), devicesFor(uid, circleTypeOf(circleId))]);
    const notices = noticesOf(account);
    if (!push.force && !notices[push.kind]) return { devices: 0, delivered: 0, off: true };
    if (!devices.length) return { devices: 0, delivered: 0 };

    const choice = soundChoice(account, push.kind);
    const circleType = circleTypeOf(circleId);
    const title = cut(push.title, MAX_TITLE);
    // "hide the text": the sender stays, the text of a message (or of a request) does not go to the lock screen
    const body = notices.hideText && !push.force ? (push.kind === "message" ? "New message" : "") : cut(push.body, MAX_BODY);
    const away = push.force ? [] : devices.filter((d) => d.circleId && d.circleId !== circleId);
    const here = devices.filter((d) => !away.includes(d));
    const awayTitle = `Activity in ${CIRCLE_LABEL[circleType] ?? circleType}`;

    const delivered = await Promise.all([
      here.length
        ? deliver(here, {
            // "silent" = no sound
            data: { id: push.id, title, body, url: withCircle(push.url, circleType), circle: circleType, ...(choice === "none" ? { silent: "1" } : {}) },
            android: { priority: "high", notification: { channelId: channelFor(push.kind, choice), title, body } },
          })
        : 0,
      away.length
        ? deliver(away, {
            data: { id: push.id, title: awayTitle, body: "", url: withOpen(push.url, circleType), circle: circleType },
            android: { priority: "high", notification: { channelId: channelFor("message", null), title: awayTitle, body: "" } }, // the default message sound
          })
        : 0,
    ]);
    return { devices: devices.length, delivered: delivered[0] + delivered[1] };
  } catch (err) {
    console.error("Could not send the push notification:", err);
    return { devices: 0, delivered: 0 };
  }
}

/** A registered device: its push token, and the circle the app is in on it (null = not told yet: it gets pushes as they are). */
interface Device {
  ref: DocumentReference;
  token: string;
  circleId: string | null;
}

/** What a device can be: the app that handles every circle (the website, the installed web app, the Seven Friends app), or an app made for one circle. */
const APP_KINDS = ["all", ...CIRCLE_TYPES];

/** The app a device registered as (`all` for the apps of every circle, and for devices that registered before there was a choice). */
const appOf = (data: { app?: unknown } | undefined): string => (typeof data?.app === "string" && APP_KINDS.includes(data.app) ? data.app : "all");

/**
 * The devices of a person that get a push about a circle (of that type). A device of the app made for this very circle is the first choice (and then
 * the only one: a person who has both apps is not woken twice). Without one, the devices of the all-circles app get it, whatever circle they are in at
 * the moment: the push says which circle it is about, and the app decides what to do (see `incircle` in the url).
 */
async function devicesFor(uid: string, circleType: string): Promise<Device[]> {
  const all = (await pushDeviceCol(uid).select("token", "app", "circleId").get()).docs
    .map((d) => ({ ref: d.ref, token: d.data().token as string, app: appOf(d.data()), circleId: typeof d.data().circleId === "string" ? (d.data().circleId as string) : null }))
    .filter((d) => d.token);
  const own = all.filter((d) => d.app === circleType);
  return (own.length ? own : all.filter((d) => d.app === "all")).map(({ ref, token, circleId }) => ({ ref, token, circleId }));
}

export const pushRouter = Router();
pushRouter.use(requireAuth);

/** The app that registers: `{ app }` is `all` (the default) or one circle type, for an app made for a single circle. */
const appKindOf = (body: unknown): string => {
  const app = (body as { app?: unknown } | undefined)?.app;
  return typeof app === "string" && APP_KINDS.includes(app) ? app : "all";
};

/** The circle the app on a device is in, from `{ circle }`: the id of one of the circles; null when it is left out or unknown. */
const CIRCLE_IDS = CIRCLE_TYPES.map(circleIdForType);
const circleOfBody = (body: unknown): string | null => {
  const circle = (body as { circle?: unknown } | undefined)?.circle;
  return typeof circle === "string" && CIRCLE_IDS.includes(circle) ? circle : null;
};

const tokenOf = (body: unknown): string | null => {
  const token = (body as { token?: unknown } | undefined)?.token;
  return typeof token === "string" && token.length >= 20 && token.length <= 4096 ? token : null;
};

/** A test: sends a notification to ALL my registered devices now, whatever my switches say, and tells how many were reached. */
pushRouter.post(
  "/test",
  asyncHandler(async (req, res) => {
    const uid = (res.locals.token as DecodedIdToken).uid;
    const result = await sendPush(uid, {
      circleId: activeCircleOf(req), // this app's circle
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

    const others = (await getFirestore().collectionGroup(PUSH_DEVICE_COLLECTION).where("token", "==", token).select().get()).docs
      .map((d) => d.ref)
      .filter((ref) => ref.path !== mine.path);
    await deleteRefs(others);

    const existing = await mine.get();
    await mine.set(
      { token, app: appKindOf(req.body), ...(circleOfBody(req.body) ? { circleId: circleOfBody(req.body) } : {}), updatedAt: FieldValue.serverTimestamp(), ...(existing.exists ? {} : { createdAt: FieldValue.serverTimestamp() }) },
      { merge: true },
    );
    res.status(204).end();
  }),
);

/** The person changed circle in the app on this device: pushes about another circle then say only where (see `sendPush`). A device that is not registered is ignored. */
pushRouter.put(
  "/devices/circle",
  asyncHandler(async (req, res) => {
    const token = tokenOf(req.body);
    const circle = circleOfBody(req.body);
    if (!token || !circle) {
      res.status(400).json({ error: "A push token and a circle are needed" });
      return;
    }
    const ref = pushDeviceCol((res.locals.token as DecodedIdToken).uid).doc(deviceId(token));
    if ((await ref.get()).exists) await ref.update({ circleId: circle });
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
