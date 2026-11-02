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
}

/** The feed of one connection. */
export interface Conversation {
  friend: { id: string; name: string };
  messages: ChatMessage[];
}
