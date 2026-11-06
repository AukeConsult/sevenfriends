import { MediaRef } from "./media";

/** An unread message, as listed on Home. */
export interface Message {
  id: string;
  fromName: string;
  text: string;
  /** when the message was sent */
  time: string | null;
  /** the connection it belongs to: /friends/:connectionId is its feed */
  connectionId: string | null;
}

/** The first web address of a message, and (when the site allows it) the address of its page to show in a frame. */
export interface MessageLink {
  url: string;
  /** what to show in a frame (the page itself, or the official player of a video / song); null = the site does not allow it: only the link */
  embedUrl: string | null;
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
  /** true = the text was changed after it was sent */
  edited: boolean;
  /** true = I hid the picture / video in my feed (my copy only: the friend's feed is not affected) */
  hidden: boolean;
  /** the first link of the text, or null */
  link: MessageLink | null;
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
