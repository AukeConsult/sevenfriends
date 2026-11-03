import { NextFunction, Request, Response, Router } from "express";
import { DecodedIdToken } from "firebase-admin/auth";
import { DocumentSnapshot, FieldValue, Timestamp } from "firebase-admin/firestore";
import { asyncHandler, requireAuth } from "./auth";
import {
  DEFAULT_CIRCLE_ID,
  DEFAULT_CIRCLE_NAME,
  DEFAULT_CIRCLE_TYPE,
} from "./constants";
import { friendsRouter } from "./friends";
import { Circle, CircleType } from "./models";
import { circleCol } from "./paths";


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

function circleJson(doc: DocumentSnapshot): Circle {
  const data = doc.data() ?? {};
  return {
    id: doc.id,
    name: data.name as string,
    type: data.type as CircleType,
    createdAt: data.createdAt instanceof Timestamp ? data.createdAt.toDate().toISOString() : null,
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
    const snap = await circleCol(uid).orderBy("createdAt", "asc").get();
    res.json({
      circles: snap.docs.filter((d) => d.data().type).map(circleJson),
    });
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
