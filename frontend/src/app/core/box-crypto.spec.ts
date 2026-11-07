import { PublishedKey, canonicalPublicKey, fingerprintOf, keyIdOf } from '../models';
import { classify, openFileKey, openMeta, openPart, sealFile, sealMeta } from './box-crypto';
import { KeyStore, StoredDeviceKey, createDeviceKey } from './device-key';

/** A key store that lives in memory (the real one is IndexedDB). */
function memoryStore(): KeyStore {
  const map = new Map<string, StoredDeviceKey>();
  return { read: async (uid) => map.get(uid) ?? null, write: async (uid, key) => void map.set(uid, key), remove: async (uid) => void map.delete(uid) };
}

async function person(uid: string): Promise<{ stored: StoredDeviceKey; published: PublishedKey }> {
  const { key } = await createDeviceKey(uid, { store: memoryStore() });
  const fingerprint = (await fingerprintOf(key.publicKey))!;
  return { stored: key, published: { id: keyIdOf(fingerprint), fingerprint, label: uid, createdAt: null, revoked: false, publicKey: canonicalPublicKey(key.publicKey)! } };
}

/** Cuts an upload body into its header, file and preview, as the server does. */
async function cut(body: Blob) {
  const bytes = new Uint8Array(await body.arrayBuffer());
  const headerLength = new DataView(bytes.buffer).getUint32(0);
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + headerLength)));
  const file = bytes.slice(4 + headerLength, 4 + headerLength + header.fileLength);
  const thumb = header.thumbLength ? bytes.slice(4 + headerLength + header.fileLength) : null;
  return { header, file, thumb };
}

describe('box crypto', () => {
  let me: Awaited<ReturnType<typeof person>>;
  let friend: Awaited<ReturnType<typeof person>>;
  let stranger: Awaited<ReturnType<typeof person>>;
  beforeAll(async () => {
    [me, friend, stranger] = await Promise.all([person('me'), person('friend'), person('stranger')]);
  }, 120000);

  const secret = new TextEncoder().encode('the plan for the surprise party');
  const seal = (thumb?: Blob) =>
    sealFile({ connectionId: 'box1', file: new Blob([secret]), name: 'party plan.txt', kind: 'document', mime: 'text/plain', thumb, recipients: [{ uid: 'me', keys: [me.published] }, { uid: 'friend', keys: [friend.published] }] });

  it('locks a file so that both friends can open it, with its real name', async () => {
    const { header, file } = await cut(await seal());
    expect(header.enc.wraps.map((w: { uid: string }) => w.uid)).toEqual(['me', 'friend']);
    expect(new TextDecoder().decode(file)).not.toContain('surprise');
    for (const who of [me, friend]) {
      const enc = { ...header.enc, wraps: header.enc.wraps.filter((w: { keyId: string }) => w.keyId === who.published.id) };
      const key = await openFileKey(enc, who.published.id, who.stored.privateKey);
      expect(new Uint8Array(await openPart('box1', enc, key, 'file', file.buffer as ArrayBuffer))).toEqual(secret);
      expect(await openMeta('box1', enc, key)).toEqual({ name: 'party plan.txt', mime: 'text/plain' });
    }
  });

  it('locks the preview too, with its own iv', async () => {
    const preview = new Uint8Array([1, 2, 3, 4, 5]);
    const { header, file, thumb } = await cut(await seal(new Blob([preview])));
    expect(header.enc.thumbIv).toBeTruthy();
    expect(header.enc.thumbIv).not.toBe(header.enc.iv);
    const key = await openFileKey(header.enc, me.published.id, me.stored.privateKey);
    expect(new Uint8Array(await openPart('box1', header.enc, key, 'thumb', thumb!.buffer as ArrayBuffer))).toEqual(preview);
    expect(file.length).toBe(secret.length + 16);
  });

  it('cannot be opened by a key it was not locked for', async () => {
    const { header } = await cut(await seal());
    await expectAsync(openFileKey(header.enc, stranger.published.id, stranger.stored.privateKey)).toBeRejectedWithError(/another device/);
    // a copy meant for someone else does not open with my key
    const forFriend = { ...header.enc, wraps: [{ ...header.enc.wraps[1], keyId: me.published.id }] };
    await expectAsync(openFileKey(forFriend, me.published.id, me.stored.privateKey)).toBeRejected();
  });

  it('is refused when the file is moved to another box or a part is swapped', async () => {
    const { header, file } = await cut(await seal());
    const key = await openFileKey(header.enc, me.published.id, me.stored.privateKey);
    await expectAsync(openPart('box2', header.enc, key, 'file', file.buffer as ArrayBuffer)).toBeRejectedWithError(/changed or damaged/);
    const changed = file.slice();
    changed[2] ^= 1;
    await expectAsync(openPart('box1', header.enc, key, 'file', changed.buffer as ArrayBuffer)).toBeRejectedWithError(/changed or damaged/);
    await expectAsync(openMeta('box2', header.enc, key)).toBeRejected();
  });

  it('can be renamed with the file key it already has', async () => {
    const { header } = await cut(await seal());
    const key = await openFileKey(header.enc, friend.published.id, friend.stored.privateKey);
    const renamed = await sealMeta('box1', key, { name: 'new name.txt', mime: 'text/plain' });
    expect(renamed.metaIv).not.toBe(header.enc.metaIv);
    expect(await openMeta('box1', { ...header.enc, ...renamed }, key)).toEqual({ name: 'new name.txt', mime: 'text/plain' });
  });

  it('knows what kind of file it is from the bytes, and refuses the rest', async () => {
    expect(await classify(new Blob(['%PDF-1.7 ...']), 'a.pdf')).toEqual({ kind: 'document', mime: 'application/pdf' });
    expect(await classify(new Blob([new Uint8Array([0x50, 0x4b, 3, 4, 0])]), 'a.docx')).toEqual({ kind: 'document', mime: 'application/zip' });
    expect(await classify(new Blob(['hello\n']), 'a.txt')).toEqual({ kind: 'document', mime: 'text/plain; charset=utf-8' });
    expect(await classify(new Blob([new Uint8Array([1])], { type: 'image/png' }), 'a.png')).toEqual({ kind: 'image', mime: 'image/png' });
    await expectAsync(classify(new Blob([new Uint8Array([0x4d, 0x5a, 0, 1, 2])]), 'a.exe')).toBeRejectedWithError(/not a supported/);
    await expectAsync(classify(new Blob([]), 'empty.txt')).toBeRejectedWithError(/empty/);
  });
});
