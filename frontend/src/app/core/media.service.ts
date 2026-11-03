import { Injectable, inject } from '@angular/core';
import { MediaUpload } from '../models';
import { ApiService } from './api.service';
import { PreparedImage } from './image';

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
  async uploadImage(image: PreparedImage): Promise<MediaUpload> {
    const stored = await this.api.request<MediaUpload>(`/sf-cache?kind=image&name=${encodeURIComponent(image.name)}`, {
      method: 'POST',
      body: image.blob,
      headers: { 'Content-Type': image.blob.type || 'application/octet-stream' },
    });
    await this.api.request<void>(`/sf-cache/${stored.objectId}/thumb`, { method: 'PUT', body: image.thumb, headers: { 'Content-Type': image.thumb.type } });
    return stored;
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
