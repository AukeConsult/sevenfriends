import { MediaRef } from "./media";
import { SafeboxWrap } from "./safebox";

/** The reactions a person can give a message (one per person per message). The ids are saved; the emoji is only the picture. */
export const REACTIONS = [
  { id: "thumbsUp", emoji: "👍" },
  { id: "laugh", emoji: "😂" },
  { id: "wow", emoji: "😮" },
  { id: "sad", emoji: "😢" },
  { id: "thanks", emoji: "🙏" },
  { id: "love", emoji: "❤️" },
] as const;
export type ReactionId = (typeof REACTIONS)[number]["id"];

/** An unread message, as listed on Home. */
export interface Message {
  id: string;
  fromName: string;
  text: string;
  /** when the message was sent */
  time: string | null;
  /** the connection it belongs to: /friends/:connectionId is its feed */
  connectionId: string | null;
  /** the circle this conversation belongs to (for the circle of the person who reads it) */
  circleId: string;
}

/** The first web address of a message, and (when the site allows it) the address of its page to show in a frame. */
export interface MessageLink {
  url: string;
  /** what to show in a frame (the page itself, or the official player of a video / song); null = the site does not allow it: only the link */
  embedUrl: string | null;
}

/**
 * What makes the text of a message locked (design: docs/design/message-encryption.md). The text is AES-256-GCM with one random key for this message
 * (base64, in the `text` field in place of the plain text); `wraps` are the copies of that key, one for every key in use of both friends (the same
 * shape as in the safebox). In a message sent to the app `wraps` holds only the copies for the reader.
 */
export interface MessageEnc {
  v: 1;
  /** the iv of the text (12 bytes, base64) */
  iv: string;
  wraps: SafeboxWrap[];
  /** set when the picture, video or voice of the message is locked too (with the same message key): the ivs and the locked name, type and size */
  media?: MessageEncMedia;
}

/** The locked file of a message: the file and its preview are stored as ciphertext; the name, type, size in pixels and length are locked inside `meta`. */
export interface MessageEncMedia {
  /** the iv of the file (12 bytes, base64) */
  iv: string;
  /** the iv of the preview, or null = no preview */
  thumbIv: string | null;
  /** the iv and the locked data of the meta ({ name, mime, width, height, durationMs }) */
  metaIv: string;
  meta: string;
}

/** A message in the feed of one connection. */
export interface ChatMessage {
  id: string;
  /** the text; for a message with a file it is the caption and may be empty */
  text: string;
  /** the attached file, or null */
  media: MediaRef | null;
  /** true = I wrote it */
  mine: boolean;
  read: boolean;
  time: string | null;
  /** in a GROUP feed: who wrote it (their user id and the name they gave), so every message shows its writer; absent in a feed with one friend */
  fromUid?: string;
  fromName?: string;
  /** true = the text was changed after it was sent */
  edited: boolean;
  /** true = I hid the picture / video in my feed (my copy only: the friend's feed is not affected) */
  hidden: boolean;
  /** true = the picture or video of this message was moved to the safebox: the message stays and says so, the file is no longer here */
  inBox?: boolean;
  /** the first link of the text, or null */
  link: MessageLink | null;
  /** the reactions to this message: how many people chose each one (a reaction carries no text, so it is never locked) */
  reactions?: Partial<Record<ReactionId, number>>;
  /** the reaction I chose, or null */
  myReaction?: ReactionId | null;
  /** set when the text is locked: `text` is then the locked text (base64) and this holds the iv and MY copies of the message key (see MessageEnc) */
  enc?: MessageEnc;
}

/** The feed of one connection. */
export interface Conversation {
  friend: { id: string; name: string };
  messages: ChatMessage[];
}

/** Which messages of a conversation to delete in one go (`POST .../messages/delete`). The fields narrow it down; none = all of MY messages. */
export interface MessageDeleteCriteria {
  /** whose messages: 'mine' (default) = the ones I wrote; 'both' = mine and the friend's. Never the friend's alone. Either way both people's copies are deleted. */
  whose?: "mine" | "both";
  /** only messages older than this many days; absent = no age limit */
  olderThanDays?: number | null;
  /** only messages that contain this text (any capitals); absent = any text */
  contains?: string | null;
  /** true = only count what would be deleted */
  dryRun?: boolean;
}

/** What `POST .../messages/delete` did: how many messages matched, and how many were deleted (0 for a dry run). */
export interface MessageDeleteResult {
  matched: number;
  deleted: number;
}
