import { Injectable, inject } from '@angular/core';
import { Safebox, SafeboxItem } from '../models';
import { ApiService } from './api.service';
import { FriendsService } from './friends.service';
import { PreparedImage } from './image';

/** A file of the safebox read back from the server: where to show it (an object URL) and its type. */
export interface BoxFile {
  url: string;
  name: string | null;
  type: string;
}

/** The safebox of one friendship (the friend id is the connection id): files only the two friends see. */
@Injectable({ providedIn: 'root' })
export class SafeboxService {
  private readonly api = inject(ApiService);
  private readonly friends = inject(FriendsService);
  /** the previews that were read (a file never changes under its id): kept while the app is open */
  private readonly previews = new Map<string, Promise<BoxFile>>();

  private base(friendId: string): string {
    return `/circles/${this.friends.circle()?.id ?? 'default'}/friends/${friendId}/safebox`;
  }

  load(friendId: string): Promise<Safebox> {
    return this.api.request<Safebox>(this.base(friendId));
  }

  /** Puts a file in the box. A picture comes with its small preview (made in the browser); anything else goes as it is. */
  async add(friendId: string, file: Blob, name: string, thumb?: Blob): Promise<SafeboxItem> {
    const item = await this.api.request<SafeboxItem>(`${this.base(friendId)}?name=${encodeURIComponent(name)}`, {
      method: 'POST',
      body: file,
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
    });
    if (thumb && item.kind === 'image') {
      await this.api.request<void>(`${this.base(friendId)}/${item.id}/thumb`, { method: 'PUT', body: thumb, headers: { 'Content-Type': thumb.type } });
      return { ...item, hasThumb: true };
    }
    return item;
  }

  addImage(friendId: string, image: PreparedImage): Promise<SafeboxItem> {
    return this.add(friendId, image.blob, image.name, image.thumb);
  }

  rename(friendId: string, itemId: string, name: string): Promise<SafeboxItem> {
    return this.api.request<SafeboxItem>(`${this.base(friendId)}/${itemId}`, { method: 'PUT', body: JSON.stringify({ name }) });
  }

  remove(friendId: string, itemId: string): Promise<void> {
    return this.api.request<void>(`${this.base(friendId)}/${itemId}`, { method: 'DELETE' });
  }

  /** The file (`thumb`: its small preview) as an object URL. Previews are kept; a whole file is read again each time it is opened. */
  async file(friendId: string, itemId: string, thumb = false): Promise<BoxFile> {
    const read = () =>
      this.api.file(`${this.base(friendId)}/${itemId}${thumb ? '/thumb' : ''}`).then(({ blob, name }) => ({ url: URL.createObjectURL(blob), name, type: blob.type }));
    if (!thumb) return read();
    const key = `${friendId}/${itemId}`;
    let preview = this.previews.get(key);
    if (!preview) {
      preview = read();
      this.previews.set(key, preview);
      preview.catch(() => this.previews.delete(key));
    }
    return preview;
  }

  /** Forget the kept preview of a file that was taken out. */
  forget(friendId: string, itemId: string): void {
    this.previews.delete(`${friendId}/${itemId}`);
  }
}
