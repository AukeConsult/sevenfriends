import { getFirestore } from "firebase-admin/firestore";
import {
  FRIEND_CIRCLE_COLLECTION,
  FRIEND_REQUEST_COLLECTION,
  INCOMING_SIGNAL_COLLECTION,
  MESSAGE_COLLECTION,
  PUSH_DEVICE_COLLECTION,
  USER_ACCOUNT_COLLECTION,
} from "./constants";

export const userDoc = (uid: string) => getFirestore().collection(USER_ACCOUNT_COLLECTION).doc(uid);
export const circleCol = (uid: string) => userDoc(uid).collection(FRIEND_CIRCLE_COLLECTION);
export const friendRequestCol = (uid: string) => userDoc(uid).collection(FRIEND_REQUEST_COLLECTION);
export const messageCol = (uid: string) => userDoc(uid).collection(MESSAGE_COLLECTION);
export const signalCol = (uid: string) => userDoc(uid).collection(INCOMING_SIGNAL_COLLECTION);
export const pushDeviceCol = (uid: string) => userDoc(uid).collection(PUSH_DEVICE_COLLECTION);
