/** One message of a group that some member has no copy of yet (see docs/design/groups.md, "History of the messages"). */
export interface GroupHistoryItem {
  id: string;
  /** MY copies of the message key (my device can open those); empty for a text that is not locked */
  wraps: { uid: string; keyId: string; wrappedKey: string }[];
  /** a locked message: the keys in use of the members who have no copy yet, each to be given a copy of the message key */
  missing: { uid: string; keyId: string }[];
  /** a text that is not locked: the members who have no copy yet (the server copies it, nothing is locked) */
  plain: string[];
}

/** GET .../history/todo?after=<cursor>: the next messages (newest first, 50 looked at) that lack a copy for a member; `next` = continue after this cursor, null = all looked at. */
export interface GroupHistoryTodo {
  items: GroupHistoryItem[];
  next: string | null;
}
