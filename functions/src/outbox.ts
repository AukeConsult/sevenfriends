import { DocumentReference, FieldValue, Timestamp, Transaction, getFirestore } from "firebase-admin/firestore";
import { MAIL_COLLECTION } from "./constants";
import { fill, setting } from "./settings";

export interface InviteMail {
  fromUid: string;
  fromName: string;
  /** the email address invited */
  to: string;
  message: string | null;
}

/** The values a template can use (see settings.ts and `.env.example`). */
function placeholders({ fromName, to, message }: InviteMail): Record<string, string> {
  return {
    fromName,
    message: message ? `"${message}"` : "",
    to,
    appUrl: setting("APP_URL"),
  };
}

/** The words of the invitation email: the template from the settings (INVITE_EMAIL_TEXT), filled in. */
export function inviteText(invite: InviteMail): string {
  return fill(setting("INVITE_EMAIL_TEXT"), placeholders(invite));
}

/** The subject of the invitation email (INVITE_EMAIL_SUBJECT). */
export function inviteSubject(invite: InviteMail): string {
  return fill(setting("INVITE_EMAIL_SUBJECT"), placeholders(invite));
}

/** Writes the invitation email into the outbox (part of the caller's transaction). Returns the outbox document. */
export function queueInvite(tx: Transaction, invite: InviteMail): DocumentReference {
  const ref = getFirestore().collection(MAIL_COLLECTION).doc();
  tx.set(ref, {
    to: [invite.to],
    message: { subject: inviteSubject(invite), text: inviteText(invite) },
    kind: "invite",
    fromUid: invite.fromUid,
    createdAt: FieldValue.serverTimestamp(),
  });
  return ref;
}

/** How many invitations this person sent during the last 24 hours. */
export async function invitesSentToday(uid: string): Promise<number> {
  const since = Date.now() - 24 * 60 * 60 * 1000;
  const snap = await getFirestore().collection(MAIL_COLLECTION).where("fromUid", "==", uid).get();
  return snap.docs.filter((d) => {
    const at = d.data().createdAt;
    return !(at instanceof Timestamp) || at.toMillis() >= since;
  }).length;
}
