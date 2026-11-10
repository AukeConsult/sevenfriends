import { ActiveCircleService } from './active-circle.service';
import { Injectable, inject } from '@angular/core';
import { MediaUpload, MessageEnc, MessageEncMedia } from '../models';
import { ApiError, ApiService } from './api.service';
import { AuthService } from './auth.service';
import { MessageMediaMeta, openMessageKey, openMessageMedia, openMessageMeta, sealMessageMedia } from './box-crypto';
import { myDeviceKey } from './my-key';
import { PreparedAudio } from './audio';
import { PreparedImage } from './image';
import { PreparedVideo } from './video';
import { tr } from './i18n';

/** The pieces of a big upload: `done` of `total` have been sent. */
export type Progress = (done: number, total: number) => void;

/** Files up to this size are sent in one request (the server's piece size is the same). */
const CHUNK_BYTES = 8 * 1024 * 1024;

/** A file read from the media cache: where to show it (an object URL), and what the server says about it. */
export interface StoredFile {
  url: string;
  name: string | null;
  type: string;
  bytes: number;
}

/** A locked file of a message: which friendship it belongs to and the locked message (with my copies of the message key), to open the file with. */
interface LockedEntry {
  friendId: string;
  enc: MessageEnc;
}

const LOCKED_STORE = 'sf-locked-media';

/** Files in messages: uploading them, and reading them back from the media cache of the server. A file of a locked message is locked on the sender's device and opened on the reader's. */
@Injectable({ providedIn: 'root' })
export class MediaService {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly files = new Map<string, Promise<StoredFile>>();
  /** the files that are locked (by `ownerId/objectId`), told by the conversation when it opens the messages; kept for this tab so the full-size page can open them after a reload */
  private locked: Map<string, LockedEntry> | null = null;
  private storing = false;

  constructor() {
    // another circle: the files that were read, and the list of locked files, belong to the old circle
    inject(ActiveCircleService).onSwitch(() => {
      this.files.clear();
      this.locked = new Map();
      try { sessionStorage.removeItem(LOCKED_STORE); } catch { /* no storage */ }
    });
  }

  /** Sends the image and its small preview to the server, which stores them in the cache. The answer says where (owner and object id). */
  async uploadImage(image: PreparedImage, progress?: Progress): Promise<MediaUpload> {
    return this.uploadWithPreview('image', image, progress);
  }

  /** The same for a video (already made small in the browser): a big one goes in pieces, so the progress can be shown. */
  async uploadVideo(video: PreparedVideo, progress?: Progress): Promise<MediaUpload> {
    return this.uploadWithPreview('video', video, progress);
  }

  /** The same for audio (a recorded voice, or a chosen file as it is): no preview picture. */
  async uploadAudio(audio: PreparedAudio, progress?: Progress): Promise<MediaUpload> {
    return this.upload('audio', audio.blob, audio.name, progress);
  }

  private async uploadWithPreview(kind: 'image' | 'video', file: PreparedImage, progress?: Progress): Promise<MediaUpload> {
    const stored = await this.upload(kind, file.blob, file.name, progress);
    await this.at('the preview', () => this.api.request<void>(`/sf-cache/${stored.objectId}/thumb`, { method: 'PUT', body: file.thumb, headers: { 'Content-Type': file.thumb.type } }));
    return stored;
  }

  /** Runs one step of an upload; a failure of the server (500 or more) says which step it was, so it can be found in the log. */
  private async at<T>(step: string, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (err) {
      throw err instanceof ApiError && err.status >= 500 ? new ApiError(`${err.message} (${step})`, err.status) : err;
    }
  }

  /** One request for a small file; a file over 8 MB goes in pieces (the server joins them), still through the API. */
  private async upload(kind: 'image' | 'video' | 'audio', blob: Blob, name: string, progress?: Progress, locked = false): Promise<MediaUpload> {
    const query = `kind=${kind}&name=${encodeURIComponent(name)}${locked ? '&locked=1' : ''}`;
    if (blob.size <= CHUNK_BYTES) {
      return this.at('uploading the file', () => this.api.request<MediaUpload>(`/sf-cache?${query}`, { method: 'POST', body: blob, headers: { 'Content-Type': blob.type || 'application/octet-stream' } }));
    }
    const { uploadId, chunkBytes } = await this.at('starting the upload', () => this.api.request<{ uploadId: string; chunkBytes: number }>('/sf-cache/uploads', { method: 'POST' }));
    const parts = Math.ceil(blob.size / chunkBytes);
    for (let n = 0; n < parts; n++) {
      progress?.(n, parts);
      await this.at(`piece ${n + 1} of ${parts}`, () =>
        this.api.request<void>(`/sf-cache/uploads/${uploadId}/${n}`, {
          method: 'PUT',
          body: blob.slice(n * chunkBytes, (n + 1) * chunkBytes),
          headers: { 'Content-Type': 'application/octet-stream' },
        }),
      );
    }
    progress?.(parts, parts);
    return this.at('joining the pieces', () => this.api.request<MediaUpload>(`/sf-cache/uploads/${uploadId}/finish?${query}&parts=${parts}`, { method: 'POST' }));
  }

  /**
   * Locks a picture, video or voice with the key of its message on this device and uploads only the locked file (and its locked preview). The name, type,
   * size in pixels and length go inside the lock. Returns what the server stored and what the message must carry (`enc.media`).
   */
  async uploadLocked(kind: 'image' | 'video' | 'audio', file: PreparedImage | PreparedVideo | PreparedAudio, connectionId: string, key: CryptoKey, progress?: Progress): Promise<{ upload: MediaUpload; media: MessageEncMedia }> {
    const meta: MessageMediaMeta = {
      name: file.name,
      mime: file.blob.type || (kind === 'image' ? 'image/jpeg' : kind === 'video' ? 'video/mp4' : 'audio/webm'),
      width: 'width' in file ? file.width : null,
      height: 'height' in file ? file.height : null,
      durationMs: 'durationMs' in file ? file.durationMs : null,
    };
    const sealed = await sealMessageMedia(connectionId, key, { file: file.blob, thumb: 'thumb' in file ? file.thumb : null, meta });
    const upload = await this.upload(kind, sealed.file, '', progress, true);
    if (sealed.thumb) await this.at('the preview', () => this.api.request<void>(`/sf-cache/${upload.objectId}/thumb?locked=1`, { method: 'PUT', body: sealed.thumb!, headers: { 'Content-Type': 'application/octet-stream' } }));
    return { upload, media: sealed.media };
  }

  /** The conversation tells which files are locked (the locked message, with my copies of its key): they are opened here when they are read. */
  registerLocked(friendId: string, ownerId: string, objectId: string, enc: MessageEnc): void {
    const known = this.lockedFiles();
    const before = known.get(`${ownerId}/${objectId}`);
    // a newer copy of the message with more key copies (after a recovery) replaces the old one, so the file opens with it
    if (before && before.enc.wraps.length >= enc.wraps.length) return;
    known.set(`${ownerId}/${objectId}`, { friendId, enc });
    if (!this.storing) {
      this.storing = true;
      queueMicrotask(() => {
        this.storing = false;
        try {
          sessionStorage.setItem(LOCKED_STORE, JSON.stringify([...known]));
        } catch {
          /* no storage: the full-size page then needs the conversation opened first */
        }
      });
    }
  }

  private lockedFiles(): Map<string, LockedEntry> {
    if (!this.locked) {
      try {
        this.locked = new Map(JSON.parse(sessionStorage.getItem(LOCKED_STORE) ?? '[]') as [string, LockedEntry][]);
      } catch {
        this.locked = new Map();
      }
    }
    return this.locked;
  }

  /** A locked file (or preview) opened on this device. */
  private async openLocked(entry: LockedEntry, blob: Blob, thumb: boolean): Promise<StoredFile> {
    const mine = await myDeviceKey(this.auth.user()?.uid);
    if (!mine) throw new Error(tr('core.thereIsNoEncryption', 'There is no encryption key on this device. Set one up (or restore it) in Settings → Privacy lock.'));
    const media = entry.enc.media;
    if (!media) throw new Error(tr('core.thisFileCouldNot2', 'This file could not be opened.'));
    const key = await openMessageKey(entry.enc, mine.keyId, mine.privateKey);
    const meta = await openMessageMeta(entry.friendId, media, key);
    const plain = await openMessageMedia(entry.friendId, media, key, thumb ? 'thumb' : 'file', await blob.arrayBuffer());
    const type = thumb ? 'image/jpeg' : meta.mime;
    const opened = new Blob([plain], { type });
    return { url: URL.createObjectURL(opened), name: thumb ? null : meta.name, type, bytes: opened.size };
  }

  /**
   * `getObject(userid/objectid)`: reads the file from the server (`name` is the object id, or `<object id>.thumb` for the small preview).
   * A file never changes under its name, so one that was read is kept for as long as the app is open.
   */
  object(ownerId: string, name: string): Promise<StoredFile> {
    const key = `${ownerId}/${name}`;
    let file = this.files.get(key);
    if (!file) {
      const locked = this.lockedFiles().get(`${ownerId}/${name.replace(/\.thumb$/, '')}`);
      file = this.api.file(`/sf-cache/${key}`).then(({ blob, name: fileName }) => {
        if (locked) return this.openLocked(locked, blob, name.endsWith('.thumb'));
        if (blob.type === 'application/octet-stream') throw new Error(tr('core.thisFileIsLocked', 'This file is locked. Open the conversation first, then try again.'));
        return { url: URL.createObjectURL(blob), name: fileName, type: blob.type, bytes: blob.size };
      });
      this.files.set(key, file);
      file.catch(() => this.files.delete(key)); // the next time, it asks again
    }
    return file;
  }
}
