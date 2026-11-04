import { onRequest } from "firebase-functions/v2/https";
import { initializeApp } from "firebase-admin/app";
import { createApp } from "./app";

initializeApp();

export const api = onRequest({ region: "europe-west1", invoker: "public" }, createApp());

// sends the emails written to the `mail` collection through your own mail server (see mail.ts)
export { sendMail } from "./mail-trigger";
