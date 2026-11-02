import { onRequest } from "firebase-functions/v2/https";
import { initializeApp } from "firebase-admin/app";
import { createApp } from "./app";

initializeApp();

export const api = onRequest({ region: "europe-west1" }, createApp());
