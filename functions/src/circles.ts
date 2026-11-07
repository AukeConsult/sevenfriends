import { NextFunction, Request, Response, Router } from "express";
import { DecodedIdToken } from "firebase-admin/auth";
import { DocumentSnapshot, FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import { asyncHandler, requireAuth } from "./auth";
import {
  DEFAULT_CIRCLE_ID,
  DEFAULT_CIRCLE_NAME,
  DEFAULT_CIRCLE_TYPE,
} from "./constants";
import { friendsRouter } from "./friends";
import { Circle, CircleType, parseSettings, settingsOf } from "./models";
import { circleCol, userDoc } from "./paths";


/** Every user gets one default circle (type "friends"). Safe to call repeatedly. */
export async function ensureDefaultCircle(uid: string): Promise<void> {
  try {
    await circleCol(uid).doc(DEFAULT_CIRCLE_ID).create({
      name: DEFAULT_CIRCLE_NAME,
      type: DEFAULT_CIRCLE_TYPE,
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (err: any) {
    // 6 = ALREADY_EXISTS (fine). Anything else is a real problem: surface it.
    if (err?.code !== 6) throw err;
  }
}

/**
 * The choices (theme, text size, ...) were first kept on the account document: as `settings`, and before that as `theme` and `textSize`.
 * They belong to the circle now. The first time a person's circles are read, whatever is still on the account is moved into the default circle
 * (what the circle already has wins) and those fields are deleted from the account. Safe to repeat: with nothing left it does nothing.
 */
export async function moveOldSettings(uid: string): Promise<void> {
  const account = userDoc(uid);
  const circle = circleCol(uid).doc(DEFAULT_CIRCLE_ID);
  await getFirestore().runTransaction(async (tx) => {
    const [accountSnap, circleSnap] = await Promise.all([tx.get(account), tx.get(circle)]);
    const data = accountSnap.data() ?? {};
    const old = ["settings", "theme", "textSize"].filter((field) => field in data);
    if (!old.length || !circleSnap.exists) return;
    const fromAccount = settingsOf({ theme: data.theme, textSize: data.textSize, ...(typeof data.settings === "object" && data.settings ? data.settings : {}) });
    const merged = { ...fromAccount, ...settingsOf(circleSnap.data()?.settings) };
    if (Object.keys(fromAccount).length) tx.set(circle, { settings: merged }, { merge: true });
    tx.update(account, Object.fromEntries(old.map((field) => [field, FieldValue.delete()])));
  });
}

function circleJson(doc: DocumentSnapshot): Circle {
  const data = doc.data() ?? {};
  return {
    id: doc.id,
    name: data.name as string,
    type: data.type as CircleType,
    createdAt: data.createdAt instanceof Timestamp ? data.createdAt.toDate().toISOString() : null,
    settings: settingsOf(data.settings),
  };
}

const uidOf = (res: Response) => (res.locals.token as DecodedIdToken).uid;

export const circlesRouter = Router();
circlesRouter.use(requireAuth);

/** List the user's circles (creates the default one if missing). */
circlesRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const uid = uidOf(res);
    await ensureDefaultCircle(uid);
    await moveOldSettings(uid); // settings that were still on the account move to the circle
    const snap = await circleCol(uid).orderBy("createdAt", "asc").get();
    res.json({
      circles: snap.docs.filter((d) => d.data().type).map(circleJson),
    });
  }),
);

/**
 * Save the choices of one circle (theme, text size, order, ...): `{ ...only the ones that change }`. They are kept on the circle, so every device shows them
 * and each circle can have its own. A wrong value (or an unknown name) refuses the whole request and nothing is saved.
 */
circlesRouter.put(
  "/:circleId/settings",
  asyncHandler(async (req, res) => {
    const ref = circleCol(uidOf(res)).doc(req.params.circleId);
    const snap = await ref.get();
    if (!snap.exists || !snap.data()?.type) {
      res.status(404).json({ error: "Circle not found" });
      return;
    }
    const settings = parseSettings(req.body);
    if (!settings) {
      res.status(400).json({ error: "Those settings are not valid" });
      return;
    }
    await ref.set({ settings: { ...settingsOf(snap.data()?.settings), ...settings } }, { merge: true });
    res.json(circleJson(await ref.get()));
  }),
);

/** Friends live inside a circle: /api/circles/:circleId/friends */
async function loadCircle(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ref = circleCol(uidOf(res)).doc(req.params.circleId);
    const snap = await ref.get();
    if (!snap.exists || !snap.data()?.type) {
      res.status(404).json({ error: "Circle not found" });
      return;
    }
    res.locals.circleRef = ref;
    next();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
}

circlesRouter.use("/:circleId/friends", loadCircle, friendsRouter);
