import { initializeApp } from "firebase-admin/app";
import { vi } from "vitest";

export const PROJECT = "demo-sevenfriends-test";

/**
 * Two ways to run the same tests:
 *  - default (`npm test`): an in-memory Firestore (test/fake-firestore.ts): no Java, no emulator
 *  - `npm run test:emulator`: the real Firestore emulator (FIRESTORE_EMULATOR_HOST is set by the CLI)
 */
export const USING_EMULATOR = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

vi.mock("firebase-admin/firestore", async (importOriginal) => {
  if (process.env.FIRESTORE_EMULATOR_HOST) return await importOriginal<typeof import("firebase-admin/firestore")>();
  return await import("./fake-firestore");
});

// No real login in tests: the bearer token IS the decoded token, e.g. {"uid":"uid01","email":"..."}.
/** pushes the backend sent (firebase-admin/messaging is replaced by a recorder); tokens in `deadPushTokens` answer "not registered" */
export type SentPush = { tokens: string[]; data: Record<string, string>; webpush?: unknown; android?: unknown };
export const sentPushes: SentPush[] = ((globalThis as any).__sentPushes ??= []);
export const deadPushTokens: Set<string> = ((globalThis as any).__deadPushTokens ??= new Set<string>());
export const pushBreaks: { on: boolean } = ((globalThis as any).__pushBreaks ??= { on: false });

vi.mock("firebase-admin/messaging", () => ({
  getMessaging: () => ({
    sendEachForMulticast: async (message: SentPush) => {
      const g = globalThis as any;
      if (g.__pushBreaks.on) throw new Error("FCM is down");
      g.__sentPushes.push(message);
      const responses = message.tokens.map((t) =>
        g.__deadPushTokens.has(t) ? { success: false, error: { code: "messaging/registration-token-not-registered" } } : { success: true },
      );
      return { responses, successCount: responses.filter((r) => r.success).length, failureCount: responses.filter((r) => !r.success).length };
    },
  }),
}));

// Google Storage is always the in-memory fake (test/fake-storage.ts); the Storage emulator is not needed for the tests.
vi.mock("firebase-admin/storage", async () => {
  const { fakeBucket } = await import("./fake-storage");
  return { getStorage: () => ({ bucket: () => fakeBucket }) };
});

/** logins removed by `deleteUser` (the erase route), so tests can check the login went too */
export const deletedLogins: Set<string> = ((globalThis as any).__deletedLogins ??= new Set<string>());

vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({
    deleteUser: async (uid: string) => {
      ((globalThis as any).__deletedLogins as Set<string>).add(uid);
    },
    verifyIdToken: async (token: string) => {
      const decoded = JSON.parse(token);
      if (!decoded.uid) throw new Error("bad token");
      return decoded;
    },
  }),
}));

if (USING_EMULATOR) {
  process.env.GCLOUD_PROJECT = PROJECT;
  initializeApp({ projectId: PROJECT });
}
