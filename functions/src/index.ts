import { onRequest } from "firebase-functions/v2/https";
import { initializeApp } from "firebase-admin/app";
import { createApp } from "./app";

initializeApp();

export const api = onRequest({ region: "europe-west1", invoker: "public" }, createApp());

// Not deployed for now: nobody sends invitation emails (friends are invited with a link). To send mail again, export it:
// export { sendMail } from "./mail-trigger";
