import cors from "cors";
import express from "express";
import { circlesRouter } from "./circles";
import { friendRequestsRouter } from "./friend-requests";
import { cacheRouter } from "./media";
import { inviteRouter, invitePublicRouter } from "./invite";
import { linkPreviewRouter } from "./link-preview";
import { messagesRouter } from "./messages";
import { notificationsRouter } from "./notifications";
import { preferencesRouter } from "./preferences";
import { keysRouter } from "./keys";
import { ownRecoveryRouter } from "./own-recovery";
import { reencryptRouter } from "./reencrypt";
import { recoveryListRouter } from "./recovery";
import { profileRouter } from "./profile";
import { pushRouter } from "./push";
import { usersRouter } from "./users";

/** The addresses of the app that may call the API from a browser. */
const ALLOWED_ORIGINS = [
  "https://sevenfriends.web.app",
  "https://sevenfriends.firebaseapp.com",
  "https://sevenfriends.io",
  "https://www.sevenfriends.io",
  "https://7friends.io",
  "https://www.7friends.io",
  "http://localhost:4200",
  "http://localhost:5000",
];

/** The Express app behind the `api` Cloud Function (also used directly by the tests). */
export function createApp(): express.Express {
  const app = express();
  // The app calls /api on its own address (Hosting rewrites /api/** to this function), so CORS only matters for the local dev servers.
  // Requests without an Origin header (the same address, tools) always pass.
  app.use(cors({ origin: ALLOWED_ORIGINS }));
  app.use(express.json({ limit: "200kb" })); // the biggest body is a profile picture (at most 70 KB, about 95 KB as text)

  // Hosting forwards the full path (including /api) to the function.
  const router = express.Router();
  router.get("/health", (_req, res) => {
    res.json({ status: "ok", app: "sevenfriends" });
  });
  router.use("/users", usersRouter);
  router.use("/sf-cache", cacheRouter);
  router.use("/circles", circlesRouter);
  router.use("/friend-requests", friendRequestsRouter);
  router.use("/messages", messagesRouter);
  router.use("/invite-public", invitePublicRouter); // before sign-in: the welcome page
  router.use("/invite", inviteRouter);
  router.use("/link-preview", linkPreviewRouter);
  router.use("/notifications", notificationsRouter);
  router.use("/profile", profileRouter);
  router.use("/keys", keysRouter);
  router.use("/own-recovery", ownRecoveryRouter);
  router.use("/reencrypt", reencryptRouter);
  router.use("/recovery", recoveryListRouter);
  router.use("/preferences", preferencesRouter);
  router.use("/push", pushRouter);
  app.use("/api", router);
  return app;
}
