import { ActiveCircleService } from './active-circle.service';
import { Injectable, inject } from '@angular/core';
import { BoxKeys, Safebox, SafeboxItem, fingerprintOf, keyIdOf } from '../models';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { classify, openFileKey, openMeta, openPart, sealFile, sealMeta } from './box-crypto';
import { getDeviceKey } from './device-key';
import { FriendsService } from './friends.service';
import { PreparedImage } from './image';
import { tr } from './i18n';

/** A file of the safebox read back from the server: where to show it (an object URL) and its type. */
export interface BoxFile {
  url: string;
  name: string | null;
  type: string;
}

/** The safebox of one friendship (the friend id is the connection id): files only the two friends see. */
@Injectable({ providedIn: 'root' })
export class SafeboxService {
  private readonly active = inject(ActiveCircleService);
  private readonly api = inject(ApiService);
  private readonly friends = inject(FriendsService);
  private readonly auth = inject(AuthService);
  /** the items as the server sent them (an encrypted one still has its `enc`), and the opened file keys of the encrypted ones */
  private readonly raw = new Map<string, SafeboxItem>();
  private readonly fileKeys = new Map<string, Promise<CryptoKey>>();
  /** the previews that were read (a file never changes under its id): kept while the app is open */
  private readonly previews = new Map<string, Promise<BoxFile>>();

  constructor() {
    // another circle: the files, the opened keys and the previews of the old circle are let go (the object URLs too)
    this.active.onSwitch(() => {
      this.raw.clear();
      this.fileKeys.clear();
      for (const preview of this.previews.values()) void preview.then((file) => URL.revokeObjectURL(file.url), () => undefined);
      this.previews.clear();
    });
  }

  private base(friendId: string): string {
    return `/circles/${this.friends.circle()?.id ?? this.active.id}/friends/${friendId}/safebox`;
  }

  /** The keys in use of me and of this friend: files can be locked only when both of us have one. */
  keys(friendId: string): Promise<BoxKeys> {
    return this.api.request<BoxKeys>(`${this.base(friendId)}/keys`);
  }

  async load(friendId: string): Promise<Safebox> {
    const box = await this.api.request<Safebox>(this.base(friendId));
    return { ...box, items: await Promise.all(box.items.map((item) => this.reveal(friendId, item))) };
  }

  /** The file key of an encrypted file, opened with the key of this device (kept while the app is open). */
  private fileKey(friendId: string, item: SafeboxItem): Promise<CryptoKey> {
    const id = `${friendId}/${item.id}`;
    let key = this.fileKeys.get(id);
    if (!key) {
      key = (async () => {
        const uid = this.auth.user()?.uid;
        const device = uid ? await getDeviceKey(uid) : null;
        const fingerprint = device ? await fingerprintOf(device.publicKey) : null;
        if (!device || !fingerprint) throw new Error(tr('core.thereIsNoEncryption', 'There is no encryption key on this device. Set one up (or restore it) in Settings → Keys.'));
        return openFileKey(item.enc!, keyIdOf(fingerprint), device.privateKey);
      })();
      this.fileKeys.set(id, key);
      key.catch(() => this.fileKeys.delete(id));
    }
    return key;
  }

  /** An item as the app shows it: an encrypted file gets its real name and type from inside (or the name "Locked file" when this device cannot open it). */
  private async reveal(friendId: string, item: SafeboxItem): Promise<SafeboxItem> {
    this.raw.set(`${friendId}/${item.id}`, item);
    if (!item.enc) return item;
    try {
      const meta = await openMeta(friendId, item.enc, await this.fileKey(friendId, item));
      return { ...item, name: meta.name, mime: meta.mime };
    } catch {
      return { ...item, name: tr('core.lockedFile', 'Locked file') };
    }
  }

  /** For a locked file that does not open: which keys it was locked for (mine), and the key of this device: shown on the file page so a failure can be explained. */
  async explain(friendId: string, itemId: string): Promise<{ lockedFor: string[]; thisDevice: string | null }> {
    const enc = (await this.rawItem(friendId, itemId))?.enc;
    const uid = this.auth.user()?.uid;
    const device = uid ? await getDeviceKey(uid) : null;
    const fingerprint = device ? await fingerprintOf(device.publicKey) : null;
    return { lockedFor: (enc?.wraps ?? []).map((w) => w.keyId.slice(0, 8)), thisDevice: fingerprint ? keyIdOf(fingerprint).slice(0, 8) : null };
  }

  /** The item as the server sent it (loads the box when it was not read yet). */
  private async rawItem(friendId: string, itemId: string): Promise<SafeboxItem | undefined> {
    if (!this.raw.has(`${friendId}/${itemId}`)) await this.load(friendId);
    return this.raw.get(`${friendId}/${itemId}`);
  }

  /**
   * Puts a file in the box. A picture comes with its small preview (made in the browser); anything else goes as it is.
   * With `keys` (both of us have a key) the file is locked on this device first, and only the locked file leaves it.
   */
  async add(friendId: string, file: Blob, name: string, thumb?: Blob, keys?: BoxKeys | null): Promise<SafeboxItem> {
    if (keys) return this.addEncrypted(friendId, file, name, thumb ?? null, keys);
    const item = await this.api.request<SafeboxItem>(`${this.base(friendId)}?name=${encodeURIComponent(name)}`, {
      method: 'POST',
      body: file,
      // always "unknown binary": the server finds the type from the bytes, and a .json file sent as application/json would be read as JSON by the server and arrive empty
      headers: { 'Content-Type': 'application/octet-stream' },
    });
    if (thumb && item.kind === 'image') {
      await this.api.request<void>(`${this.base(friendId)}/${item.id}/thumb`, { method: 'PUT', body: thumb, headers: { 'Content-Type': thumb.type } });
      return { ...item, hasThumb: true };
    }
    return item;
  }

  private async addEncrypted(friendId: string, file: Blob, name: string, thumb: Blob | null, keys: BoxKeys): Promise<SafeboxItem> {
    const me = this.auth.user()?.uid;
    if (!me) throw new Error(tr('core.notSignedIn', 'Not signed in'));
    const { kind, mime } = await classify(file, name);
    const body = await sealFile({
      connectionId: friendId,
      file,
      name,
      kind,
      mime,
      thumb: kind === 'image' ? thumb : null,
      recipients: [{ uid: me, keys: keys.mine }, { uid: keys.friendUid, keys: keys.friend }],
    });
    const item = await this.api.request<SafeboxItem>(`${this.base(friendId)}/encrypted`, { method: 'POST', body, headers: { 'Content-Type': 'application/octet-stream' } });
    return this.reveal(friendId, item);
  }

  /**
   * Locks a file that was put in the box unencrypted: reads it (and its preview), locks it on this device and sends it to take the place of the plain one
   * (the server keeps the owner and the date, and deletes the plain file only after the locked one is stored).
   */
  async encryptExisting(friendId: string, item: SafeboxItem, keys: BoxKeys): Promise<SafeboxItem> {
    const me = this.auth.user()?.uid;
    if (!me) throw new Error(tr('core.notSignedIn', 'Not signed in'));
    if (item.enc) return item;
    const file = (await this.api.file(`${this.base(friendId)}/${item.id}`)).blob;
    const thumb = item.hasThumb ? (await this.api.file(`${this.base(friendId)}/${item.id}/thumb`)).blob : null;
    const { kind, mime } = await classify(file, item.name);
    const body = await sealFile({ connectionId: friendId, file, name: item.name, kind, mime, thumb, recipients: [{ uid: me, keys: keys.mine }, { uid: keys.friendUid, keys: keys.friend }] });
    const locked = await this.api.request<SafeboxItem>(`${this.base(friendId)}/encrypted?replaces=${encodeURIComponent(item.id)}`, { method: 'POST', body, headers: { 'Content-Type': 'application/octet-stream' } });
    this.forget(friendId, item.id);
    return this.reveal(friendId, locked);
  }

  /** Moves the picture or video of a message of this conversation into the box (the message stays and says so). */
  addFromMessage(friendId: string, messageId: string): Promise<SafeboxItem> {
    return this.api.request<SafeboxItem>(`${this.base(friendId)}/from-message`, { method: 'POST', body: JSON.stringify({ messageId }) });
  }

  addImage(friendId: string, image: PreparedImage, keys?: BoxKeys | null): Promise<SafeboxItem> {
    return this.add(friendId, image.blob, image.name, image.thumb, keys);
  }

  async rename(friendId: string, itemId: string, name: string): Promise<SafeboxItem> {
    const raw = await this.rawItem(friendId, itemId);
    if (raw?.enc) {
      // the new name is locked here with the file key of the file: the server never sees it
      const key = await this.fileKey(friendId, raw);
      const meta = await openMeta(friendId, raw.enc, key);
      const sealed = await sealMeta(friendId, key, { name, mime: meta.mime });
      return this.reveal(friendId, await this.api.request<SafeboxItem>(`${this.base(friendId)}/${itemId}`, { method: 'PUT', body: JSON.stringify(sealed) }));
    }
    return this.api.request<SafeboxItem>(`${this.base(friendId)}/${itemId}`, { method: 'PUT', body: JSON.stringify({ name }) });
  }

  remove(friendId: string, itemId: string): Promise<void> {
    return this.api.request<void>(`${this.base(friendId)}/${itemId}`, { method: 'DELETE' });
  }

  /** The file (`thumb`: its small preview) as an object URL. Previews are kept; a whole file is read again each time it is opened. */
  async file(friendId: string, itemId: string, thumb = false): Promise<BoxFile> {
    const read = async (): Promise<BoxFile> => {
      const enc = (await this.rawItem(friendId, itemId))?.enc;
      const { blob, name } = await this.api.file(`${this.base(friendId)}/${itemId}${thumb ? '/thumb' : ''}`);
      if (!enc) return { url: URL.createObjectURL(blob), name, type: blob.type };
      // an encrypted file: opened here, in memory
      const raw = (await this.rawItem(friendId, itemId))!;
      const key = await this.fileKey(friendId, raw);
      const meta = await openMeta(friendId, enc, key);
      const type = thumb ? 'image/jpeg' : meta.mime;
      const plain = await openPart(friendId, enc, key, thumb ? 'thumb' : 'file', await blob.arrayBuffer());
      return { url: URL.createObjectURL(new Blob([plain], { type })), name: meta.name, type };
    };
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
    this.raw.delete(`${friendId}/${itemId}`);
    this.fileKeys.delete(`${friendId}/${itemId}`);
  }
}
