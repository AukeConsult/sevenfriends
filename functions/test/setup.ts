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
vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({
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
