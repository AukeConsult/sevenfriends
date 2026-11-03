// Writes assets/mail/preview.html: the invitation email as it looks with sample values.
// Run it with:  npm --prefix functions run mail:preview   then open functions/assets/mail/preview.html in a browser.
const fs = require("node:fs");
const path = require("node:path");
const { inviteHtml, inviteText } = require("../lib/outbox");

const sample = { fromUid: "preview", fromName: "Leif Auke", to: "friend@example.com", message: "Hi! I would like to have you as a close friend." };
const html = inviteHtml(sample);
if (!html) {
  console.error("No HTML template found (INVITE_EMAIL_TEMPLATE, default assets/mail/invite.html): the email would be sent as text only.");
  process.exit(1);
}
const out = path.join(__dirname, "..", "assets", "mail", "preview.html");
fs.writeFileSync(out, html);
fs.writeFileSync(out.replace(".html", "-without-message.html"), inviteHtml({ ...sample, message: null }));
console.log("Written:", out, "(and preview-without-message.html)");
console.log("\nPlain-text version:\n\n" + inviteText(sample));
