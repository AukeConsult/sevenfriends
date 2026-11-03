/** What can be kept in the media cache (Google Storage: sf-cache/<userid>/<objectid>). */
export type CacheKind = "image" | "video" | "audio" | "avatar" | "icon";

/** The kinds that can be sent in a message. */
export type MediaKind = "image" | "video" | "audio";

/** A file attached to a message. The file itself is read from `/api/sf-cache/<ownerId>/<objectId>` (and `.thumb` for the small picture). */
export interface MediaRef {
  /** who uploaded it: the folder in the cache */
  ownerId: string;
  objectId: string;
  kind: MediaKind;
  mime: string;
  /** the name of the file when it was uploaded (e.g. holiday.mp4), null = unknown */
  name: string | null;
  bytes: number;
  /** pixels, for an image or a video; the app uses them to reserve room before the file has loaded */
  width: number | null;
  height: number | null;
  /** length in milliseconds, for audio and video */
  durationMs: number | null;
  /** true = there is a small preview at `<objectId>.thumb` */
  hasThumb: boolean;
}

/** The answer to an upload (`POST /api/sf-cache?kind=...`): the file is stored, now it can be sent in a message. */
export interface MediaUpload {
  ownerId: string;
  objectId: string;
  kind: MediaKind;
  mime: string;
  name: string | null;
  bytes: number;
}

/** What a message carries to attach an uploaded file: the object id, plus what only the app knows about the file. */
export interface NewMedia {
  objectId: string;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
}
