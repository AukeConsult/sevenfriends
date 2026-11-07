import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { MAX_PICTURE_BYTES } from "./constants";
import { profilePictureDoc, userDoc, userFields } from "./paths";
import { checkBytes, deleteObject, putObject, readAll } from "./sf-cache";

/**
 * A person's profile picture is an object of kind 'avatar' in the media cache; the account says which one (`avatarObjectId`)
 * and when it changed (`profilePictureAt`). The app still sends and gets it as a data URL (a small JPEG, PNG or WebP image).
 */
const PICTURE_URL = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/;

/** The picture as a data URL, or null when the person has none. */
export async function readAvatar(uid: string): Promise<string | null> {
  const account = await userFields(uid, "avatarObjectId");
  const id = account?.avatarObjectId as string | undefined;
  if (id) {
    const bytes = await readAll(uid, id);
    return bytes ? toDataUrl(bytes) : null;
  }
  // a picture saved before the media cache existed: move it there now
  const old = (await profilePictureDoc(uid).get()).data()?.image as string | undefined;
  const match = old ? PICTURE_URL.exec(old) : null;
  if (!match) return null;
  await saveAvatar(uid, Buffer.from(match[2], "base64"), false);
  await profilePictureDoc(uid).delete();
  return old!;
}

/** Why a data URL is not accepted as a picture (the message for the app), or the bytes. */
export function parsePicture(image: unknown): { bytes: Buffer } | { error: string } {
  const match = typeof image === "string" ? PICTURE_URL.exec(image) : null;
  if (!match) return { error: "The picture must be a JPEG, PNG or WebP image" };
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length > MAX_PICTURE_BYTES) return { error: `The picture is too big (at most ${Math.round(MAX_PICTURE_BYTES / 1024)} KB)` };
  const checked = checkBytes("avatar", bytes);
  return "error" in checked || checked.mime !== match[1] ? { error: "That is not a valid image" } : { bytes }; // the bytes must be the type the data URL says
}

/** Store a new picture (the type is found from the bytes), and remove the one it replaces. `changed`: also stamp the time friends fetch it again by. */
export async function saveAvatar(uid: string, bytes: Buffer, changed = true): Promise<void> {
  const checked = checkBytes("avatar", bytes) as { mime: string };
  const ref = userDoc(uid);
  const before = (await ref.get()).data()?.avatarObjectId as string | undefined;
  const objectId = getFirestore().collection("_").doc().id;
  await putObject(uid, objectId, bytes, "avatar", checked.mime);
  await ref.set({ avatarObjectId: objectId, ...(changed ? { profilePictureAt: FieldValue.serverTimestamp() } : {}) }, { merge: true });
  if (before) await deleteObject(uid, before);
}

/** Remove the picture. */
export async function removeAvatar(uid: string): Promise<void> {
  const ref = userDoc(uid);
  const before = (await ref.get()).data()?.avatarObjectId as string | undefined;
  await ref.set({ avatarObjectId: null, profilePictureAt: null, photoURL: null }, { merge: true });
  await profilePictureDoc(uid).delete();
  if (before) await deleteObject(uid, before);
}

function toDataUrl(bytes: Buffer): string {
  const type = checkBytes("avatar", bytes) as { mime: string };
  return `data:${type.mime};base64,${bytes.toString("base64")}`;
}
