import { ActiveCircleService } from './active-circle.service';
import { Injectable, inject } from '@angular/core';
import { ChatMessage, MediaRef, MessageEnc, MessageEncMedia, recipientsOf } from '../models';
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
export type ChatItem = Omit<ChatMessage, 'link'> & { link: LocalLink | null; locked?: 'open' | 'shut' };

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
  /** the same choice as for new files in the safebox: ticked = do not lock what I send (remembered on this device) */
  private readonly plain = this.prefs.value('boxPlain');
  /** the texts that were opened, by friend, message and iv (a new edit has a new iv): the feed is read again after every new message, a key is not used again for what is known */
  private readonly opened = new Map<string, { text: string; media: MediaRef | null }>();

  constructor() {
    // another circle: the opened texts of the old circle are let go
    inject(ActiveCircleService).onSwitch(() => this.opened.clear());
  }

  /** The key of this person on this device with its id, or null when there is none. */
  private myKey(): Promise<{ uid: string; keyId: string; privateKey: CryptoKey } | null> {
    return myDeviceKey(this.auth.user()?.uid);
  }

  /**
   * The text locked for me and my friend, or null when it goes as plain text: the text is empty, locking is switched off, or one of us has no key
   * (mine counts only on this device). With `force` (changing a message that is locked) it is never null: it throws when the message cannot be locked.
   */
  async seal(friendId: string, text: string, force = false): Promise<SealedText | null> {
    if (!text || (!force && this.plain())) return null;
    const [keys, mine] = await Promise.all([this.safebox.keys(friendId), this.myKey()]);
    if (!mine || !keys.mine.some((k) => k.id === mine.keyId) || !keys.friend.length) {
      if (force) throw new Error(tr('core.thisMessageIsLocked', 'This message is locked, so the new text must be locked too. You and your friend both need privacy lock turned on.'));
      return null;
    }
    return sealText(friendId, text, recipientsOf(mine.uid, keys));
  }

  /**
   * The key for a message with a picture, video or voice, or null when it goes plain (locking is switched off, or one of us has no key; mine counts only on this device).
   * The file is locked with this key before it is uploaded; the caption and the copies of the key are made when the message is sent (`sealWith`).
   */
  async mediaKey(friendId: string): Promise<CryptoKey | null> {
    if (this.plain()) return null;
    const [keys, mine] = await Promise.all([this.safebox.keys(friendId), this.myKey()]);
    return mine && keys.mine.some((k) => k.id === mine.keyId) && keys.friend.length ? newMessageKey() : null;
  }

  /** The caption (may be empty) locked with the key the file was locked with, and the copies of the key for the keys in use now. Throws when a key is missing now. */
  async sealWith(friendId: string, key: CryptoKey, text: string, media: MessageEncMedia): Promise<SealedText> {
    const [keys, mine] = await Promise.all([this.safebox.keys(friendId), this.myKey()]);
    if (!mine || !keys.mine.some((k) => k.id === mine.keyId) || !keys.friend.length) throw new Error(tr('core.thisMessageIsLocked2', 'This message is locked, so you and your friend both need privacy lock turned on. Try again in a moment.'));
    return sealTextWith(friendId, key, text, recipientsOf(mine.uid, keys), media);
  }

  /** A new text for a message that is locked: locked with the key the message already has, so the same keys (and nobody else) can read it. Throws when this device cannot open the message. */
  async reseal(friendId: string, message: ChatItem, text: string): Promise<{ text: string; iv: string }> {
    const mine = await this.myKey();
    if (!message.enc || !mine) throw new Error(tr('core.thisMessageIsLocked3', 'This message is locked, and this device cannot open it. Get your old messages back under Settings → Privacy lock.'));
    return resealText(friendId, message.enc, text, mine.keyId, mine.privateKey);
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
    if (known) return { ...message, text: known.text, media: known.media, link: localLink(known.text), locked: 'open' };
    try {
      const mine = await this.myKey();
      if (!mine) throw new Error('no key');
      const key = await openMessageKey(enc, mine.keyId, mine.privateKey);
      const text = await openTextWith(friendId, enc, message.text, key);
      let media = message.media;
      if (media && enc.media) {
        const meta = await openMessageMeta(friendId, enc.media, key);
        media = { ...media, mime: meta.mime, name: meta.name, width: meta.width, height: meta.height, durationMs: meta.durationMs };
      }
      this.opened.set(id, { text, media });
      return { ...message, text, media, link: localLink(text), locked: 'open' };
    } catch {
      return { ...message, text: '', locked: 'shut' };
    }
  }

  /** The whole feed, opened. */
  openAll(friendId: string, messages: ChatMessage[]): Promise<ChatItem[]> {
    return Promise.all(messages.map((m) => this.open(friendId, m)));
  }
}
