import { Timestamp, getFirestore } from "firebase-admin/firestore";
import { SAFEBOX_REMINDERS } from "./constants";
import { nameOf, sendPush } from "./push";

/** One waiting reminder as `safebox-reminders/{connectionId}_{itemId}` keeps it. */
interface DueReminder {
  connectionId: string;
  itemId: string;
  targets: { uid: string; circleId: string; friendUid: string }[];
  setBy: string;
}

/**
 * Sends the reminders whose moment has come (the scheduled function runs this every few minutes). The server cannot read the locked date or ticket, so the
 * push says only that something in the safebox is due, with the friend's name; the page it opens shows the rest. A reminder is deleted when it is sent, so
 * it is sent once. Returns how many reminders were sent. Never raises.
 */
export async function sendDueReminders(now: Date = new Date()): Promise<number> {
  let sent = 0;
  try {
    const due = await getFirestore().collection(SAFEBOX_REMINDERS).where("at", "<=", Timestamp.fromMillis(now.getTime())).limit(200).get();
    for (const doc of due.docs) {
      const r = doc.data() as DueReminder;
      try {
        await doc.ref.delete(); // first: a push that fails is lost rather than sent again and again
        for (const target of r.targets) {
          const title = await nameOf(target.friendUid, undefined, target.circleId).catch(() => "Safebox");
          await sendPush(target.uid, { circleId: target.circleId, id: `reminder-${doc.id}`, title, body: "⏰ A reminder from your safebox", url: `/friends/${r.connectionId}/safebox/object/${r.itemId}`, kind: "message" });
        }
        sent++;
      } catch (err) {
        console.error(`Could not send the safebox reminder ${doc.id}`, err);
      }
    }
  } catch (err) {
    console.error("Could not read the safebox reminders", err);
  }
  return sent;
}
