// Checks that a person's chosen sounds are stored on their ACCOUNT (the backend reads them from there when it
// sends a push), which Android channel each kind of push would use, and which devices are registered for push.
// Read only: it changes nothing.
//
// Run it with:   npm --prefix functions run sounds:check -- someone@example.com      (an email, or a uid)
// It needs credentials: set GOOGLE_APPLICATION_CREDENTIALS to the path of the service account key file first.
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");

initializeApp({ projectId: process.env.GCLOUD_PROJECT || "sevenfriends" });

const { userDoc, pushDeviceCol } = require("../lib/paths");
const { channelFor } = require("../lib/push");

const KINDS = ["message", "request", "answer"];

async function main() {
  const who = process.argv[2];
  if (!who) {
    console.error("Usage: npm --prefix functions run sounds:check -- <email or uid>");
    process.exit(1);
  }
  const uid = who.includes("@") ? (await getAuth().getUserByEmail(who)).uid : who;
  console.log(`Account: ${uid}\n`);

  const data = (await userDoc(uid).get()).data();
  const sounds = data && data.soundPreferences;
  if (!sounds) {
    console.log("SOUNDS: none stored on the account.");
    console.log("  -> every push uses the normal sound. Open Settings > Sounds in the app, choose again, wait a second.\n");
  } else {
    console.log(`SOUNDS stored on the account (volume ${sounds.volume}):`);
    for (const kind of KINDS) {
      const choice = sounds[kind];
      const channel = await channelFor(uid, kind);
      const note = channel === "default" ? (String(choice).startsWith("file:") ? "  <- jingle not in the channel list" : "  <- not a jingle: normal sound") : "";
      console.log(`  ${kind.padEnd(8)} ${String(choice).padEnd(36)} -> Android channel "${channel}"${note}`);
    }
    console.log("");
  }

  const devices = (await pushDeviceCol(uid).get()).docs;
  console.log(`PUSH DEVICES registered: ${devices.length}`);
  for (const d of devices) {
    const { token, updatedAt } = d.data();
    const when = updatedAt && updatedAt.toDate ? updatedAt.toDate().toISOString() : "?";
    console.log(`  ${String(token).slice(0, 12)}...  last registered ${when}`);
  }
  if (!devices.length) console.log("  -> no device: push is switched off in Settings on every device, or the phone never registered.");
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
