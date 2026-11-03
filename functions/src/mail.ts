import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { MAIL_COLLECTION } from "./constants";
import { EMAIL_RE } from "./validation";

/**
 * Sends the emails in the `mail` collection through YOUR OWN mail server (SMTP). The Cloud Function in
 * `mail-trigger.ts` calls `deliverMail` for every document written there.
 *
 * A mail document: { to: string[] | string, message: { subject, text, html? }, ... }. Its progress is kept in the
 * document itself, in the same format as the Firebase "Trigger Email" extension (so that extension could replace this
 * later without changing anything that writes mail):
 *   delivery: { state: PROCESSING | SUCCESS | ERROR | RETRY, attempts, startTime, endTime, error, info }
 *  - no `delivery`        -> not tried yet: it is sent now
 *  - `state: "RETRY"`     -> set by hand (or by a person) to send it again, for example after fixing the settings
 *  - any other state      -> left alone (a document is sent once; a retry of the function never sends it twice)
 *
 * The settings are environment variables (see settings.ts, `.env.example`): SMTP_HOST, SMTP_PORT, SMTP_SECURE,
 * SMTP_USER, SMTP_PASS and MAIL_FROM. The password is never written to the document or the logs.
 */

/** What deliverMail needs from the mail library (nodemailer's `sendMail`), so tests can use a fake. */
export interface MailTransport {
  sendMail(options: { from: string; to: string[]; subject: string; text?: string; html?: string }): Promise<{
    messageId?: string;
    accepted?: unknown[];
    rejected?: unknown[];
    response?: string;
  }>;
}

export interface MailSettings {
  host: string;
  port: number;
  /** true = the connection is encrypted from the start (port 465); false = it upgrades with STARTTLS (587) */
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}

const MAX_RECIPIENTS = 10;
const env = (name: string) => process.env[name]?.trim() ?? "";

/** The mail settings from the environment, or null when email is not set up (SMTP_HOST and MAIL_FROM are needed). */
export function mailSettings(): MailSettings | null {
  const host = env("SMTP_HOST");
  const from = env("MAIL_FROM");
  if (!host || !from) return null;
  const port = Number(env("SMTP_PORT")) || 587;
  const secure = env("SMTP_SECURE") ? env("SMTP_SECURE").toLowerCase() === "true" : port === 465;
  return { host, port, secure, user: env("SMTP_USER"), pass: env("SMTP_PASS"), from };
}

/** Reads and checks the mail document; the problem as text when it cannot be sent. */
function messageOf(data: Record<string, any>): { to: string[]; subject: string; text?: string; html?: string } | string {
  const to = (Array.isArray(data.to) ? data.to : [data.to]).filter((a): a is string => typeof a === "string" && EMAIL_RE.test(a.trim())).map((a) => a.trim());
  if (!to.length) return "The mail has no valid recipient (to)";
  if (to.length > MAX_RECIPIENTS) return `The mail has more than ${MAX_RECIPIENTS} recipients`;
  const { subject, text, html } = data.message ?? {};
  if (typeof subject !== "string" || !subject.trim()) return "The mail has no subject (message.subject)";
  if (typeof text !== "string" && typeof html !== "string") return "The mail has no text (message.text or message.html)";
  return { to, subject: subject.trim(), ...(typeof text === "string" ? { text } : {}), ...(typeof html === "string" ? { html } : {}) };
}

/**
 * Sends the mail document `id` if it is its turn (see above). Returns what happened:
 * "sent", "failed" (the reason is in `delivery.error`), or "skipped" (already handled / not due).
 * `transportFor` builds the connection to the mail server from the settings (nodemailer in production, a fake in tests).
 */
export async function deliverMail(
  id: string,
  transportFor: (settings: MailSettings) => MailTransport,
): Promise<"sent" | "failed" | "skipped"> {
  const ref = getFirestore().collection(MAIL_COLLECTION).doc(id);

  // Claim the mail: only ONE run may send it, also when the function is started twice for the same document
  const claimed = await getFirestore().runTransaction(async (tx) => {
    const data = (await tx.get(ref)).data();
    if (!data) return null;
    const delivery = data.delivery as { state?: string; attempts?: number } | undefined;
    if (delivery?.state && delivery.state !== "RETRY") return null;
    tx.update(ref, {
      delivery: { state: "PROCESSING", attempts: (delivery?.attempts ?? 0) + 1, startTime: FieldValue.serverTimestamp() },
    });
    return { data, attempts: (delivery?.attempts ?? 0) + 1 };
  });
  if (!claimed) return "skipped";

  const fail = async (error: string) => {
    await ref.update({ delivery: { state: "ERROR", attempts: claimed.attempts, error, endTime: FieldValue.serverTimestamp() } });
    console.error(`Mail ${id} was not sent: ${error}`);
    return "failed" as const;
  };

  const settings = mailSettings();
  if (!settings) return fail("Email is not set up: SMTP_HOST and MAIL_FROM are missing in the settings (functions/.env)");
  const message = messageOf(claimed.data);
  if (typeof message === "string") return fail(message);

  try {
    const info = await transportFor(settings).sendMail({ from: settings.from, ...message });
    await ref.update({
      delivery: {
        state: "SUCCESS",
        attempts: claimed.attempts,
        endTime: FieldValue.serverTimestamp(),
        info: {
          messageId: info.messageId ?? null,
          accepted: (info.accepted ?? []).map(String),
          rejected: (info.rejected ?? []).map(String),
          response: info.response ?? null,
        },
      },
    });
    return "sent";
  } catch (err) {
    return fail(String((err as Error)?.message ?? err).slice(0, 500));
  }
}
