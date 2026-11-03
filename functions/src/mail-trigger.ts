import { onDocumentWritten } from "firebase-functions/v2/firestore";
import nodemailer from "nodemailer";
import { deliverMail } from "./mail";
import { setting } from "./settings";

/**
 * The trigger: every time a document in `mail/{id}` is written, send it through the mail server of the settings
 * (see mail.ts). Written (not only created) so that setting `delivery.state` to "RETRY" sends it again.
 * Our own updates of `delivery` start it again too, but a mail that has a state is left alone.
 *
 * The region must match where the Firestore database is (Firebase console → Firestore → Settings); set
 * MAIL_TRIGGER_REGION in functions/.env when it is not the default.
 */
export const sendMail = onDocumentWritten(
  { document: "mail/{mailId}", region: setting("MAIL_TRIGGER_REGION") },
  async (event) => {
    if (!event.data?.after.exists) return; // the document was deleted
    await deliverMail(event.params.mailId, (settings) =>
      nodemailer.createTransport({
        host: settings.host,
        port: settings.port,
        secure: settings.secure,
        ...(settings.user ? { auth: { user: settings.user, pass: settings.pass } } : {}),
      }),
    );
  },
);
