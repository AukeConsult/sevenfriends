import { DocumentReference, FieldValue, Timestamp, Transaction, getFirestore } from "firebase-admin/firestore";
import { MAIL_COLLECTION, SMS_COLLECTION } from "./constants";

export type InviteChannel = "email" | "sms";

export interface InviteMail {
  fromUid: string;
  fromName: string;
  channel: InviteChannel;
  to: string;
  message: string | null;
}

const appUrl = () => process.env.APP_URL ?? "http://localhost:4200";

/** The words of an invitation (the same for email and SMS). */
export function inviteText({ fromName, channel, to, message }: InviteMail): string {
  const what = channel === "email" ? "email address" : "phone number";
  return [
    `${fromName} wants you as one of their 7 closest friends on Seven Friends.`,
    ...(message ? [``, `"${message}"`] : []),
    ``,
    `Sign up with this ${what} (${to}) to see the request: ${appUrl()}`,
  ].join("\n");
}

/** Writes the invitation into the outbox (part of the caller's transaction). Returns the outbox document. */
export function queueInvite(tx: Transaction, invite: InviteMail): DocumentReference {
  const db = getFirestore();
  const text = inviteText(invite);
  if (invite.channel === "email") {
    const ref = db.collection(MAIL_COLLECTION).doc();
    tx.set(ref, {
      to: [invite.to],
      message: { subject: `${invite.fromName} invited you to Seven Friends`, text },
      kind: "invite",
      fromUid: invite.fromUid,
      createdAt: FieldValue.serverTimestamp(),
    });
    return ref;
  }
  const ref = db.collection(SMS_COLLECTION).doc();
  tx.set(ref, {
    to: invite.to,
    body: text,
    kind: "invite",
    status: "queued",
    fromUid: invite.fromUid,
    createdAt: FieldValue.serverTimestamp(),
  });
  return ref;
}

/**
 * Sends a queued SMS now, when an SMS provider is configured (Twilio: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN,
 * TWILIO_FROM). Without them the text stays `queued` in `sms-outbox` for another sender to pick up.
 * Never throws: the invitation is already saved; a failed send is recorded on the document.
 */
export async function deliverSms(ref: DocumentReference): Promise<void> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM;
  if (!sid || !token || !from) return;
  try {
    const sms = (await ref.get()).data();
    if (!sms) return;
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: sms.to, From: from, Body: sms.body }).toString(),
    });
    await ref.update(
      res.ok ? { status: "sent", sentAt: FieldValue.serverTimestamp() } : { status: "failed", error: `HTTP ${res.status}` },
    );
  } catch (err: any) {
    await ref.update({ status: "failed", error: String(err?.message ?? err).slice(0, 200) }).catch(() => undefined);
  }
}

/** How many invitations this person sent during the last 24 hours (both channels). */
export async function invitesSentToday(uid: string): Promise<number> {
  const db = getFirestore();
  const since = Date.now() - 24 * 60 * 60 * 1000;
  let n = 0;
  for (const name of [MAIL_COLLECTION, SMS_COLLECTION]) {
    const snap = await db.collection(name).where("fromUid", "==", uid).get();
    n += snap.docs.filter((d) => {
      const at = d.data().createdAt;
      return !(at instanceof Timestamp) || at.toMillis() >= since;
    }).length;
  }
  return n;
}
