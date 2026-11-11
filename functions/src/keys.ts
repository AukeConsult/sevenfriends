import { Router } from "express";
import { DecodedIdToken } from "firebase-admin/auth";
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import { asyncHandler, requireAuth } from "./auth";
import { MyKeys, KeyBackup, MAX_KEYS_PER_PERSON, MAX_KEY_LABEL, PublicKeyJwk, PublishedKey, SignKeyJwk, DeviceList, canonicalPublicKey, canonicalSignKey, checkedDeviceList, deviceListHash, fingerprintOf, keyIdOf } from "./models";
import { openRequest } from "./own-request";
import { keyBackupDoc, keyCol, keyListCol } from "./paths";
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
  ...(data.signKey ? { signKey: data.signKey as SignKeyJwk } : {}),
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
    // a NEW key may come with the public signing key of the same device (ECDSA P-256); a key already published never gets one later: an older lock stays as it is
    const rawSign = (req.body ?? {}).signKey;
    const signKey = rawSign === undefined ? null : canonicalSignKey(rawSign);
    if (rawSign !== undefined && !signKey) {
      res.status(400).json({ error: "That is not a P-256 signing key" });
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
    batch.set(ref, already ? { label } : { publicKey: key, ...(signKey ? { signKey } : {}), fingerprint, label, revoked: false, ownShared: first, createdAt: FieldValue.serverTimestamp() }, { merge: true });
    if (backup) batch.set(keyBackupDoc(uid), { ...backup, savedAt: FieldValue.serverTimestamp() });
    await batch.commit();
    // a key added next to other keys waits for a device of mine to allow it: that is a request, shown on my other devices (docs/design/recovery-own-devices.md)
    if (!already && !first) await openRequest(uid, { id, label, fingerprint });
    // the answer is what is stored (read back), not what was sent
    res.status(already ? 200 : 201).json(publishedOf(id, (await ref.get()).data() ?? {}));
  }),
);

/** My signed device lists, every version, oldest first (the app and my friends check the chain; the server only keeps it). */
keysRouter.get(
  "/list",
  asyncHandler(async (_req, res) => {
    const snap = await keyListCol(uidOf(res)).get();
    const lists = snap.docs
      .map((d) => ({ ...(d.data() as DeviceList), createdAt: d.data().createdAt instanceof Timestamp ? d.data().createdAt.toDate().toISOString() : null }))
      .sort((a, b) => a.version - b.version);
    res.json({ lists });
  }),
);

/**
 * Publish the next version of my device list. Append-only: the version must be one more than the newest (1 when there is none), `prev` must be the
 * hash of the newest, and a version that exists is never replaced. The server checks the STRUCTURE (well-formed keys, key IDs that fit, a
 * signer); it cannot and does not check the signature. Devices do that, so a list the server made up would be refused by them.
 */
keysRouter.post(
  "/list",
  asyncHandler(async (req, res) => {
    const uid = uidOf(res);
    const checked = await checkedDeviceList(req.body);
    if ("problem" in checked) {
      res.status(400).json({ error: checked.problem });
      return;
    }
    const list = checked.list;
    const [newest, published] = await Promise.all([keyListCol(uid).orderBy("version", "desc").limit(1).get(), keyCol(uid).get()]);
    const head = newest.docs[0]?.data() as DeviceList | undefined;
    let refusal: string | null = null;
    // every device of the list is a key of this person that is in use, with exactly these public keys (a list can not name a key that was never published)
    const inUse = new Map(published.docs.filter((d) => d.data().revoked !== true).map((d) => [d.id, d.data()]));
    const known = (d: DeviceList["devices"][number]) => {
      const k = inUse.get(d.keyId);
      return !!k && JSON.stringify(canonicalPublicKey(k.publicKey)) === JSON.stringify(d.lockKey) && JSON.stringify(canonicalSignKey(k.signKey)) === JSON.stringify(d.signKey);
    };
    if (list.version !== (head?.version ?? 0) + 1) refusal = "The version is not the next one";
    else if (head && list.prev !== (await deviceListHash(head))) refusal = "The link to the version before is wrong";
    else if (head && !head.devices.some((d) => d.keyId === list.signedBy)) refusal = "The signer is not a device of the version before";
    else if (!list.devices.every(known)) refusal = "A device in the list is not a published key of yours";
    else {
      try {
        await keyListCol(uid).doc(String(list.version)).create({ ...list, createdAt: FieldValue.serverTimestamp() }); // create: a version that exists is never replaced
      } catch {
        refusal = "The version is not the next one";
      }
    }
    if (refusal) {
      res.status(409).json({ error: refusal });
      return;
    }
    res.status(201).json(list);
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
