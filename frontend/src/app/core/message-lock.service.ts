import { ActiveCircleService } from './active-circle.service';
import { Injectable, inject } from '@angular/core';
import { BoxKeys, ChatMessage, MediaRef, PublishedKey, MessageEnc, MessageEncMedia, SIGNED_MARK, SignedText, packSignedText, recipientsOf, signedTextBytes, unpackSignedText } from '../models';
import { FriendListsService } from './friend-lists.service';
import { AuthService } from './auth.service';
import { newMessageKey, openMessageKey, openMessageMeta, openTextWith, resealText, sealText, sealTextWith } from './box-crypto';
import { LocalLink, localLink } from './link-embed';
import { MediaService } from './media.service';
import { myDeviceKey } from './my-key';
import { SafeboxService } from './safebox.service';
import { UiPreferencesService } from './ui-preferences';
import { tr } from './i18n';

/**
 * A message as the feed shows it. `locked` is set for a message that was sent locked (design: docs/design/message-encryption.md):
 * 'open' = this device opened it and `text` is the real text; 'shut' = it was locked only for other devices, `text` is empty.
 */
export type ChatItem = Omit<ChatMessage, 'link'> & {
  link: LocalLink | null;
  locked?: 'open' | 'shut';
  /** for a locked message this device opened: 'ok' = signed by a device in the writer's device list; 'bad' = signed, but the signature, the writer, the place or the device does not fit (do not trust who wrote it); absent = not signed (an older lock) or the lists could not be fetched */
  signature?: 'ok' | 'bad';
};

/** What the server keeps of a locked text: the locked text itself and the iv and key copies. */
export interface SealedText {
  text: string;
  enc: MessageEnc;
}

/** Locks the text of a message before it is sent, and opens the locked messages of a feed. Everything happens on this device. */
@Injectable({ providedIn: 'root' })
export class MessageLockService {
  private readonly auth = inject(AuthService);
  private readonly safebox = inject(SafeboxService);
  private readonly prefs = inject(UiPreferencesService);
  private readonly mediaFiles = inject(MediaService);
  private readonly lists = inject(FriendListsService);
  /** the same choice as for new files in the safebox: ticked = do not lock what I send (remembered on this device) */
  private readonly plain = this.prefs.value('boxPlain');
  /** the texts that were opened, by friend, message and iv (a new edit has a new iv): the feed is read again after every new message, a key is not used again for what is known */
  private readonly opened = new Map<string, { text: string; media: MediaRef | null; signature?: 'ok' | 'bad' }>();

  constructor() {
    // another circle: the opened texts of the old circle are let go
    inject(ActiveCircleService).onSwitch(() => this.opened.clear());
  }

  /** The key of this person on this device with its id, or null when there is none. */
  private myKey(): Promise<{ uid: string; keyId: string; privateKey: CryptoKey; signKey?: CryptoKey } | null> {
    return myDeviceKey(this.auth.user()?.uid);
  }

  /**
   * The keys a text may be locked for. Where a person has a signed device list, only the keys in its newest version count (a key the server lists that is not in the
   * list is not locked for); a person without a list (an older lock) is as the server says. Throws, so nothing is sent, when a list does not hold (`broken`), when THIS
   * device has not been approved into my own list yet, or when the list leaves a person with no key at all (a text must not fall back to plain because of that).
   */
  private async trusted(friendId: string, mine: { uid: string; keyId: string }, keys: BoxKeys): Promise<BoxKeys> {
    const refuse = (text: string): never => {
      throw new Error(text);
    };
    const limit = async (uid: string, list: PublishedKey[]): Promise<PublishedKey[]> => {
      const person = await this.lists.devicesOf(friendId, uid);
      if (person?.status === 'broken') return refuse(tr('core.theLockOfThis', 'The lock of this conversation does not check out, so nothing can be sent. Look at the warning under the name.'));
      if (person?.status !== 'ok' || !person.current) return list;
      const allowed = new Set(person.current.map((d) => d.keyId));
      const kept = list.filter((k) => allowed.has(k.id));
      if (list.length && !kept.length) return refuse(tr('core.noKeyInList', 'None of the keys of this person is in their signed list yet, so nothing can be locked for them. Ask them to open the app on a device that is approved.'));
      return kept;
    };
    const me = await this.lists.devicesOf(friendId, mine.uid);
    if (me?.status === 'ok' && me.current && !me.current.some((d) => d.keyId === mine.keyId)) {
      refuse(tr('core.thisDeviceNotApproved', 'This device has not been approved yet. Approve it on another device of yours (on Home), then try again.'));
    }
    const others = await Promise.all((keys.others ?? []).map(async (o) => ({ ...o, keys: await limit(o.uid, o.keys) })));
    return { ...keys, mine: await limit(mine.uid, keys.mine), others, friend: keys.friendUid ? (others[0]?.keys ?? []) : [] };
  }

  /**
   * The text as it is locked: signed by this device (the envelope of `SIGNED_MARK`, see models/shared/signed.ts), or, on an older lock without a signing key, as it is
   * (a text that happens to start with the mark loses it, so it is not read as an envelope).
   */
  private async signed(friendId: string, text: string, mine: { uid: string; keyId: string; signKey?: CryptoKey }): Promise<string> {
    if (!mine.signKey) return text.startsWith(SIGNED_MARK) ? text.replace(/^\u0001+/, '') : text;
    const body = { a: mine.uid, c: friendId, t: new Date().toISOString(), k: mine.keyId, x: text };
    const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, mine.signKey, new TextEncoder().encode(signedTextBytes(body)));
    return packSignedText({ v: 1, ...body, s: btoa(String.fromCharCode(...new Uint8Array(signature))) } satisfies SignedText);
  }

  /** Reads what a locked text says: its real text and whether the signature holds ('ok'), fails ('bad'), or is not there / could not be checked (undefined). */
  private async checked(friendId: string, message: ChatMessage, raw: string, myUid: string): Promise<{ text: string; signature?: 'ok' | 'bad' }> {
    const envelope = unpackSignedText(raw);
    if (!envelope) return { text: raw.slice(1), signature: 'bad' };
    const author = message.mine ? myUid : (message.fromUid ?? (await this.safebox.keys(friendId).then((k) => k.friendUid).catch(() => '')));
    let person = author ? await this.lists.devicesOf(friendId, author) : null;
    if (envelope !== 'plain' && envelope && person?.status === 'ok' && !person.devices.some((d) => d.keyId === envelope.k)) person = await this.lists.devicesOf(friendId, author, true); // a new version may be out
    if (envelope === 'plain') {
      // an unsigned text is only fine from someone without a list, or from before their texts were signed: otherwise a signature was taken off (or the lists do not hold)
      if (!person || person.status === 'none') return { text: raw };
      const stripped = person.status === 'broken' || (!!person.since && !!message.time && Date.parse(message.time) >= Date.parse(person.since));
      return stripped ? { text: raw, signature: 'bad' } : { text: raw };
    }
    if (!person) return { text: envelope.x }; // the lists could not be fetched: not judged
    const device = person.devices.find((d) => d.keyId === envelope.k);
    let holds = false;
    if (person.status === 'ok' && device && envelope.a === author && envelope.c === friendId) {
      try {
        const key = await crypto.subtle.importKey('jwk', device.signKey, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
        holds = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, Uint8Array.from(atob(envelope.s), (c) => c.charCodeAt(0)), new TextEncoder().encode(signedTextBytes(envelope)));
      } catch {
        holds = false;
      }
    }
    return { text: envelope.x, signature: holds ? 'ok' : 'bad' };
  }

  /**
   * The text locked for me and my friend, or null when it goes as plain text: the text is empty, locking is switched off, or one of us has no key
   * (mine counts only on this device). With `force` (changing a message that is locked) it is never null: it throws when the message cannot be locked.
   */
  async seal(friendId: string, text: string, force = false): Promise<SealedText | null> {
    if (!text || (!force && this.plain())) return null;
    const [raw, mine] = await Promise.all([this.safebox.keys(friendId), this.myKey()]);
    const keys = mine ? await this.trusted(friendId, mine, raw) : raw;
    if (!mine || !keys.mine.some((k) => k.id === mine.keyId) || !keys.friend.length) {
      if (force) throw new Error(tr('core.thisMessageIsLocked', 'This message is locked, so the new text must be locked too. You and your friend both need privacy lock turned on.'));
      return null;
    }
    return sealText(friendId, await this.signed(friendId, text, mine), recipientsOf(mine.uid, keys));
  }

  /**
   * The key for a message with a picture, video or voice, or null when it goes plain (locking is switched off, or one of us has no key; mine counts only on this device).
   * The file is locked with this key before it is uploaded; the caption and the copies of the key are made when the message is sent (`sealWith`).
   */
  async mediaKey(friendId: string): Promise<CryptoKey | null> {
    if (this.plain()) return null;
    const [raw, mine] = await Promise.all([this.safebox.keys(friendId), this.myKey()]);
    const keys = mine ? await this.trusted(friendId, mine, raw) : raw;
    return mine && keys.mine.some((k) => k.id === mine.keyId) && keys.friend.length ? newMessageKey() : null;
  }

  /** The caption (may be empty) locked with the key the file was locked with, and the copies of the key for the keys in use now. Throws when a key is missing now. */
  async sealWith(friendId: string, key: CryptoKey, text: string, media: MessageEncMedia): Promise<SealedText> {
    const [raw, mine] = await Promise.all([this.safebox.keys(friendId), this.myKey()]);
    const keys = mine ? await this.trusted(friendId, mine, raw) : raw;
    if (!mine || !keys.mine.some((k) => k.id === mine.keyId) || !keys.friend.length) throw new Error(tr('core.thisMessageIsLocked2', 'This message is locked, so you and your friend both need privacy lock turned on. Try again in a moment.'));
    return sealTextWith(friendId, key, await this.signed(friendId, text, mine), recipientsOf(mine.uid, keys), media);
  }

  /** A new text for a message that is locked: locked with the key the message already has, so the same keys (and nobody else) can read it. Throws when this device cannot open the message. */
  async reseal(friendId: string, message: ChatItem, text: string): Promise<{ text: string; iv: string }> {
    const mine = await this.myKey();
    if (!message.enc || !mine) throw new Error(tr('core.thisMessageIsLocked3', 'This message is locked, and this device cannot open it. Get your old messages back under Settings → Privacy lock.'));
    return resealText(friendId, message.enc, await this.signed(friendId, text, mine), mine.keyId, mine.privateKey);
  }

  /** A message of the feed with its real text (and the real type and size of its file) when it was locked and this device can open it. */
  async open(friendId: string, message: ChatMessage): Promise<ChatItem> {
    const enc = message.enc;
    if (!enc) return message;
    // a locked file is opened when it is read: the media service is told which message key belongs to it
    if (message.media && enc.media) this.mediaFiles.registerLocked(friendId, message.media.ownerId, message.media.objectId, enc);
    // the server cannot read a locked text and made no link for it: the link is found here, on this device (see link-embed.ts)
    const id = `${friendId}/${message.id}/${enc.iv}`;
    const known = this.opened.get(id);
    if (known) return { ...message, text: known.text, media: known.media, link: localLink(known.text), locked: 'open', ...(known.signature ? { signature: known.signature } : {}) };
    try {
      const mine = await this.myKey();
      if (!mine) throw new Error('no key');
      const key = await openMessageKey(enc, mine.keyId, mine.privateKey);
      const { text, signature } = await this.checked(friendId, message, await openTextWith(friendId, enc, message.text, key), mine.uid);
      let media = message.media;
      if (media && enc.media) {
        const meta = await openMessageMeta(friendId, enc.media, key);
        media = { ...media, mime: meta.mime, name: meta.name, width: meta.width, height: meta.height, durationMs: meta.durationMs };
      }
      this.opened.set(id, { text, media, signature });
      return { ...message, text, media, link: localLink(text), locked: 'open', ...(signature ? { signature } : {}) };
    } catch {
      return { ...message, text: '', locked: 'shut' };
    }
  }

  /** The whole feed, opened. */
  openAll(friendId: string, messages: ChatMessage[]): Promise<ChatItem[]> {
    return Promise.all(messages.map((m) => this.open(friendId, m)));
  }
}
