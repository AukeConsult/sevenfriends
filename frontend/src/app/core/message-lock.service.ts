import { Injectable, inject } from '@angular/core';
import { ChatMessage, MessageEnc, fingerprintOf, keyIdOf } from '../models';
import { AuthService } from './auth.service';
import { openText, resealText, sealText } from './box-crypto';
import { getDeviceKey } from './device-key';
import { LocalLink, localLink } from './link-embed';
import { SafeboxService } from './safebox.service';
import { UiPreferencesService } from './ui-preferences';

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
  /** the same choice as for new files in the safebox: ticked = do not lock what I send (remembered on this device) */
  private readonly plain = this.prefs.value('boxPlain');
  /** the texts that were opened, by friend, message and iv (a new edit has a new iv): the feed is read again after every new message, a key is not used again for what is known */
  private readonly opened = new Map<string, string>();

  /** The key of this person on this device with its id, or null when there is none. */
  private async myKey(): Promise<{ uid: string; keyId: string; privateKey: CryptoKey } | null> {
    const uid = this.auth.user()?.uid;
    const device = uid ? await getDeviceKey(uid) : null;
    const fingerprint = device ? await fingerprintOf(device.publicKey) : null;
    return uid && device && fingerprint ? { uid, keyId: keyIdOf(fingerprint), privateKey: device.privateKey } : null;
  }

  /**
   * The text locked for me and my friend, or null when it goes as plain text: the text is empty, locking is switched off, or one of us has no key
   * (mine counts only on this device). With `force` (changing a message that is locked) it is never null: it throws when the message cannot be locked.
   */
  async seal(friendId: string, text: string, force = false): Promise<SealedText | null> {
    if (!text || (!force && this.plain())) return null;
    const [keys, mine] = await Promise.all([this.safebox.keys(friendId), this.myKey()]);
    if (!mine || !keys.mine.some((k) => k.id === mine.keyId) || !keys.friend.length) {
      if (force) throw new Error('This message is locked, so the new text must be locked too. It needs a key for you and for your friend.');
      return null;
    }
    return sealText(friendId, text, [{ uid: mine.uid, keys: keys.mine }, { uid: keys.friendUid, keys: keys.friend }]);
  }

  /** A new text for a message that is locked: locked with the key the message already has, so the same keys (and nobody else) can read it. Throws when this device cannot open the message. */
  async reseal(friendId: string, message: ChatItem, text: string): Promise<{ text: string; iv: string }> {
    const mine = await this.myKey();
    if (!message.enc || !mine) throw new Error('This message is locked, and this device has no key to change it with.');
    return resealText(friendId, message.enc, text, mine.keyId, mine.privateKey);
  }

  /** A message of the feed with its real text when it was locked and this device can open it. */
  async open(friendId: string, message: ChatMessage): Promise<ChatItem> {
    const enc = message.enc;
    if (!enc) return message;
    // the server cannot read a locked text and made no link for it: the link is found here, on this device (see link-embed.ts)
    const id = `${friendId}/${message.id}/${enc.iv}`;
    const known = this.opened.get(id);
    if (known !== undefined) return { ...message, text: known, link: localLink(known), locked: 'open' };
    try {
      const mine = await this.myKey();
      if (!mine) throw new Error('no key');
      const text = await openText(friendId, enc, message.text, mine.keyId, mine.privateKey);
      this.opened.set(id, text);
      return { ...message, text, link: localLink(text), locked: 'open' };
    } catch {
      return { ...message, text: '', locked: 'shut' };
    }
  }

  /** The whole feed, opened. */
  openAll(friendId: string, messages: ChatMessage[]): Promise<ChatItem[]> {
    return Promise.all(messages.map((m) => this.open(friendId, m)));
  }
}
