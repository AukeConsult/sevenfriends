import { CircleType } from "./models";

export const USER_ACCOUNT_COLLECTION = "user-account";
/** user-account/{uid}/friend-circle/{circleId}  – one document per circle */
export const FRIEND_CIRCLE_COLLECTION = "friend-circle";
/** user-account/{uid}/friend-circle/{circleId}/friends/{friendId} */
export const FRIENDS_SUBCOLLECTION = "friends";

export const MAX_FRIENDS = 7; // per circle

export const CIRCLE_TYPES: readonly CircleType[] = ["friends", "family", "colleagues"];
/** Types that can be created right now. */
export const AVAILABLE_CIRCLE_TYPES: readonly CircleType[] = ["friends"];

export const DEFAULT_CIRCLE_TYPE: CircleType = "friends";
export const DEFAULT_CIRCLE_ID = "default";
export const DEFAULT_CIRCLE_NAME = "My friends";

/** user-account/{uid}/friend-request/{friendId} – incoming requests for that user */
export const FRIEND_REQUEST_COLLECTION = "friend-request";

/** user-account/{uid}/messages/{messageId} – incoming messages for that user */
export const MESSAGE_COLLECTION = "messages";

/**
 * user-account/{uid}/incoming-signal/{connectionId}: a "ping" that somebody added this person as a
 * friend. It tells the person's frontend to run the ordinary search (the check). It holds no details.
 */
export const INCOMING_SIGNAL_COLLECTION = "incoming-signal";

export const MAX_NAME_LENGTH = 100; // display name

/** The moods (mood1.svg ... mood4.svg) and the short mood message a person can stick to their profile. */
export const MOOD_COUNT = 4;
export const MAX_MOOD_MESSAGE = 60;

/** The message a person can add to a friend request. */
export const MAX_REQUEST_MESSAGE = 500;

/**
 * Invitations to people without an account go by EMAIL only (there is no SMS provider: text messages are only used for
 * login codes, which Firebase sends itself). The backend writes `mail/{id}` in the format of the Firebase "Trigger Email"
 * extension ({ to, message: { subject, text } }), which sends it. It carries `fromUid`, so it is erased with the sender.
 */
export const MAIL_COLLECTION = "mail";
export const MAX_INVITES_PER_DAY = 20;

/**
 * user-account/{uid}/push-device/{id}: one document per phone / browser that wants push notifications
 * ({ token, createdAt, updatedAt }). The id is a hash of the token. Erased with the account.
 */
export const PUSH_DEVICE_COLLECTION = "push-device";

/**
 * user-account/{uid}/profile-picture/current: the picture the person uploaded ({ image: a data URL, updatedAt }). It is
 * kept in its own document so the (many) reads of the account document do not carry the image. Erased with the account.
 */
export const PROFILE_PICTURE_COLLECTION = "profile-picture";
export const PROFILE_PICTURE_DOC = "current";
/** The biggest picture kept (the app sends about 256 x 256 pixels, a JPEG of 15-50 KB). */
export const MAX_PICTURE_BYTES = 70 * 1024;
