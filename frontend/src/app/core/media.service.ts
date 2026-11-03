import { Injectable, inject } from '@angular/core';
import { MediaUpload } from '../models';
import { ApiService } from './api.service';
import { PreparedAudio } from './audio';
import { PreparedImage } from './image';
import { PreparedVideo } from './video';

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

/** Files in messages: uploading them, and reading them back from the media cache of the server. */
@Injectable({ providedIn: 'root' })
export class MediaService {
  private readonly api = inject(ApiService);
  private readonly files = new Map<string, Promise<StoredFile>>();

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
    await this.api.request<void>(`/sf-cache/${stored.objectId}/thumb`, { method: 'PUT', body: file.thumb, headers: { 'Content-Type': file.thumb.type } });
    return stored;
  }

  /** One request for a small file; a file over 8 MB goes in pieces (the server joins them), still through the API. */
  private async upload(kind: 'image' | 'video' | 'audio', blob: Blob, name: string, progress?: Progress): Promise<MediaUpload> {
    const query = `kind=${kind}&name=${encodeURIComponent(name)}`;
    if (blob.size <= CHUNK_BYTES) {
      return this.api.request<MediaUpload>(`/sf-cache?${query}`, { method: 'POST', body: blob, headers: { 'Content-Type': blob.type || 'application/octet-stream' } });
    }
    const { uploadId, chunkBytes } = await this.api.request<{ uploadId: string; chunkBytes: number }>('/sf-cache/uploads', { method: 'POST' });
    const parts = Math.ceil(blob.size / chunkBytes);
    for (let n = 0; n < parts; n++) {
      progress?.(n, parts);
      await this.api.request<void>(`/sf-cache/uploads/${uploadId}/${n}`, {
        method: 'PUT',
        body: blob.slice(n * chunkBytes, (n + 1) * chunkBytes),
        headers: { 'Content-Type': 'application/octet-stream' },
      });
    }
    progress?.(parts, parts);
    return this.api.request<MediaUpload>(`/sf-cache/uploads/${uploadId}/finish?${query}&parts=${parts}`, { method: 'POST' });
  }

  /**
   * `getObject(userid/objectid)`: reads the file from the server (`name` is the object id, or `<object id>.thumb` for the small preview).
   * A file never changes under its name, so one that was read is kept for as long as the app is open.
   */
  object(ownerId: string, name: string): Promise<StoredFile> {
    const key = `${ownerId}/${name}`;
    let file = this.files.get(key);
    if (!file) {
      file = this.api.file(`/sf-cache/${key}`).then(({ blob, name: fileName }) => ({ url: URL.createObjectURL(blob), name: fileName, type: blob.type, bytes: blob.size }));
      this.files.set(key, file);
      file.catch(() => this.files.delete(key)); // the next time, it asks again
    }
    return file;
  }
}
