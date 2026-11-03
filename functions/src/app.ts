import cors from "cors";
import express from "express";
import { circlesRouter } from "./circles";
import { friendRequestsRouter } from "./friend-requests";
import { messagesRouter } from "./messages";
import { notificationsRouter } from "./notifications";
import { preferencesRouter } from "./preferences";
import { profileRouter } from "./profile";
import { pushRouter } from "./push";
import { usersRouter } from "./users";

/** The Express app behind the `api` Cloud Function (also used directly by the tests). */
export function createApp(): express.Express {
  const app = express();
  app.use(cors({ origin: true }));
  app.use(express.json({ limit: "200kb" })); // the biggest body is a profile picture (at most 70 KB, about 95 KB as text)

  // Hosting forwards the full path (including /api) to the function.
  const router = express.Router();
  router.get("/health", (_req, res) => {
    res.json({ status: "ok", app: "sevenfriends" });
  });
  router.use("/users", usersRouter);
  router.use("/circles", circlesRouter);
  router.use("/friend-requests", friendRequestsRouter);
  router.use("/messages", messagesRouter);
  router.use("/notifications", notificationsRouter);
  router.use("/profile", profileRouter);
  router.use("/preferences", preferencesRouter);
  router.use("/push", pushRouter);
  app.use("/api", router);
  return app;
}
