import { DocumentData, DocumentReference, getFirestore } from "firebase-admin/firestore";
import {
  FRIEND_CIRCLE_COLLECTION,
  GROUP_COLLECTION,
  FRIEND_REQUEST_COLLECTION,
  INCOMING_SIGNAL_COLLECTION,
  KEY_BACKUP_COLLECTION,
  KEY_BACKUP_DOC,
  KEY_COLLECTION,
  MESSAGE_COLLECTION,
  PROFILE_PICTURE_COLLECTION,
  PROFILE_PICTURE_DOC,
  PUSH_DEVICE_COLLECTION,
  RECOVERY_COLLECTION,
  SAFEBOX_COLLECTION,
  SAFEBOX_ITEMS,
  USER_ACCOUNT_COLLECTION,
} from "./constants";

/** safebox/{connectionId}/items: the files two friends share */
export const safeboxItems = (connectionId: string) => getFirestore().collection(SAFEBOX_COLLECTION).doc(connectionId).collection(SAFEBOX_ITEMS);
/** recovery-request/{connectionId} */
/** friend-group/{groupId}: a group and who is in it */
export const groupDoc = (groupId: string) => getFirestore().collection(GROUP_COLLECTION).doc(groupId);
export const recoveryDoc = (connectionId: string) => getFirestore().collection(RECOVERY_COLLECTION).doc(connectionId);
export const userDoc = (uid: string) => getFirestore().collection(USER_ACCOUNT_COLLECTION).doc(uid);
export const circleCol = (uid: string) => userDoc(uid).collection(FRIEND_CIRCLE_COLLECTION);
export const friendRequestCol = (uid: string) => userDoc(uid).collection(FRIEND_REQUEST_COLLECTION);
export const messageCol = (uid: string) => userDoc(uid).collection(MESSAGE_COLLECTION);
export const signalCol = (uid: string) => userDoc(uid).collection(INCOMING_SIGNAL_COLLECTION);
/** the public keys of a person's devices (the document id is the key ID) */
export const keyCol = (uid: string) => userDoc(uid).collection(KEY_COLLECTION);
/** the scrambled backup of the private key */
/** the requests of my devices to open my old messages for them (docs/design/recovery-own-devices.md) */
export const ownRequestCol = (uid: string) => userDoc(uid).collection("own-recovery-request");

export const keyBackupDoc = (uid: string) => userDoc(uid).collection(KEY_BACKUP_COLLECTION).doc(KEY_BACKUP_DOC);
export const pushDeviceCol = (uid: string) => userDoc(uid).collection(PUSH_DEVICE_COLLECTION);
/**
 * ONE document, but only some of its fields (a field mask): the rest is not sent to the function. Use it whenever a whole account or
 * message document is read for a few values (a name, a switch). `undefined` when the document does not exist, like `.data()`.
 */
export async function readFields(ref: DocumentReference, ...fields: string[]): Promise<DocumentData | undefined> {
  const [snap] = await getFirestore().getAll(ref, { fieldMask: fields });
  return snap.data();
}
/** Firestore says a query needs an index that does not exist (yet): it is created by `firebase deploy --only firestore:indexes` and takes a few minutes to build. */
export const missingIndex = (err: unknown): boolean => {
  const e = err as { code?: unknown; message?: unknown } | null;
  return e?.code === 9 || /FAILED_PRECONDITION|requires an index/i.test(String(e?.message ?? ""));
};
/** Some fields of a user-account document. */
export const userFields = (uid: string, ...fields: string[]) => readFields(userDoc(uid), ...fields);
export const profilePictureDoc = (uid: string) => userDoc(uid).collection(PROFILE_PICTURE_COLLECTION).doc(PROFILE_PICTURE_DOC);
