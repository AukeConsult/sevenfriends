import { readFileSync } from "node:fs";
import path from "node:path";
import { DocumentReference, FieldValue, Timestamp, Transaction, getFirestore } from "firebase-admin/firestore";
import { MAIL_COLLECTION } from "./constants";
import { missingIndex } from "./paths";
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

const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/**
 * The HTML version of the invitation: the template file (INVITE_EMAIL_TEMPLATE, `assets/mail/invite.html`) with the
 * places filled in. Every value is made safe for HTML (a message can never add markup). The part between
 * `<!--message-->` and `<!--/message-->` only stays when there is a message. Undefined when the file is missing or
 * unreadable: then the email is sent as text only.
 */
export function inviteHtml(invite: InviteMail): string | undefined {
  const file = path.resolve(__dirname, "..", setting("INVITE_EMAIL_TEMPLATE"));
  let template: string;
  try {
    template = readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
  const values: Record<string, string> = { ...placeholders(invite), subject: inviteSubject(invite) };
  template = template.replace(/<!--message-->([\s\S]*?)<!--\/message-->/g, values.message ? "$1" : "");
  // the note at the top of the template is not part of the email
  template = template.replace(/<!--\s*HOW THE INVITATION EMAIL LOOKS[\s\S]*?-->/, "");
  return template.replace(/\{(\w+)\}/g, (_all, key: string) => escapeHtml(values[key] ?? ""));
}

/** Writes the invitation email into the outbox (part of the caller's transaction). Returns the outbox document. */
export function queueInvite(tx: Transaction, invite: InviteMail): DocumentReference {
  const ref = getFirestore().collection(MAIL_COLLECTION).doc();
  tx.set(ref, {
    to: [invite.to],
    message: { subject: inviteSubject(invite), text: inviteText(invite), ...(inviteHtml(invite) ? { html: inviteHtml(invite) } : {}) },
    kind: "invite",
    fromUid: invite.fromUid,
    createdAt: FieldValue.serverTimestamp(),
  });
  return ref;
}

/** How many invitations this person sent during the last 24 hours. */
export async function invitesSentToday(uid: string): Promise<number> {
  const since = Timestamp.fromMillis(Date.now() - 24 * 60 * 60 * 1000);
  // counted by the database (nothing is read), only the last 24 hours. Needs the index mail(fromUid, createdAt) in firestore.indexes.json
  const mine = getFirestore().collection(MAIL_COLLECTION).where("fromUid", "==", uid);
  try {
    return (await mine.where("createdAt", ">=", since).count().get()).data().count;
  } catch (err) {
    if (!missingIndex(err)) throw err; // the index is not built yet: the old way (slower, the same answer)
    return (await mine.select("createdAt").get()).docs.filter((d) => {
      const at = d.get("createdAt");
      return !(at instanceof Timestamp) || at.toMillis() >= since.toMillis();
    }).length;
  }
}
