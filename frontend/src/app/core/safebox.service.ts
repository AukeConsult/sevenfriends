import { ActiveCircleService } from './active-circle.service';
import { Injectable, inject, signal } from '@angular/core';
import { BoxKeys, GroupShareItem, NotePayload, ObjectPayload, PersonKeyLists, ReminderRequest, SafeboxType, Safebox, SafeboxItem, fingerprintOf, keyIdOf, recipientsOf } from '../models';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { dueRange, isObjectType, summaryOf, whenOf } from './safebox-objects';
import { BoxHead, classify, needsBody, openFileKey, openHead, openMeta, openNote, openObject, openPart, resealNote, resealObject, rewrapKey, sealFile, sealMeta, sealNote, sealObject } from './box-crypto';
import { myDeviceKey } from './my-key';
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
  /** An item that was NOT saved (the page was left, or the save failed): shown on the list so the person knows. Cleared when the person closes it or an item is saved. */
  readonly unsaved = signal<{ title: string; reason: string } | null>(null);
  private readonly raw = new Map<string, SafeboxItem>();
  private readonly fileKeys = new Map<string, Promise<CryptoKey>>();
  /** the previews that were read (a file never changes under its id): kept while the app is open */
  private readonly previews = new Map<string, Promise<BoxFile>>();
  /** the first line of each opened note, for the list (kept with the items: a note is opened once when the box is read) */
  private readonly snippets = new Map<string, string>();
  /** the links between items, by friend: the id of the record (a `relation` item) and the two items it joins */
  private readonly relations = new Map<string, Map<string, { a: string; b: string }>>();
  /** when each date and ticket is, for the list and the badges */
  private readonly whens = new Map<string, string>();
  /** when each item with a date is due (from the start of its reminder period to the end of its day) */
  private readonly dues = new Map<string, { from: number; to: number } | null>();

  constructor() {
    // another circle: the files, the opened keys and the previews of the old circle are let go (the object URLs too)
    this.active.onSwitch(() => {
      this.raw.clear();
      this.fileKeys.clear();
      this.snippets.clear();
      this.relations.clear();
      for (const preview of this.previews.values()) void preview.then((file) => URL.revokeObjectURL(file.url), () => undefined);
      this.previews.clear();
    });
  }

  private base(friendId: string): string {
    return `/circles/${this.friends.circle()?.id ?? this.active.id}/friends/${friendId}/safebox`;
  }

  /** The signed device lists of the other people of this friend or group (checked and pinned by `FriendListsService`). */
  keyLists(friendId: string): Promise<{ people: PersonKeyLists[] }> {
    return this.api.request<{ people: PersonKeyLists[] }>(`${this.base(friendId)}/key-lists`);
  }

  /** The keys in use of me and of this friend: files can be locked only when both of us have one. */
  keys(friendId: string): Promise<BoxKeys> {
    return this.api.request<BoxKeys>(`${this.base(friendId)}/keys`);
  }

  /**
   * A group: what is already in the box is locked for the keys that were there when it was saved. When somebody joined (or made a new key) their keys have no copy yet:
   * this device opens each item's key with its own key and locks it again for every key that lacks one, and the server files the copies. Quiet and safe to repeat (nothing
   * is done when nothing is missing); one member's device is enough. Returns how many items got a copy (0 when this device has no key or nothing was missing).
   */
  async shareWithMembers(friendId: string, keys: BoxKeys): Promise<number> {
    const mine = await myDeviceKey(this.auth.user()?.uid);
    if (!mine) return 0;
    const publicKeys = new Map(recipientsOf(mine.uid, keys).flatMap((p) => p.keys.map((k) => [`${p.uid}/${k.id}`, { uid: p.uid, key: k }] as const)));
    let total = 0;
    for (let round = 0; round < 20; round++) {
      const todo = await this.api.request<{ items: GroupShareItem[] }>(`${this.base(friendId)}/share-todo`);
      const items: { id: string; wraps: Awaited<ReturnType<typeof rewrapKey>>[] }[] = [];
      for (const item of todo.items) {
        const wraps: Awaited<ReturnType<typeof rewrapKey>>[] = [];
        for (const m of item.missing) {
          const target = publicKeys.get(`${m.uid}/${m.keyId}`);
          if (!target) continue; // a key that came after the keys were read: the next round
          try {
            wraps.push(await rewrapKey({ wraps: item.wraps }, mine.keyId, mine.privateKey, target, 'file'));
          } catch {
            break; // this device cannot open this item (it was locked for another device)
          }
        }
        if (wraps.length) items.push({ id: item.id, wraps });
      }
      if (!items.length) break;
      total += (await this.api.request<{ added: number }>(`${this.base(friendId)}/share`, { method: 'POST', body: JSON.stringify({ items }) })).added;
      if (todo.items.length < 100) break; // that was all of it
    }
    return total;
  }

  async load(friendId: string): Promise<Safebox> {
    const box = await this.api.request<Safebox>(this.base(friendId));
    this.relations.delete(friendId); // read again with the items
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
        if (!device || !fingerprint) throw new Error(tr('core.thereIsNoEncryption', 'There is no encryption key on this device. Set one up (or restore it) in Settings → Privacy lock.'));
        return openFileKey(item.enc!, keyIdOf(fingerprint), device.privateKey);
      })();
      this.fileKeys.set(id, key);
      key.catch(() => this.fileKeys.delete(id));
    }
    return key;
  }

  /** An item as the app shows it: an encrypted file gets its real name and type from inside (or the name "Locked file" when this device cannot open it). */
  private async reveal(friendId: string, item: SafeboxItem): Promise<SafeboxItem> {
    // kept without the whole content of a note or object (it is read again when the item is opened), so big contents do not stay in memory
    if (item.enc?.body) { const { body: _body, ...enc } = item.enc; this.raw.set(`${friendId}/${item.id}`, { ...item, enc }); }
    else this.raw.set(`${friendId}/${item.id}`, item);
    if (!item.enc) return item;
    if (item.type !== 'file' && item.type !== 'relation' && item.enc.bodyIv) {
      // a note or object made by the newer app: the list has only its small head (title, a line, the date); the whole content is read when it is opened
      try {
        const head = await openHead(friendId, item.enc, await this.fileKey(friendId, item));
        this.snippets.set(`${friendId}/${item.id}`, head?.line ?? '');
        this.whens.set(`${friendId}/${item.id}`, head?.when ?? '');
        if (head?.due) this.dues.set(`${friendId}/${item.id}`, head.due);
        else if (DATED_TYPES.includes(item.type)) this.dues.delete(`${friendId}/${item.id}`); // made before heads said when it is due: read once by `loadDues`
        else this.dues.set(`${friendId}/${item.id}`, null);
        return { ...item, name: head?.title ?? '' };
      } catch {
        return { ...item, name: item.type === 'note' ? tr('core.lockedNote', 'Locked note') : tr('core.lockedItem', 'Locked item') };
      }
    }
    if (item.type === 'note') {
      // a note has no file: its title and text are inside; the list shows the title (as the name) and the first line
      try {
        const note = await openNote(friendId, item.enc, await this.fileKey(friendId, item));
        this.snippets.set(`${friendId}/${item.id}`, firstLine(note.text));
        return { ...item, name: note.title };
      } catch {
        return { ...item, name: tr('core.lockedNote', 'Locked note') };
      }
    }
    if (item.type === 'relation') {
      // "A is linked with B": never shown as an item, it only joins two
      try {
        const object = await openObject(friendId, item.enc, await this.fileKey(friendId, item));
        const map = this.relations.get(friendId) ?? new Map();
        map.set(item.id, { a: object.fields['from'] ?? '', b: object.fields['to'] ?? '' });
        this.relations.set(friendId, map);
      } catch { /* a link that cannot be read is left out */ }
      return { ...item, name: 'Link' };
    }
    if (isObjectType(item.type)) {
      // a secret, link, checklist ...: the title and fields are inside; the list shows the title and a short line made from the fields
      try {
        const object = await openObject(friendId, item.enc, await this.fileKey(friendId, item));
        this.snippets.set(`${friendId}/${item.id}`, summaryOf(item.type, object));
        this.whens.set(`${friendId}/${item.id}`, whenOf(item.type, object));
        this.dues.set(`${friendId}/${item.id}`, dueRange(object));
        return { ...item, name: object.title };
      } catch {
        return { ...item, name: tr('core.lockedItem', 'Locked item') };
      }
    }
    try {
      const meta = await openMeta(friendId, item.enc, await this.fileKey(friendId, item));
      return { ...item, name: meta.name, mime: meta.mime };
    } catch {
      return { ...item, name: tr('core.lockedFile', 'Locked file') };
    }
  }

  /** When a date or a ticket is ("5 Dec 2026 19:30"), for the list and the badges ('' for anything else). */
  when(friendId: string, itemId: string): string {
    return this.whens.get(`${friendId}/${itemId}`) ?? '';
  }

  /** True when the item is due now: its reminder period has begun (or its day has) and its day is not over. An item with no date is never due. */
  isDue(friendId: string, itemId: string): boolean {
    const due = this.dues.get(`${friendId}/${itemId}`) ?? null;
    const now = Date.now();
    return !!due && now >= due.from && now <= due.to;
  }

  /**
   * Finds out when the items made before heads carried it are due (their content is read once, one at a time, and not kept): only the kinds that can have
   * a date, and only the first time. The page asks again for what is due when this is done.
   */
  async loadDues(friendId: string, items: SafeboxItem[]): Promise<void> {
    for (const item of items) {
      const key = `${friendId}/${item.id}`;
      if (!DATED_TYPES.includes(item.type) || !item.enc || this.dues.has(key)) continue;
      try {
        const raw = this.raw.get(key);
        const full = raw ? await this.withBody(friendId, raw) : undefined;
        this.dues.set(key, full?.enc ? dueRange(await openObject(friendId, full.enc, await this.fileKey(friendId, full))) : null);
      } catch {
        this.dues.set(key, null);
      }
    }
  }

  /** The first line of a note, for the list ('' for anything else). */
  snippet(friendId: string, itemId: string): string {
    return this.snippets.get(`${friendId}/${itemId}`) ?? '';
  }

  /** Makes a new note (both of us must have a key: a note is never stored unlocked). Answers with the note as the list shows it. */
  /** What the list shows of a note / of another object, locked apart from the content. */
  private noteHead = (title: string, text: string): BoxHead => ({ title, line: firstLine(text), when: '' });
  private objectHead = (type: SafeboxType, payload: ObjectPayload): BoxHead => ({ title: payload.title, line: summaryOf(type, payload), when: whenOf(type, payload), due: dueRange(payload) });

  /** The item with its whole content: the list sends only the head of a note or object, so the content is asked for the first time it is opened. */
  private async withBody(friendId: string, item: SafeboxItem | undefined): Promise<SafeboxItem | undefined> {
    if (!item || !needsBody(item.enc)) return item;
    // the whole item is NOT kept: it lives only while the page that opened it uses it, so big contents do not pile up in memory
    return this.api.request<SafeboxItem>(`${this.base(friendId)}/items/${item.id}`);
  }

  async addNote(friendId: string, title: string, text: string, keys: BoxKeys): Promise<SafeboxItem> {
    const me = this.auth.user()?.uid;
    if (!me) throw new Error(tr('core.notSignedIn', 'Not signed in'));
    const body = await sealNote(friendId, { v: 1, title, text }, this.noteHead(title, text), recipientsOf(me, keys));
    return this.reveal(friendId, await this.api.request<SafeboxItem>(`${this.base(friendId)}/items`, { method: 'POST', body: JSON.stringify(body) }));
  }

  /** A note opened, with the revision it is at (read from the server again when `fresh`: after a conflict or when the page opens). */
  async readNote(friendId: string, itemId: string, fresh = false): Promise<{ note: NotePayload; revision: number; mine: boolean; updatedAt: string | null }> {
    if (fresh) this.raw.delete(`${friendId}/${itemId}`);
    const item = await this.withBody(friendId, await this.rawItem(friendId, itemId));
    if (!item || item.type !== 'note' || !item.enc) throw new Error(tr('core.thatNoteIsGone', 'That note is not there any more.'));
    return { note: await openNote(friendId, item.enc, await this.fileKey(friendId, item)), revision: item.revision, mine: item.mine, updatedAt: item.updatedAt ?? item.createdAt };
  }

  /** Saves a changed note. The revision is the one the page opened it at: if your friend saved first, the server says so (409) and the page reads it again. */
  async updateNote(friendId: string, itemId: string, title: string, text: string, revision: number): Promise<SafeboxItem> {
    const raw = await this.rawItem(friendId, itemId);
    if (!raw?.enc) throw new Error(tr('core.thatNoteIsGone', 'That note is not there any more.'));
    const sealed = await resealNote(friendId, await this.fileKey(friendId, raw), { v: 1, title, text }, this.noteHead(title, text));
    return this.reveal(friendId, await this.api.request<SafeboxItem>(`${this.base(friendId)}/items/${itemId}`, { method: 'PUT', body: JSON.stringify({ revision, ...sealed }) }));
  }

  /** Makes a new object of any kind but a note (both must have a key). */
  async addObject(friendId: string, type: SafeboxType, payload: ObjectPayload, keys: BoxKeys, remind: ReminderRequest | null = null): Promise<SafeboxItem> {
    const me = this.auth.user()?.uid;
    if (!me) throw new Error(tr('core.notSignedIn', 'Not signed in'));
    const body = { ...(await sealObject(friendId, type, payload, type === 'relation' ? null : this.objectHead(type, payload), recipientsOf(me, keys))), remind };
    return this.reveal(friendId, await this.api.request<SafeboxItem>(`${this.base(friendId)}/items`, { method: 'POST', body: JSON.stringify(body) }));
  }

  /** An object opened, with its type and the revision it is at. */
  async readObject(friendId: string, itemId: string, fresh = false): Promise<{ type: SafeboxType; payload: ObjectPayload; revision: number; mine: boolean; updatedAt: string | null }> {
    if (fresh) this.raw.delete(`${friendId}/${itemId}`);
    const item = await this.withBody(friendId, await this.rawItem(friendId, itemId));
    if (!item || !isObjectType(item.type) || !item.enc) throw new Error(tr('core.thatItemIsGone', 'That item is not there any more.'));
    return { type: item.type, payload: await openObject(friendId, item.enc, await this.fileKey(friendId, item)), revision: item.revision, mine: item.mine, updatedAt: item.updatedAt ?? item.createdAt };
  }

  /** Saves a changed object (a 409 means the friend saved first). */
  async updateObject(friendId: string, itemId: string, payload: ObjectPayload, revision: number, remind: ReminderRequest | null = null): Promise<SafeboxItem> {
    const raw = await this.rawItem(friendId, itemId);
    if (!raw?.enc) throw new Error(tr('core.thatItemIsGone', 'That item is not there any more.'));
    const sealed = await resealObject(friendId, await this.fileKey(friendId, raw), payload, raw.type === 'relation' ? null : this.objectHead(raw.type, payload));
    return this.reveal(friendId, await this.api.request<SafeboxItem>(`${this.base(friendId)}/items/${itemId}`, { method: 'PUT', body: JSON.stringify({ revision, ...sealed, remind }) }));
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

  /** Adds a file as an ATTACHMENT of an object (always locked: it needs the keys of both friends). */
  addAttachment(friendId: string, parentId: string, file: Blob, name: string, thumb: Blob | undefined, keys: BoxKeys): Promise<SafeboxItem> {
    return this.addEncrypted(friendId, file, name, thumb ?? null, keys, parentId);
  }

  /** The attachments of an object, as the list shows them (read from the server). */
  async children(friendId: string, parentId: string): Promise<SafeboxItem[]> {
    return (await this.load(friendId)).items.filter((item) => item.parentId === parentId);
  }

  private async addEncrypted(friendId: string, file: Blob, name: string, thumb: Blob | null, keys: BoxKeys, parentId?: string): Promise<SafeboxItem> {
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
      recipients: recipientsOf(me, keys),
    });
    const item = await this.api.request<SafeboxItem>(`${this.base(friendId)}/encrypted${parentId ? `?parent=${encodeURIComponent(parentId)}` : ''}`, { method: 'POST', body, headers: { 'Content-Type': 'application/octet-stream' } });
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
    const body = await sealFile({ connectionId: friendId, file, name: item.name, kind, mime, thumb, recipients: recipientsOf(me, keys) });
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

  /** Saves the new order of the items (their ids, first to last): they get the numbers 1, 2, 3 ... in that order. */
  async reorder(friendId: string, ids: string[]): Promise<void> {
    await this.api.request<void>(`${this.base(friendId)}/order`, { method: 'PUT', body: JSON.stringify({ ids }) });
  }

  async remove(friendId: string, itemId: string): Promise<void> {
    await this.dropLinks(friendId, (pair) => pair.a === itemId || pair.b === itemId).catch(() => undefined); // its links go with it
    await this.api.request<void>(`${this.base(friendId)}/${itemId}`, { method: 'DELETE' });
  }

  // ---- links between items (a locked `relation` item for each: nothing about it is readable on the server)

  /** "Add a new item and link it": the item the next new item is to be linked with. Set by the page that chooses the kind, taken (and so cleared) by the page of the new item, cleared by the list. */
  private linkFrom: string | null = null;
  setLinkFrom(itemId: string | null): void {
    this.linkFrom = itemId;
  }
  takeLinkFrom(): string | null {
    const from = this.linkFrom;
    this.linkFrom = null;
    return from;
  }

  /** The page of an item of this box (as the box was read last): where a link to it goes. Null when the item is not known. */
  openPath(friendId: string, itemId: string): string[] | null {
    const item = this.raw.get(`${friendId}/${itemId}`);
    if (!item) return null;
    const base = ['/friends', friendId, 'safebox'];
    if (item.type === 'note') return [...base, 'note', item.id];
    return item.type === 'file' ? [...base, item.id] : [...base, 'object', item.id];
  }

  /** The ids of the items this one is linked with (from the box as it was read last; either end of a link counts). */
  linkedWith(friendId: string, itemId: string): string[] {
    const out = new Set<string>();
    for (const pair of this.relations.get(friendId)?.values() ?? []) {
      if (pair.a === pair.b) continue; // an item is never linked with itself
      if (pair.a === itemId) out.add(pair.b);
      else if (pair.b === itemId) out.add(pair.a);
    }
    return [...out].filter((id) => this.raw.has(`${friendId}/${id}`)); // an item that is gone (its maker left the group) is no link any more
  }

  async addLink(friendId: string, a: string, b: string, keys: BoxKeys): Promise<void> {
    if (!a || !b || a === b || this.linkedWith(friendId, a).includes(b)) return; // never with itself, never twice
    await this.addObject(friendId, 'relation', { v: 1, title: 'link', fields: { from: a, to: b } }, keys, null);
  }

  removeLink(friendId: string, a: string, b: string): Promise<void> {
    return this.dropLinks(friendId, (pair) => (pair.a === a && pair.b === b) || (pair.a === b && pair.b === a));
  }

  private async dropLinks(friendId: string, which: (pair: { a: string; b: string }) => boolean): Promise<void> {
    const map = this.relations.get(friendId);
    if (!map) return;
    for (const [id, pair] of [...map]) {
      if (!which(pair)) continue;
      await this.api.request<void>(`${this.base(friendId)}/${id}`, { method: 'DELETE' });
      map.delete(id);
      this.forget(friendId, id);
    }
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
      // only the newest previews are kept; an older one is let go with its object URL
      while (this.previews.size > PREVIEWS_KEPT) {
        const oldest = this.previews.keys().next().value as string;
        void this.previews.get(oldest)?.then((file) => URL.revokeObjectURL(file.url), () => undefined);
        this.previews.delete(oldest);
      }
      preview.catch(() => this.previews.delete(key));
    }
    return preview;
  }

  /** Let go of everything kept for one friend (the items, keys, previews with their object URLs): called when the safebox pages are left. */
  release(friendId: string): void {
    const own = (id: string) => id.startsWith(`${friendId}/`);
    for (const map of [this.raw, this.fileKeys, this.snippets, this.whens, this.dues] as Map<string, unknown>[]) for (const id of [...map.keys()]) if (own(id)) map.delete(id);
    for (const [id, preview] of [...this.previews]) if (own(id)) { void preview.then((file) => URL.revokeObjectURL(file.url), () => undefined); this.previews.delete(id); }
    this.relations.delete(friendId);
  }

  /** Forget the kept preview of a file that was taken out. */
  forget(friendId: string, itemId: string): void {
    void this.previews.get(`${friendId}/${itemId}`)?.then((file) => URL.revokeObjectURL(file.url), () => undefined);
    this.snippets.delete(`${friendId}/${itemId}`);
    this.whens.delete(`${friendId}/${itemId}`);
    this.dues.delete(`${friendId}/${itemId}`);
    this.previews.delete(`${friendId}/${itemId}`);
    this.raw.delete(`${friendId}/${itemId}`);
    this.fileKeys.delete(`${friendId}/${itemId}`);
  }
}

const PREVIEWS_KEPT = 60;

/** The kinds of item that can have a date (and so can be due). */
const DATED_TYPES: string[] = ['date', 'ticket', 'case', 'checklist'];

/** The first non-empty line of a text, cut to fit a list row. */
function firstLine(text: string): string {
  const line = text.split('\n').map((l) => l.trim()).find((l) => l) ?? '';
  return line.length > 120 ? `${line.slice(0, 120)}…` : line;
}
