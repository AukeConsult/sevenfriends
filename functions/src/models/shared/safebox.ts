/** What a file in a safebox is. */
export type SafeboxKind = "image" | "video" | "audio" | "document";

/** One file in the safebox two friends share. The file is read from `/api/circles/default/friends/<friendId>/safebox/<id>` (and `/thumb` for the small picture). */
export interface SafeboxItem {
  id: string;
  /** the name of the file (can be changed by both friends) */
  name: string;
  kind: SafeboxKind;
  mime: string;
  bytes: number;
  /** who saved the file in the box (the user id of its owner; the encryption will use this person's key) */
  ownerId: string;
  /** true = I put it in the box */
  mine: boolean;
  createdAt: string | null;
  /** true = there is a small preview at `/thumb` */
  hasThumb: boolean;
}

/** What the safebox of one friendship holds, and its limits. */
export interface Safebox {
  items: SafeboxItem[];
  usedBytes: number;
  /** the whole box may hold this many bytes */
  maxBytes: number;
  /** one file may be this big */
  maxFileBytes: number;
}
