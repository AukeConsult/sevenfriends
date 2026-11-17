import { TestBed } from '@angular/core/testing';
import { BoxKeys, PublishedKey } from '../models';
import { FriendListsService, PersonDevices } from './friend-lists.service';
import { KeyTrustService, NotApprovedError } from './key-trust.service';

/** The ONE rule for who a new locked thing may be locked for: only the keys in the signed device lists. */
describe('KeyTrustService', () => {
  const key = (id: string): PublishedKey => ({ id, fingerprint: id, label: id, createdAt: null, publicKey: { kty: 'RSA', n: id, e: 'AQAB' } as PublishedKey['publicKey'] });
  const ok = (...ids: string[]): PersonDevices => ({ status: 'ok', devices: [], current: ids.map((keyId) => ({ keyId, lockKey: {}, signKey: {}, label: keyId }) as never) });
  const none: PersonDevices = { status: 'none', devices: [] };
  const broken: PersonDevices = { status: 'broken', devices: [] };

  const trustWith = (people: Record<string, PersonDevices | null>): KeyTrustService => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: FriendListsService, useValue: { devicesOf: async (_friend: string, uid: string) => people[uid] ?? null } }] });
    return TestBed.inject(KeyTrustService);
  };
  const keysOf = (mine: string[], friend: string[]): BoxKeys => ({ friendUid: 'bob', mine: mine.map(key), friend: friend.map(key), others: [{ uid: 'bob', name: 'Bob', keys: friend.map(key) }] });
  const me = { uid: 'me', keyId: 'm1' };

  it('drops a key the server lists that is not in the signed list (a key the server added itself)', async () => {
    const trust = trustWith({ me: ok('m1'), bob: ok('b1') });
    const out = await trust.limit('f', me, keysOf(['m1'], ['b1', 'SERVER']));
    expect(out.friend.map((k) => k.id)).toEqual(['b1']);
    expect(out.others[0].keys.map((k) => k.id)).toEqual(['b1']);
  });

  it('drops an extra key of mine that is not in my own list too', async () => {
    const trust = trustWith({ me: ok('m1'), bob: ok('b1') });
    const out = await trust.limit('f', me, keysOf(['m1', 'SERVER'], ['b1']));
    expect(out.mine.map((k) => k.id)).toEqual(['m1']);
  });

  it('takes a person with no list (an older lock) as the server says', async () => {
    const trust = trustWith({ me: ok('m1'), bob: none });
    const out = await trust.limit('f', me, keysOf(['m1'], ['b1', 'b2']));
    expect(out.friend.map((k) => k.id)).toEqual(['b1', 'b2']);
  });

  it('refuses when a list does not hold', async () => {
    const trust = trustWith({ me: ok('m1'), bob: broken });
    await expectAsync(trust.limit('f', me, keysOf(['m1'], ['b1']))).toBeRejected();
  });

  it('refuses when the list leaves a person with no key at all (nothing falls back to plain)', async () => {
    const trust = trustWith({ me: ok('m1'), bob: ok('b9') });
    await expectAsync(trust.limit('f', me, keysOf(['m1'], ['b1']))).toBeRejected();
  });

  it('says "not approved" when this device is not in my own list yet', async () => {
    const trust = trustWith({ me: ok('other-device'), bob: ok('b1') });
    await expectAsync(trust.limit('f', me, keysOf(['m1'], ['b1']))).toBeRejectedWithError(NotApprovedError);
  });

  it('cuts each member of a group by their own list', async () => {
    const trust = trustWith({ me: ok('m1'), ann: ok('a1'), cat: none });
    const keys: BoxKeys = { friendUid: '', mine: [key('m1')], friend: [], others: [{ uid: 'ann', name: 'Ann', keys: [key('a1'), key('SERVER')] }, { uid: 'cat', name: 'Cat', keys: [key('c1'), key('c2')] }] };
    const out = await trust.limit('g', me, keys);
    expect(out.others[0].keys.map((k) => k.id)).toEqual(['a1']);
    expect(out.others[1].keys.map((k) => k.id)).toEqual(['c1', 'c2']);
    expect(out.friend).toEqual([]);
  });
});
