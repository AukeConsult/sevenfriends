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

/** A message in the feed of one connection. */
export interface ChatMessage {
  id: string;
  text: string;
  /** true = I wrote it */
  mine: boolean;
  read: boolean;
  time: string | null;
  /** true = the text was changed after it was sent */
  edited: boolean;
}

/** The feed of one connection. */
export interface Conversation {
  friend: { id: string; name: string };
  messages: ChatMessage[];
}

/** Which of my messages to delete in one go (`POST .../messages/delete`). Both fields narrow it down; none = all of them. */
export interface MessageDeleteCriteria {
  /** only messages older than this many days; absent = no age limit */
  olderThanDays?: number | null;
  /** only messages that contain this text (any capitals); absent = any text */
  contains?: string | null;
  /** true = only count what would be deleted */
  dryRun?: boolean;
}

/** What `POST .../messages/delete` did: how many of my messages matched, and how many were deleted (0 for a dry run). */
export interface MessageDeleteResult {
  matched: number;
  deleted: number;
}
