export const USER_ACCOUNT_COLLECTION = "user-account";
/** user-account/{uid}/friend-circle/{circleId}  – one document per circle */
export const FRIEND_CIRCLE_COLLECTION = "friend-circle";
/** user-account/{uid}/friend-circle/{circleId}/friends/{friendId} */
export const FRIENDS_SUBCOLLECTION = "friends";

export const MAX_FRIENDS = 7; // per circle

export const CIRCLE_TYPES = ["friends", "family", "colleagues"] as const;
export type CircleType = (typeof CIRCLE_TYPES)[number];
/** Types that can be created right now. */
export const AVAILABLE_CIRCLE_TYPES: readonly CircleType[] = ["friends"];

export const DEFAULT_CIRCLE_TYPE: CircleType = "friends";
export const DEFAULT_CIRCLE_ID = "default";
export const DEFAULT_CIRCLE_NAME = "My friends";

/** user-account/{uid}/friend-request/{friendId} – incoming requests for that user */
export const FRIEND_REQUEST_COLLECTION = "friend-request";
export type FriendStatus = "pending" | "confirmed" | "rejected";

/** user-account/{uid}/messages/{messageId} – incoming messages for that user */
export const MESSAGE_COLLECTION = "messages";
