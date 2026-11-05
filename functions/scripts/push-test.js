// Sends ONE test push to every device registered for a person and prints what Firebase answers for each one
// (the real backend swallows these errors; here they are shown). It builds the message the same way as
// functions/src/push.ts, using the code in functions/lib (not the deployed functions).
//
// Run it with:   npm --prefix functions run push:test -- <email or uid> [message|request|answer]
// It needs credentials: set GOOGLE_APPLICATION_CREDENTIALS to the path of the service account key file first.
// Close the app on the phone first: an open app shows the notice itself and Android shows nothing.
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getMessaging } = require("firebase-admin/messaging");

initializeApp({ projectId: process.env.GCLOUD_PROJECT || "sevenfriends" });

const { pushDeviceCol } = require("../lib/paths");
const { channelFor } = require("../lib/push");

async function main() {
  const [who, kindArg] = process.argv.slice(2);
  const kind = kindArg || "message";
  if (!who || !["message", "request", "answer"].includes(kind)) {
    console.error("Usage: npm --prefix functions run push:test -- <email or uid> [message|request|answer]");
    process.exit(1);
  }
  const uid = who.includes("@") ? (await getAuth().getUserByEmail(who)).uid : who;
  const tokens = (await pushDeviceCol(uid).get()).docs.map((d) => d.data().token).filter(Boolean);
  if (!tokens.length) {
    console.log("No device is registered for this account: nothing to send to.");
    return;
  }
  const channelId = await channelFor(uid, kind);
  const title = "Seven Friends test";
  const body = `Test push (${kind})`;
  console.log(`Sending a "${kind}" test push to ${tokens.length} device(s) on Android channel "${channelId}" ...\n`);

  const result = await getMessaging().sendEachForMulticast({
    tokens,
    data: { id: `test-${Date.now()}`, title, body, url: "/" },
    webpush: { headers: { Urgency: "high", TTL: "3600" } },
    android: { priority: "high", notification: { channelId, title, body } },
  });
  result.responses.forEach((r, i) => {
    const token = `${String(tokens[i]).slice(0, 12)}...`;
    console.log(r.success ? `  ${token}  ACCEPTED by Firebase (message id ${r.messageId})` : `  ${token}  FAILED: ${r.error && r.error.code} - ${r.error && r.error.message}`);
  });
  console.log("\nACCEPTED means Firebase took it; if nothing shows on the phone, the token belongs to another device or browser, or the phone blocks it.");
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
