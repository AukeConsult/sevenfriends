import { onRequest } from "firebase-functions/v2/https";
import { initializeApp } from "firebase-admin/app";
import { createApp } from "./app";

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

// Not deployed for now: nobody sends invitation emails (friends are invited with a link). To send mail again, export it:
// export { sendMail } from "./mail-trigger";
