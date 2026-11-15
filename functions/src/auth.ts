import { Request, Response, NextFunction, RequestHandler } from "express";
import { getAuth } from "firebase-admin/auth";

/**
 * A login that Firebase has deleted still has ID tokens that verify for up to an hour. Such a token must not do anything: a device that still holds a
 * deleted account could otherwise make parts of it again (its account document, its keys). So the login itself is looked up, at most every 15 seconds for each
 * person (and a lookup that fails for another reason lets the request through: Firebase being slow must not lock people out). The erase route forgets the
 * login at once.
 */
const CHECK_LOGIN_EVERY_MS = 15_000;
const loginSeen = new Map<string, number>();
let lastLookupError = 0;

export function forgetLogin(uid: string): void {
  loginSeen.delete(uid);
}

async function loginExists(uid: string): Promise<boolean> {
  const at = loginSeen.get(uid);
  if (at !== undefined && Date.now() - at < CHECK_LOGIN_EVERY_MS) return true;
  try {
    await getAuth().getUser(uid);
    if (loginSeen.size > 5000) loginSeen.clear();
    loginSeen.set(uid, Date.now());
    return true;
  } catch (err) {
    if ((err as { code?: string })?.code === "auth/user-not-found") {
      loginSeen.delete(uid);
      return false;
    }
    if (Date.now() - lastLookupError > 300_000) {
      lastLookupError = Date.now();
      console.error("Could not look up a login (requests are let through):", err); // seen in the logs: the protection against a deleted login is off meanwhile
    }
    return true;
  }
}

/** Verifies the Firebase ID token from the `Authorization: Bearer <token>` header. */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const match = (req.header("Authorization") ?? "").match(/^Bearer (.+)$/);
  if (!match) {
    res.status(401).json({ error: "Missing bearer token" });
    return;
  }
  try {
    const token = await getAuth().verifyIdToken(match[1]);
    if (!(await loginExists(token.uid))) {
      res.status(401).json({ error: "This account was deleted" });
      return;
    }
    res.locals.token = token;
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
