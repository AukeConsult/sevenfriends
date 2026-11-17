import { PublishedKey, canonicalPublicKey, fingerprintOf, keyIdOf } from '../models';
import { newMessageKey, openFileKey, openMessageKey, openMessageMedia, openMessageMeta, openMeta, openNote, openPart, openTextWith, rewrapKey, sealFile, sealMessageMedia, sealNote, sealTextWith, sealText, openText } from './box-crypto';
import { StoredDeviceKey, generateIdentityKey } from './device-key';

/**
 * A person reinstalls the app, or opens the account on a new phone: the new device makes its own key, and ANOTHER device of the same person (which still has
 * a key) gives it its copies. These tests use the real keys (silent keys, unextractable) and the real locking, and check that after that the new device opens the
 * old messages, the files of messages and the items of the safebox, that the friend and the old device are not disturbed, and that a stranger gets nothing.
 */
interface Device {
  stored: StoredDeviceKey;
  published: PublishedKey;
}

async function device(label: string): Promise<Device> {
  const stored = await generateIdentityKey(); // the silent key: the private parts cannot be read
  const fingerprint = (await fingerprintOf(stored.publicKey))!;
  return { stored, published: { id: keyIdOf(fingerprint), fingerprint, label, createdAt: null, publicKey: canonicalPublicKey(stored.publicKey)! } };
}

/** Cuts an upload body into its header, file and preview, as the server does. */
async function cut(body: Blob) {
  const bytes = new Uint8Array(await body.arrayBuffer());
  const headerLength = new DataView(bytes.buffer).getUint32(0);
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + headerLength)));
  const file = bytes.slice(4 + headerLength, 4 + headerLength + header.fileLength);
  return { header, file };
}

describe('a reinstalled app gets its old messages and safebox items back from my other device', () => {
  let oldPhone: Device; // the device that still has its key
  let newPhone: Device; // the same person after a reinstall: a NEW key
  let friend: Device;
  let stranger: Device;
  beforeAll(async () => {
    [oldPhone, newPhone, friend, stranger] = await Promise.all([device('old phone'), device('reinstalled phone'), device('friend'), device('stranger')]);
  }, 180_000);

  const me = (...keys: PublishedKey[]) => ({ uid: 'me', keys });
  const them = () => ({ uid: 'friend', keys: [friend.published] });
  /** what the old device does for one item: opens its copy of the key and locks it again for the new key (OwnRecoveryService.allow) */
  const allow = (enc: { wraps: { uid: string; keyId: string; wrappedKey: string }[] }, noun: 'file' | 'message') =>
    rewrapKey(enc, oldPhone.published.id, oldPhone.stored.privateKey, { uid: 'me', key: newPhone.published }, noun);
  const forNewPhone = <T extends { wraps: { keyId: string }[] }>(enc: T): T => ({ ...enc, wraps: enc.wraps.filter((w) => w.keyId === newPhone.published.id) });

  it('the new device cannot open anything until the old device has given it its copies', async () => {
    const { text, enc } = await sealText('conn1', 'before the reinstall', [me(oldPhone.published), them()]);
    await expectAsync(openText('conn1', forNewPhone(enc), text, newPhone.published.id, newPhone.stored.privateKey)).toBeRejected();
  });

  it('a message: opened on the new device after the old device gave it its copy; the others still open it', async () => {
    const { text, enc } = await sealText('conn1', 'meet me at the old oak at 7 🎂', [me(oldPhone.published), them()]);
    const added = await allow(enc, 'message');
    const updated = { ...enc, wraps: [...enc.wraps, added] };
    expect(await openText('conn1', forNewPhone(updated), text, newPhone.published.id, newPhone.stored.privateKey)).toBe('meet me at the old oak at 7 🎂');
    expect(await openText('conn1', { ...updated, wraps: updated.wraps.filter((w) => w.keyId === oldPhone.published.id) }, text, oldPhone.published.id, oldPhone.stored.privateKey)).toBe('meet me at the old oak at 7 🎂');
    expect(await openText('conn1', { ...updated, wraps: updated.wraps.filter((w) => w.keyId === friend.published.id) }, text, friend.published.id, friend.stored.privateKey)).toBe('meet me at the old oak at 7 🎂');
  });

  it('a picture sent in a message: the text, the name and the bytes open on the new device', async () => {
    const picture = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const meta = { name: 'holiday.jpg', mime: 'image/jpeg', width: 640, height: 480, durationMs: null };
    const key = await newMessageKey();
    const file = await sealMessageMedia('conn1', key, { file: new Blob([picture]), thumb: new Blob([new Uint8Array([9, 9, 9])]), meta });
    const { text, enc } = await sealTextWith('conn1', key, 'look at this', [me(oldPhone.published), them()], file.media);
    const updated = { ...enc, wraps: [...enc.wraps, await allow(enc, 'message')] };
    const opened = await openMessageKey(forNewPhone(updated), newPhone.published.id, newPhone.stored.privateKey);
    expect(await openTextWith('conn1', updated, text, opened)).toBe('look at this');
    expect(await openMessageMeta('conn1', enc.media!, opened)).toEqual(meta);
    expect(new Uint8Array(await openMessageMedia('conn1', enc.media!, opened, 'file', await file.file.arrayBuffer()))).toEqual(picture);
  });

  it('a file in the safebox: opened with its real name on the new device', async () => {
    const secret = new TextEncoder().encode('the plan for the surprise party');
    const body = await sealFile({ connectionId: 'box1', file: new Blob([secret]), name: 'party plan.txt', kind: 'document', mime: 'text/plain', recipients: [me(oldPhone.published), them()] });
    const { header, file } = await cut(body);
    const updated = { ...header.enc, wraps: [...header.enc.wraps, await allow(header.enc, 'file')] };
    const key = await openFileKey(forNewPhone(updated), newPhone.published.id, newPhone.stored.privateKey);
    expect(new Uint8Array(await openPart('box1', updated, key, 'file', file.buffer as ArrayBuffer))).toEqual(secret);
    expect(await openMeta('box1', updated, key)).toEqual({ name: 'party plan.txt', mime: 'text/plain' });
  });

  it('a note in the safebox: title and text open on the new device', async () => {
    const note = await sealNote('box1', { v: 1, title: 'Passwords for the cabin', text: 'the key is under the third stone' }, null, [me(oldPhone.published), them()]);
    const updated = { ...note.enc, wraps: [...note.enc.wraps, await allow(note.enc, 'file')] };
    const key = await openFileKey(forNewPhone(updated), newPhone.published.id, newPhone.stored.privateKey);
    expect(await openNote('box1', updated, key)).toEqual({ v: 1, title: 'Passwords for the cabin', text: 'the key is under the third stone' });
  });

  it('only a device that has a copy can give one: the new device cannot make copies for itself, and a stranger gets nothing', async () => {
    const { enc } = await sealText('conn1', 'private', [me(oldPhone.published), them()]);
    await expectAsync(rewrapKey(enc, newPhone.published.id, newPhone.stored.privateKey, { uid: 'me', key: newPhone.published }, 'message')).toBeRejected();
    const added = await allow(enc, 'message'); // a copy for the new key only
    expect(added.keyId).toBe(newPhone.published.id);
    expect(added.keyId).not.toBe(stranger.published.id);
    const { text } = await sealText('conn1', 'private', [me(oldPhone.published), them()]);
    await expectAsync(openText('conn1', { ...enc, wraps: [added] }, text, stranger.published.id, stranger.stored.privateKey)).toBeRejected();
  });

  it('every copy is for exactly one key: the key of the reinstalled device is its own, whatever the older keys were', async () => {
    expect(newPhone.published.id).not.toBe(oldPhone.published.id);
    expect(newPhone.published.fingerprint).not.toBe(oldPhone.published.fingerprint);
    const again = await device('reinstalled again');
    expect(again.published.id).not.toBe(newPhone.published.id);
  });
});
