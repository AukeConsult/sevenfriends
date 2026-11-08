import { Router } from "express";
import { DecodedIdToken } from "firebase-admin/auth";
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import { asyncHandler, requireAuth } from "./auth";
import { MyKeys, KeyBackup, MAX_KEYS_PER_PERSON, MAX_KEY_LABEL, PublicKeyJwk, PublishedKey, canonicalPublicKey, fingerprintOf, keyIdOf } from "./models";
import { keyBackupDoc, keyCol } from "./paths";
import { text } from "./validation";

const uidOf = (res: { locals: Record<string, unknown> }) => (res.locals.token as DecodedIdToken).uid;

/**
 * The public keys of a person's devices, and the backup of the private key (design: docs/design/safebox-encryption.md).
 * The server only keeps them: it never sees a private key, and the backup it holds is scrambled with a code only the person has.
 */
export const keysRouter = Router();
keysRouter.use(requireAuth);

export const publishedOf = (id: string, data: FirebaseFirestore.DocumentData): PublishedKey => ({
  id,
  fingerprint: data.fingerprint as string,
  label: (data.label as string | undefined) ?? "",
  createdAt: data.createdAt instanceof Timestamp ? data.createdAt.toDate().toISOString() : null,
  revoked: data.revoked === true,
  publicKey: data.publicKey as PublicKeyJwk,
});

/** The keys of a person that are in use (not retired), oldest first. */
export async function publishedKeysOf(uid: string): Promise<PublishedKey[]> {
  const snap = await keyCol(uid).get();
  return snap.docs
    .filter((d) => d.data().revoked !== true)
    .map((d) => publishedOf(d.id, d.data()))
    .sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
}

/** My published keys, and whether a backup is stored. */
keysRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const uid = uidOf(res);
    const [snap, backup] = await Promise.all([keyCol(uid).get(), keyBackupDoc(uid).get()]);
    const keys = snap.docs.map((d) => publishedOf(d.id, d.data())).sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
    res.json({ keys, hasBackup: backup.exists } satisfies MyKeys);
  }),
);

/**
 * Publish the public key of this device: `{ publicKey: JWK, label?: text }`. The server works out the fingerprint itself; the key ID is
 * made from it, so the same key always has the same ID and publishing it again changes nothing (apart from the label).
 */
/** A backup as the app sends it, or null when it is not one. */
function backupOf(body: unknown): KeyBackup | null {
  const { v, iv, data } = (body ?? {}) as Record<string, unknown>;
  const ivOk = typeof iv === "string" && B64.test(iv) && Buffer.from(iv, "base64").length === 12;
  const dataOk = typeof data === "string" && data.length >= 64 && data.length <= 8000 && B64.test(data);
  return v === 1 && ivOk && dataOk ? { v: 1, iv: iv as string, data: data as string } : null;
}

keysRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const uid = uidOf(res);
    const key = canonicalPublicKey((req.body ?? {}).publicKey);
    const fingerprint = key ? await fingerprintOf(key) : null;
    if (!key || !fingerprint) {
      res.status(400).json({ error: "That is not a 3072-bit RSA public key" });
      return;
    }
    const id = keyIdOf(fingerprint);
    const label = text((req.body ?? {}).label, MAX_KEY_LABEL) ?? "";
    // a new key may come WITH its recovery backup: both are then stored in one atomic step (a key is never published without its backup, nor a backup without its key)
    const withBackup = (req.body ?? {}).backup !== undefined;
    const backup = withBackup ? backupOf((req.body ?? {}).backup) : null;
    if (withBackup && !backup) {
      res.status(400).json({ error: "That is not a key backup" });
      return;
    }
    const existing = await keyCol(uid).get();
    const already = existing.docs.find((d) => d.id === id);
    if (!already && existing.docs.filter((d) => d.data().revoked !== true).length >= MAX_KEYS_PER_PERSON) {
      res.status(409).json({ error: `At most ${MAX_KEYS_PER_PERSON} devices can have a key` });
      return;
    }
    const ref = keyCol(uid).doc(id);
    const batch = getFirestore().batch();
    // `ownShared`: a key that is the first of the person has everything it needs; a key added next to another one waits until a device of the same person allows it (own-recovery.ts)
    const first = !existing.docs.some((d) => d.data().revoked !== true);
    batch.set(ref, already ? { label } : { publicKey: key, fingerprint, label, revoked: false, ownShared: first, createdAt: FieldValue.serverTimestamp() }, { merge: true });
    if (backup) batch.set(keyBackupDoc(uid), { ...backup, savedAt: FieldValue.serverTimestamp() });
    await batch.commit();
    // the answer is what is stored (read back), not what was sent
    res.status(already ? 200 : 201).json(publishedOf(id, (await ref.get()).data() ?? {}));
  }),
);

/** Retire a key of mine (a device that is lost or replaced): it is no longer used for new files. It cannot be turned back on. */
keysRouter.post(
  "/:id/revoke",
  asyncHandler(async (req, res) => {
    const ref = keyCol(uidOf(res)).doc(req.params.id);
    if (!(await ref.get()).exists) {
      res.status(404).json({ error: "Key not found" });
      return;
    }
    await ref.set({ revoked: true, revokedAt: FieldValue.serverTimestamp() }, { merge: true });
    res.json({ ok: true });
  }),
);

const B64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** Store the backup of the private key (scrambled on the device): `{ v: 1, iv, data }`, replacing an earlier one. */
keysRouter.put(
  "/backup",
  asyncHandler(async (req, res) => {
    const backup = backupOf(req.body);
    if (!backup) {
      res.status(400).json({ error: "That is not a key backup" });
      return;
    }
    await keyBackupDoc(uidOf(res)).set({ ...backup, savedAt: FieldValue.serverTimestamp() } satisfies Record<string, unknown>);
    res.json({ ok: true });
  }),
);

/** The backup, for restoring the key on a new device. */
keysRouter.get(
  "/backup",
  asyncHandler(async (_req, res) => {
    const snap = await keyBackupDoc(uidOf(res)).get();
    if (!snap.exists) {
      res.status(404).json({ error: "There is no backup" });
      return;
    }
    const d = snap.data() ?? {};
    res.json({ v: 1, iv: d.iv, data: d.data } satisfies KeyBackup);
  }),
);
