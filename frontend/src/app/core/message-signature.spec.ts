import { TestBed } from '@angular/core/testing';
import { ChatMessage, PublishedKey, SIGNED_MARK, canonicalPublicKey, canonicalSignKey, fingerprintOf, keyIdOf, packSignedText, signedTextBytes } from '../models';
import { ActiveCircleService } from './active-circle.service';
import { AuthService } from './auth.service';
import { sealText } from './box-crypto';
import { StoredDeviceKey, generateIdentityKey } from './device-key';
import { PersonDevices, FriendListsService } from './friend-lists.service';
import { MediaService } from './media.service';
import { MessageLockService } from './message-lock.service';
import { SafeboxService } from './safebox.service';
import { UiPreferencesService } from './ui-preferences';

/**
 * What the feed says about WHO WROTE a locked message ("Could not check who wrote this message"): the real keys, the real locking and the real signatures; the
 * lists of devices are what the test says they are. A person without a list (an older lock) must never be flagged; everything that really is wrong still is.
 */
describe('the check of who wrote a message', () => {
  let originalTimeout: number;
  beforeAll(() => {
    originalTimeout = jasmine.DEFAULT_TIMEOUT_INTERVAL;
    jasmine.DEFAULT_TIMEOUT_INTERVAL = 120_000;
  });
  afterAll(() => {
    jasmine.DEFAULT_TIMEOUT_INTERVAL = originalTimeout;
  });

  interface Device {
    stored: StoredDeviceKey;
    published: PublishedKey;
  }
  const device = async (label: string): Promise<Device> => {
    const stored = await generateIdentityKey();
    const fingerprint = (await fingerprintOf(stored.publicKey))!;
    return { stored, published: { id: keyIdOf(fingerprint), fingerprint, label, createdAt: null, publicKey: canonicalPublicKey(stored.publicKey)! } };
  };
  const entryOf = (d: Device) => ({ keyId: d.published.id, lockKey: canonicalPublicKey(d.stored.publicKey)!, signKey: canonicalSignKey(d.stored.signKey!.publicKey)!, label: d.published.label });

  let me: Device; // the device that wrote (a new device, like Edge)
  let phone: Device; // another device of mine
  let friend: Device;
  beforeAll(async () => {
    [me, phone, friend] = await Promise.all([device('edge'), device('phone'), device('friend')]);
  }, 180_000);

  let lists: PersonDevices | null;
  const start = () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: { user: () => ({ uid: 'me' }) } },
        { provide: SafeboxService, useValue: {} },
        { provide: UiPreferencesService, useValue: { value: () => () => false, get: () => false } },
        { provide: MediaService, useValue: { registerLocked: () => undefined } },
        { provide: FriendListsService, useValue: { devicesOf: async () => lists } },
        { provide: ActiveCircleService, useValue: { onSwitch: () => undefined } },
      ],
    });
    return TestBed.inject(MessageLockService);
  };

  /** A message of mine, locked for me and my friend, whose text carries a signed envelope made by `signer` (the envelope can be altered). */
  const message = async (text: string, options: { signer?: Device; writer?: string; connection?: string; tamper?: boolean; plain?: boolean; time?: string; stamp?: { id: string; n: number }; storedVersion?: number; wrote?: string; messageId?: string } = {}): Promise<ChatMessage> => {
    const connection = 'friend1';
    let inside = text;
    if (!options.plain) {
      const signer = options.signer ?? me;
      const body = { a: options.writer ?? 'me', c: options.connection ?? connection, t: options.wrote ?? '2026-11-15T12:00:00.000Z', k: signer.published.id, x: text };
      const stamped = options.stamp ? { v: 2 as const, i: options.stamp.id, n: options.stamp.n, ...body } : { v: 1 as const, ...body };
      const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signer.stored.signKey!.privateKey, new TextEncoder().encode(signedTextBytes(stamped)));
      inside = packSignedText({ ...stamped, x: options.tamper ? text + ' (changed)' : text, s: btoa(String.fromCharCode(...new Uint8Array(signature))) });
    }
    const sealed = await sealText(connection, inside, [{ uid: 'me', keys: [me.published] }, { uid: 'friend', keys: [friend.published] }]);
    return { id: options.messageId ?? 'm1', text: sealed.text, enc: sealed.enc, media: null, mine: true, read: true, time: options.time ?? '2026-11-15T12:30:00.000Z', edited: false, hidden: false, link: null, ...(options.storedVersion ? { version: options.storedVersion } : {}) } as ChatMessage;
  };
  const signatureOf = async (m: ChatMessage) => {
    const service = start();
    const item = await service.open('friend1', m, Promise.resolve({ uid: 'me', keyId: me.published.id, privateKey: me.stored.privateKey }));
    expect(item.locked).toBe('open'); // the text itself always opens
    return item.signature;
  };
  const list = (status: PersonDevices['status'], devices: Device[], extra: Partial<PersonDevices> = {}): PersonDevices => ({ status, devices: devices.map(entryOf), current: status === 'ok' ? devices.map(entryOf) : undefined, since: null, ...extra });

  describe('a person with NO list (an older lock on their first device): never flagged', () => {
    it('a message signed by their new device is not judged: no warning, and the text opens', async () => {
      lists = { status: 'none', devices: [] };
      expect(await signatureOf(await message('all well ?'))).toBeUndefined();
    });

    it('also when the signature does not belong to the text: there is nothing to check it against', async () => {
      lists = { status: 'none', devices: [] };
      expect(await signatureOf(await message('all well ?', { tamper: true }))).toBeUndefined();
    });

    it('an unsigned text is not judged either', async () => {
      lists = { status: 'none', devices: [] };
      expect(await signatureOf(await message('old style', { plain: true }))).toBeUndefined();
    });
  });

  describe('a person WITH a list: what is wrong is still flagged', () => {
    it('signed by a device of the list: ok', async () => {
      lists = list('ok', [me, phone]);
      expect(await signatureOf(await message('hello'))).toBe('ok');
    });

    it('signed by a device that is not in the list: bad', async () => {
      lists = list('ok', [phone]);
      expect(await signatureOf(await message('hello'))).toBe('bad');
    });

    it('the text was changed after it was signed: bad', async () => {
      lists = list('ok', [me]);
      expect(await signatureOf(await message('hello', { tamper: true }))).toBe('bad');
    });

    it('signed for another conversation, or in the name of another writer: bad', async () => {
      lists = list('ok', [me]);
      expect(await signatureOf(await message('hello', { connection: 'another-friend' }))).toBe('bad');
      expect(await signatureOf(await message('hello', { writer: 'somebody-else' }))).toBe('bad');
    });

    it('signed by the key of somebody else (the friend\'s device, not in my list): bad', async () => {
      lists = list('ok', [me]);
      expect(await signatureOf(await message('hello', { signer: friend }))).toBe('bad');
    });

    it('an unsigned text written after the texts of this person were signed: bad; one from before: fine', async () => {
      lists = list('ok', [me], { since: '2026-11-15T12:00:00.000Z' });
      expect(await signatureOf(await message('stripped', { plain: true, time: '2026-11-15T13:00:00.000Z' }))).toBe('bad');
      expect(await signatureOf(await message('from before', { plain: true, time: '2026-11-14T13:00:00.000Z' }))).toBeUndefined();
    });
  });

  describe('the id and the version of a message are signed (v2)', () => {
    const v2 = (n: number, extra: Parameters<typeof message>[1] = {}) => ({ stamp: { id: 'm1', n }, storedVersion: n, ...extra });

    it('a text that carries its own id and version: ok', async () => {
      lists = list('ok', [me]);
      expect(await signatureOf(await message('hello', v2(1)))).toBe('ok');
    });

    it('the same signed text shown as another message: bad', async () => {
      lists = list('ok', [me]);
      expect(await signatureOf(await message('hello', v2(1, { messageId: 'another-message' })))).toBe('bad');
    });

    it('the server says another version than the one that was signed: bad', async () => {
      lists = list('ok', [me]);
      expect(await signatureOf(await message('hello', { stamp: { id: 'm1', n: 1 }, storedVersion: 2 }))).toBe('bad');
    });

    it('written days away from the time the server stored it: bad; hours away: fine', async () => {
      lists = list('ok', [me]);
      expect(await signatureOf(await message('late', v2(1, { wrote: '2026-11-10T12:00:00.000Z' })))).toBe('bad');
      expect(await signatureOf(await message('clock', v2(1, { messageId: 'm1', wrote: '2026-11-15T08:00:00.000Z' })))).toBe('ok');
    });

    it('a changed text (version 2) may be written long after the message was sent', async () => {
      lists = list('ok', [me]);
      expect(await signatureOf(await message('edited', v2(2, { wrote: '2026-12-20T12:00:00.000Z' })))).toBe('ok');
    });

    it('a text from before the id was signed (v1) is judged as before', async () => {
      lists = list('ok', [me]);
      expect(await signatureOf(await message('old', { messageId: 'whatever' }))).toBe('ok');
    });
  });

  describe('a list that does not hold is still flagged', () => {
    for (const reason of ['chain', 'gone', 'pin'] as const) {
      it('broken (' + reason + '): a signed text is bad, and so is an unsigned one', async () => {
        lists = { status: 'broken', devices: [], reason };
        expect(await signatureOf(await message('hello'))).toBe('bad');
        expect(await signatureOf(await message('hello', { plain: true }))).toBe('bad');
      });
    }
  });

  it('lists that could not be fetched: not judged', async () => {
    lists = null;
    expect(await signatureOf(await message('hello'))).toBeUndefined();
    expect(await signatureOf(await message('hello', { plain: true }))).toBeUndefined();
  });

  it('a text that has the mark but is not an envelope is bad', async () => {
    lists = { status: 'none', devices: [] };
    const sealed = await sealText('friend1', SIGNED_MARK + 'not json', [{ uid: 'me', keys: [me.published] }, { uid: 'friend', keys: [friend.published] }]);
    const broken = { id: 'm2', text: sealed.text, enc: sealed.enc, media: null, mine: true, read: true, time: '2026-11-15T12:30:00.000Z', edited: false, hidden: false, link: null } as ChatMessage;
    expect(await signatureOf(broken)).toBe('bad');
  });
});
