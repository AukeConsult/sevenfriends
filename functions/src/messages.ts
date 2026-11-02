import { Router } from "express";
import { DecodedIdToken } from "firebase-admin/auth";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { asyncHandler, requireAuth } from "./auth";
import { messageCol } from "./paths";

const uidOf = (res: { locals: Record<string, unknown> }) => (res.locals.token as DecodedIdToken).uid;

/**
 * user-account/{uid}/messages/{id}: { time, fromUid, fromName, text, read }
 * `time` is when the message was sent.
 */
export interface MessageJson {
  id: string;
  fromName: string;
  text: string;
  time: string | null;
}

/** My unread incoming messages, newest first. */
export async function listUnreadMessages(uid: string): Promise<MessageJson[]> {
  const snap = await messageCol(uid).where("read", "==", false).get();
  return snap.docs
    .map((d) => {
      const data = d.data();
      return {
        id: d.id,
        fromName: (data.fromName as string) ?? "Someone",
        text: (data.text as string) ?? "",
        time: data.time instanceof Timestamp ? data.time.toDate().toISOString() : null,
      };
    })
    .sort((a, b) => (b.time ?? "").localeCompare(a.time ?? ""));
}

export const messagesRouter = Router();
messagesRouter.use(requireAuth);

messagesRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.json({ messages: await listUnreadMessages(uidOf(res)) });
  }),
);

/** Mark one of my messages as read. */
messagesRouter.post(
  "/:id/read",
  asyncHandler(async (req, res) => {
    const ref = messageCol(uidOf(res)).doc(req.params.id);
    if (!(await ref.get()).exists) {
      res.status(404).json({ error: "Message not found" });
      return;
    }
    await ref.update({ read: true, readAt: FieldValue.serverTimestamp() });
    res.json({ ok: true });
  }),
);
