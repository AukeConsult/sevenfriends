import { touchSync } from "./sync";
import { Router } from "express";
import { DecodedIdToken } from "firebase-admin/auth";
import { FieldValue } from "firebase-admin/firestore";
import { asyncHandler, requireAuth } from "./auth";
import { Preferences, SoundPreferences } from "./models";
import { userDoc } from "./paths";

/** The built-in sounds (the same list as the app's SoundService). */
const BUILT_IN = new Set(["none", "ding", "chime", "bell", "pop", "marimba", "soft"]);
const MAX_FILE_NAME = 200;

const uidOf = (res: { locals: Record<string, unknown> }) => (res.locals.token as DecodedIdToken).uid;

/** A sound id: a built-in sound, or `file:<name>` for a jingle (a plain file name: no folders, no control characters). */
export function isSoundId(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (BUILT_IN.has(value)) return true;
  if (!value.startsWith("file:")) return false;
  const name = value.slice("file:".length);
  return name.length > 0 && name.length <= MAX_FILE_NAME && !/[\\/\u0000-\u001f]/.test(name) && name !== "." && name !== "..";
}

function soundsOf(data: Record<string, any> | undefined): SoundPreferences | null {
  const s = data?.soundPreferences;
  if (!s || !isSoundId(s.message) || !isSoundId(s.request) || !isSoundId(s.answer) || !Number.isInteger(s.volume)) return null;
  return { message: s.message, request: s.request, answer: s.answer, volume: s.volume };
}

/** My settings that belong to ME (not to a device): for now the sounds. Stored on the user-account document. */
export const preferencesRouter = Router();
preferencesRouter.use(requireAuth);

preferencesRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const preferences: Preferences = { sounds: soundsOf((await userDoc(uidOf(res)).get()).data()) };
    res.json(preferences);
  }),
);

/** Save my sounds: { message, request, answer, volume }. All of it, or nothing. */
preferencesRouter.put(
  "/sounds",
  asyncHandler(async (req, res) => {
    const { message, request, answer, volume } = req.body ?? {};
    if (![message, request, answer].every(isSoundId)) {
      res.status(400).json({ error: "Choose a built-in sound or a jingle for message, request and answer" });
      return;
    }
    if (!Number.isInteger(volume) || volume < 0 || volume > 100) {
      res.status(400).json({ error: "The volume is a whole number from 0 to 100" });
      return;
    }
    const sounds: SoundPreferences = { message, request, answer, volume };
    // set + merge so it also works if the account document does not exist yet
    await userDoc(uidOf(res)).set({ soundPreferences: sounds, preferencesUpdatedAt: FieldValue.serverTimestamp() }, { merge: true });
    await touchSync(uidOf(res), "preferencesAt");
    res.json({ sounds } satisfies Preferences);
  }),
);
