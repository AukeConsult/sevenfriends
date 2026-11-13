import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { initializeApp } from "firebase-admin/app";
import { createApp } from "./app";
import { sendDueReminders } from "./safebox-reminders";
import { sendDueOwnRequestReminders } from "./own-request";

initializeApp();

export const api = onRequest(
  {
    region: "europe-west1",
    invoker: "public",
    memory: "512MiB", // more memory also gives more CPU: a faster start
    timeoutSeconds: 120, // the longest a single request may run
    maxInstances: 10, // upper limit: protects against runaway cost
    concurrency: 80, // requests one instance handles at the same time
    cpu: 1,
  },
  createApp(),
);

/** Every 5 minutes: push the safebox reminders (dates, tickets) that are due, and the one more push for a device that has waited a day for approval. Needs Cloud Scheduler (the Blaze plan); the emulator does not run it. */
export const safeboxReminders = onSchedule({ region: "europe-west1", schedule: "every 5 minutes", timeoutSeconds: 120, memory: "256MiB", maxInstances: 1 }, async () => {
  await sendDueReminders();
  await sendDueOwnRequestReminders();
});

// Not deployed for now: nobody sends invitation emails (friends are invited with a link). To send mail again, export it:
// export { sendMail } from "./mail-trigger";
