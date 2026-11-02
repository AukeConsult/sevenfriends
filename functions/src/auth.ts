import { Request, Response, NextFunction, RequestHandler } from "express";
import { getAuth } from "firebase-admin/auth";

/** Verifies the Firebase ID token from the `Authorization: Bearer <token>` header. */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const match = (req.header("Authorization") ?? "").match(/^Bearer (.+)$/);
  if (!match) {
    res.status(401).json({ error: "Missing bearer token" });
    return;
  }
  try {
    res.locals.token = await getAuth().verifyIdToken(match[1]);
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

/** Express 4 does not catch rejected promises; this turns them into a 500 response. */
export function asyncHandler(
  fn: (req: Request, res: Response) => Promise<void>,
): RequestHandler {
  return (req, res) => {
    fn(req, res).catch((err) => {
      console.error(err);
      if (!res.headersSent) res.status(500).json({ error: "Internal server error" });
    });
  };
}
