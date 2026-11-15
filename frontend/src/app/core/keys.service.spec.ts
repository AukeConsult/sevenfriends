import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MyKeys, PublishedKey, canonicalPublicKey, fingerprintOf, keyIdOf } from '../models';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { rememberAccount, rememberedAccounts } from './account-registry';
import { createDeviceKey, getDeviceKey, saveDeviceKey, generateIdentityKey, storedKeyOwners, wipeDeviceKeys } from './device-key';
import { DeviceListService } from './device-list.service';
import { KeysService } from './keys.service';
import { OwnRecoveryService } from './own-recovery.service';
import { ReencryptService } from './reencrypt.service';

/**
 * The silent key of a person, from the first sign-in to a second account on the same browser: made, published, retried, published again, and wiped
 * for a brand-new account. The server is a small fake kept in memory; the keys, the key store and the browser are real (karma, Chrome).
 */
describe('KeysService: the key of this device', () => {
  let originalTimeout: number;
  beforeAll(() => {
    originalTimeout = jasmine.DEFAULT_TIMEOUT_INTERVAL;
    jasmine.DEFAULT_TIMEOUT_INTERVAL = 180_000; // 3072 bit keys take a few seconds each
  });
  afterAll(async () => {
    jasmine.DEFAULT_TIMEOUT_INTERVAL = originalTimeout;
    await wipeDeviceKeys();
  });
  beforeEach(async () => {
    await wipeDeviceKeys();
    localStorage.clear();
  });

  /** A fake server for the keys of one person: GET /keys, POST /keys (idempotent), the signed list, revoke. `failPosts` = how many POST /keys fail first. */
  class FakeServer {
    keys: PublishedKey[] = [];
    /** the stamp of the account that the server tells ( "" = it does not know one) */
    accountId = 'stamp-of-this-account';
    lists: unknown[] = [];
    posts = 0;
    failPosts = 0;
    revoked: string[] = [];
    /** the keys this device said "opens everything" for (POST /own-recovery/works); `worksStatus` = what the server answers (409 = it lacks copies) */
    works: string[] = [];
    worksStatus = 200;
    /** the signed list is not accepted until this is released (null = at once); `failLists` = how many list posts fail first */
    listGate: Promise<void> | null = null;
    failLists = 0;
    /** mark every key of mine `waiting` (it is not in my signed list) */
    allWaiting = false;

    readonly api = {
      request: async (path: string, init?: { method?: string; body?: string }): Promise<unknown> => {
        const method = init?.method ?? 'GET';
        if (path === '/keys' && method === 'GET') return { keys: this.keys.map((k) => ({ ...k, ...(this.allWaiting ? { waiting: true } : {}) })), hasBackup: false, backups: [], accountId: this.accountId } satisfies MyKeys;
        if (path === '/keys' && method === 'POST') {
          this.posts++;
          if (this.failPosts > 0) {
            this.failPosts--;
            throw new Error('The connection was lost');
          }
          const body = JSON.parse(init!.body!);
          const publicKey = canonicalPublicKey(body.publicKey)!;
          const fingerprint = (await fingerprintOf(publicKey))!;
          const id = keyIdOf(fingerprint);
          if (!this.keys.some((k) => k.id === id)) {
            this.keys.push({ id, fingerprint, label: body.label ?? '', createdAt: new Date().toISOString(), revoked: false, publicKey, ...(body.signKey ? { signKey: body.signKey } : {}) });
          }
          return { id };
        }
        if (path === '/keys/list' && method === 'GET') return { lists: this.lists };
        if (path === '/keys/list' && method === 'POST') {
          if (this.listGate) await this.listGate;
          if (this.failLists > 0) {
            this.failLists--;
            throw new Error('The connection was lost');
          }
          this.lists.push(JSON.parse(init!.body!));
          return {};
        }
        if (path === '/own-recovery/works' && method === 'POST') {
          this.works.push(JSON.parse(init!.body!).key);
          if (this.worksStatus !== 200) throw new Error('409');
          return { ok: true };
        }
        const revoke = /^\/keys\/([^/]+)\/revoke$/.exec(path);
        if (revoke && method === 'POST') {
          this.revoked.push(revoke[1]);
          const key = this.keys.find((k) => k.id === revoke[1]);
          if (key) key.revoked = true;
          return {};
        }
        throw new Error(`unexpected request ${method} ${path}`);
      },
    };
  }

  /** The service for one person, with the fake server and a fake sign-in. `fresh` = the account was created by this very sign-in. */
  const start = (uid: string, server: FakeServer, fresh: boolean) => {
    let isFresh = fresh;
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiService, useValue: server.api },
        { provide: AuthService, useValue: { user: signal({ uid }), isFreshAccount: (u: string) => isFresh && u === uid, doneFresh: () => { isFresh = false; } } },
        { provide: DeviceListService, useValue: {} },
        { provide: OwnRecoveryService, useValue: { madeKey: () => undefined } },
        { provide: ReencryptService, useValue: { run: async () => undefined } },
      ],
    });
    return TestBed.inject(KeysService);
  };

  const person = () => `test-${crypto.randomUUID()}`;

  it('makes the key by itself at the first sign-in, publishes it, and starts the signed device list', async () => {
    const uid = person();
    const server = new FakeServer();
    const keys = start(uid, server, true);
    await keys.refresh();
    expect(keys.state()).toBe('ready');
    expect(keys.createError()).toBeNull();
    expect(server.keys.length).toBe(1);
    expect(keys.thisKeyId()).toBe(server.keys[0].id);
    expect((await getDeviceKey(uid))?.id).toBeDefined();
    await new Promise((resolve) => setTimeout(resolve, 100)); // the list is published a moment later
    expect(server.lists.length).toBe(1);
  });

  it('a second look finds the key and makes no second one', async () => {
    const uid = person();
    const server = new FakeServer();
    const keys = start(uid, server, true);
    await keys.refresh();
    const first = keys.thisKeyId();
    await keys.refresh();
    await keys.refresh();
    expect(keys.thisKeyId()).toBe(first);
    expect(server.keys.length).toBe(1);
    expect(server.posts).toBe(1);
  });

  it('a brand-new account wipes every old key in the browser before its own is made', async () => {
    const old = person();
    await createDeviceKey(old); // the stuck key of an account that is gone
    const uid = person();
    const server = new FakeServer();
    const keys = start(uid, server, true);
    await keys.refresh();
    expect(keys.state()).toBe('ready');
    expect(await storedKeyOwners()).toEqual([uid]); // only the new account's key is left
  });

  it('an existing account that gets a key on a new device does NOT wipe the other keys', async () => {
    const other = person();
    const kept = (await createDeviceKey(other)).key;
    const uid = person();
    const keys = start(uid, new FakeServer(), false);
    await keys.refresh();
    expect(keys.state()).toBe('ready');
    expect((await getDeviceKey(other))?.id).toBe(kept.id);
    expect((await storedKeyOwners()).sort()).toEqual([other, uid].sort());
  });

  it('a failed first try leaves no key behind, says why, and the next look (after the pause) or "Try again" makes it', async () => {
    const uid = person();
    const server = new FakeServer();
    server.failPosts = 1;
    const keys = start(uid, server, true);
    await keys.refresh();
    expect(keys.state()).toBe('none');
    expect(keys.createError()).toContain('connection was lost');
    expect(await getDeviceKey(uid)).toBeNull(); // put back as it was
    expect(server.keys.filter((k) => !k.revoked).length).toBe(0);

    await keys.refresh(); // too soon: not tried again within 30 seconds
    expect(keys.state()).toBe('none');
    expect(server.posts).toBe(1);

    await keys.retryIdentity(); // the button: now
    expect(keys.state()).toBe('ready');
    expect(keys.createError()).toBeNull();
    expect(server.keys.filter((k) => !k.revoked).length).toBe(1);
  });

  it('a key that was made on the device but never reached the server is published, not replaced', async () => {
    const uid = person();
    const stuck = await generateIdentityKey();
    await saveDeviceKey(uid, stuck); // the page closed before the key was sent
    const server = new FakeServer();
    const keys = start(uid, server, false);
    await keys.refresh();
    expect(keys.state()).toBe('ready');
    expect(server.keys.length).toBe(1);
    expect(keys.thisKeyId()).toBe(keyIdOf((await fingerprintOf(canonicalPublicKey(stuck.publicKey)!))!)); // the same key
    expect((await getDeviceKey(uid))?.id).toBe(stuck.id);
  });

  it('a key that the server has retired is never published again, and no new key is forced on the device', async () => {
    const uid = person();
    const retired = await generateIdentityKey();
    await saveDeviceKey(uid, retired);
    const server = new FakeServer();
    const publicKey = canonicalPublicKey(retired.publicKey)!;
    const fingerprint = (await fingerprintOf(publicKey))!;
    server.keys.push({ id: keyIdOf(fingerprint), fingerprint, label: '', createdAt: null, revoked: true, publicKey });
    const keys = start(uid, server, false);
    await keys.refresh();
    expect(keys.state()).toBe('none');
    expect(server.posts).toBe(0);
    expect(keys.diagnosis()?.localPublished).toBe('removed');
  });

  it('account deleted, then created again: the old key is wiped and the new account gets a new key', async () => {
    const first = person();
    const server1 = new FakeServer();
    const keys1 = start(first, server1, true);
    await keys1.refresh();
    const firstKey = keys1.thisKeyId();
    expect(keys1.state()).toBe('ready');

    await wipeDeviceKeys(); // what deleting the account does in this browser
    expect(await storedKeyOwners()).toEqual([]);

    const second = person(); // the same person signs up again: a new account
    const server2 = new FakeServer();
    const keys2 = start(second, server2, true);
    await keys2.refresh();
    expect(keys2.state()).toBe('ready');
    expect(keys2.thisKeyId()).not.toBe(firstKey);
    expect(await storedKeyOwners()).toEqual([second]);
  });

  it('a new account on a browser that still holds the key of an account that was deleted elsewhere starts clean', async () => {
    const ghost = person();
    await saveDeviceKey(ghost, await generateIdentityKey());
    const uid = person();
    const keys = start(uid, new FakeServer(), true);
    await keys.refresh();
    expect(keys.state()).toBe('ready');
    expect(await getDeviceKey(ghost)).toBeNull();
  });

  it('wipes only once: after its first key the account never wipes the store again', async () => {
    const uid = person();
    const server = new FakeServer();
    const keys = start(uid, server, true);
    await keys.refresh();
    const other = person();
    const survivor = (await createDeviceKey(other)).key; // another account signs in later in the same browser
    await keys.refresh();
    expect((await getDeviceKey(other))?.id).toBe(survivor.id);
  });

  describe('the stamp of the account', () => {
    it('a key made now carries the stamp, and this browser remembers the pair', async () => {
      const uid = person();
      const server = new FakeServer();
      const keys = start(uid, server, true);
      await keys.refresh();
      expect(keys.state()).toBe('ready');
      expect((await getDeviceKey(uid))?.accountId).toBe('stamp-of-this-account');
      expect(keys.accountId()).toBe('stamp-of-this-account');
      expect(rememberedAccounts()).toEqual([{ uid, accountId: 'stamp-of-this-account' }]);
    });

    it('a key from before the stamp (none on it) gets it, and stays the same key', async () => {
      const uid = person();
      const old = await generateIdentityKey();
      await saveDeviceKey(uid, old);
      expect((await getDeviceKey(uid))?.accountId).toBeUndefined();
      const server = new FakeServer();
      const keys = start(uid, server, false);
      await keys.refresh();
      const stamped = await getDeviceKey(uid);
      expect(stamped?.accountId).toBe('stamp-of-this-account');
      expect(stamped?.id).toBe(old.id);
      expect(keys.state()).toBe('ready'); // it was published as it was, with its signing key
      expect(server.keys).toHaveSize(1);
      expect(rememberedAccounts()[0]).toEqual({ uid, accountId: 'stamp-of-this-account' });
    });

    it('a key that already has the stamp is not written again', async () => {
      const uid = person();
      const keys = start(uid, new FakeServer(), true);
      await keys.refresh();
      const first = await getDeviceKey(uid);
      await keys.refresh();
      await keys.refresh();
      const again = await getDeviceKey(uid);
      expect(again?.id).toBe(first?.id);
      expect(again?.accountId).toBe(first?.accountId);
    });

    it('a key with ANOTHER stamp is from a life of the account that is gone: it is dropped and a new key is made', async () => {
      const uid = person();
      const dead = await generateIdentityKey();
      await saveDeviceKey(uid, { ...dead, accountId: 'stamp-of-a-deleted-account' });
      const server = new FakeServer();
      const keys = start(uid, server, false);
      await keys.refresh();
      expect(keys.state()).toBe('ready');
      const now = await getDeviceKey(uid);
      expect(now?.id).not.toBe(dead.id);
      expect(now?.accountId).toBe('stamp-of-this-account');
      expect(server.keys.filter((k) => !k.revoked)).toHaveSize(1);
      expect(rememberedAccounts()).toEqual([{ uid, accountId: 'stamp-of-this-account' }]);
    });

    it('when the server does not know a stamp, nothing is stamped, remembered, dropped or changed', async () => {
      const uid = person();
      const mine = await generateIdentityKey();
      await saveDeviceKey(uid, { ...mine, accountId: 'stamp-of-this-account' });
      const server = new FakeServer();
      server.accountId = '';
      const keys = start(uid, server, false);
      await keys.refresh();
      expect((await getDeviceKey(uid))?.accountId).toBe('stamp-of-this-account'); // not dropped because of a missing answer
      expect(rememberedAccounts()).toEqual([]);
      expect(keys.accountId()).toBe('');
    });

    it('two people on one browser: each key has its own stamp and each pair is remembered', async () => {
      const [a, b] = [person(), person()];
      const first = start(a, new FakeServer(), true);
      await first.refresh();
      const second = start(b, Object.assign(new FakeServer(), { accountId: 'stamp-of-b' }), false);
      await second.refresh();
      expect((await getDeviceKey(a))?.accountId).toBe('stamp-of-this-account');
      expect((await getDeviceKey(b))?.accountId).toBe('stamp-of-b');
      expect(rememberedAccounts().map((x) => x.uid).sort()).toEqual([a, b].sort());
    });

    it('an account deleted and made again with the same user id: the old key is dropped, and the key made next carries the new stamp', async () => {
      const uid = person();
      const server1 = new FakeServer();
      const keys1 = start(uid, server1, true);
      await keys1.refresh();
      const firstKey = keys1.thisKeyId();
      const server2 = new FakeServer(); // the account was deleted and made again: a new server state with a new stamp
      server2.accountId = 'stamp-of-the-new-life';
      const keys2 = start(uid, server2, false);
      await keys2.refresh();
      expect(keys2.state()).toBe('ready');
      expect(keys2.thisKeyId()).not.toBe(firstKey);
      expect((await getDeviceKey(uid))?.accountId).toBe('stamp-of-the-new-life');
      expect(rememberedAccounts()).toEqual([{ uid, accountId: 'stamp-of-the-new-life' }]);
    });

    it('a remembered pair of another account is not changed by this account', async () => {
      rememberAccount('someone-else', 'their-stamp');
      const keys = start(person(), new FakeServer(), true);
      await keys.refresh();
      expect(rememberedAccounts().find((a) => a.uid === 'someone-else')?.accountId).toBe('their-stamp');
    });
  });

  describe('approval by my other devices (no tap, no device retired)', () => {
    /** the service with a stub of the approval service that records what it is asked */
    const withApproval = (uid: string, server: FakeServer, mine: { value: unknown }) => {
      const calls = { refreshMine: 0, ask: 0 };
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          { provide: ApiService, useValue: server.api },
          { provide: AuthService, useValue: { user: signal({ uid }), isFreshAccount: () => false, doneFresh: () => undefined } },
          { provide: DeviceListService, useValue: {} },
          { provide: OwnRecoveryService, useValue: { madeKey: () => undefined, mine: () => mine.value, refreshMine: async () => { calls.refreshMine++; }, ask: async () => { calls.ask++; mine.value = { status: 'asked' }; } } },
          { provide: ReencryptService, useValue: { run: async () => undefined } },
        ],
      });
      return { keys: TestBed.inject(KeysService), calls };
    };
    const settle = () => new Promise((resolve) => setTimeout(resolve, 200));

    it('a device that is not approved asks my other devices by itself, once, with no tap', async () => {
      const uid = person();
      const server = new FakeServer();
      const mine = { value: null as unknown };
      const { keys, calls } = withApproval(uid, server, mine);
      await keys.refresh(); // makes its key
      server.allWaiting = true; // the server says it is not in my list
      await keys.refresh();
      await settle();
      expect(calls.ask).toBe(1);
      await keys.refresh();
      await keys.refresh();
      await settle();
      expect(calls.ask).toBe(1); // not again at every look
      expect(server.revoked).toEqual([]); // nobody was retired
    });

    it('a device that already has a request does not make another', async () => {
      const uid = person();
      const server = new FakeServer();
      const { keys, calls } = withApproval(uid, server, { value: { status: 'asked' } });
      await keys.refresh();
      server.allWaiting = true;
      await keys.refresh();
      await settle();
      expect(calls.ask).toBe(0);
    });

    it('an approved device says that its key opens everything, once, and never asks', async () => {
      const uid = person();
      const server = new FakeServer();
      const { keys, calls } = withApproval(uid, server, { value: null });
      await keys.refresh();
      await keys.refresh();
      await settle();
      expect(server.works).toEqual([keys.thisKeyId()!]);
      expect(calls.ask).toBe(0);
    });

    it('when the server says some copies are missing, nothing breaks and the device still works', async () => {
      const uid = person();
      const server = new FakeServer();
      server.worksStatus = 409;
      const { keys } = withApproval(uid, server, { value: null });
      await keys.refresh();
      await settle();
      expect(keys.state()).toBe('ready');
      expect(server.works.length).toBe(1);
    });
  });

  describe('the keys are properly set (inviteReady): a friend link waits for it', () => {
    const settle = () => new Promise((resolve) => setTimeout(resolve, 200));

    it('is false while the key is being made, and while the signed device list is not published yet, then true', async () => {
      const uid = person();
      const server = new FakeServer();
      let release!: () => void;
      server.listGate = new Promise<void>((resolve) => (release = resolve));
      const keys = start(uid, server, true);
      expect(keys.inviteReady()).toBe(false); // nothing is known yet
      await keys.refresh();
      expect(keys.state()).toBe('ready');
      await settle();
      expect(server.lists.length).toBe(0);
      expect(keys.inviteReady()).toBe(false); // the key is there but the list is not
      release();
      await settle();
      expect(server.lists.length).toBe(1);
      expect(keys.inviteReady()).toBe(true);
    });

    it('stays false when the list could not be published, and becomes true at the next look that succeeds', async () => {
      const uid = person();
      const server = new FakeServer();
      server.failLists = 1;
      const keys = start(uid, server, true);
      await keys.refresh();
      await settle();
      expect(keys.inviteReady()).toBe(false);
      await keys.refresh(); // the next look tries the list again
      await settle();
      expect(server.lists.length).toBe(1);
      expect(keys.inviteReady()).toBe(true);
    });

    it('is false when no key could be made (the link keeps waiting), and true once it is made', async () => {
      const uid = person();
      const server = new FakeServer();
      server.failPosts = 1;
      const keys = start(uid, server, true);
      await keys.refresh();
      expect(keys.state()).toBe('none');
      expect(keys.inviteReady()).toBe(false);
      await keys.retryIdentity();
      await settle();
      expect(keys.state()).toBe('ready');
      expect(keys.inviteReady()).toBe(true);
    });

    it('is false for a device that another device has not approved yet, and true when it is approved', async () => {
      const uid = person();
      const server = new FakeServer();
      const keys = start(uid, server, true);
      await keys.refresh();
      await settle();
      expect(keys.inviteReady()).toBe(true);
      server.allWaiting = true; // the server says this key is not in my signed list
      await keys.refresh();
      expect(keys.inviteReady()).toBe(false);
      server.allWaiting = false; // approved
      await keys.refresh();
      expect(keys.inviteReady()).toBe(true);
    });

    it('untilInviteReady waits for the list and says true, and says false when the keys never become ready', async () => {
      const server = new FakeServer();
      let release!: () => void;
      server.listGate = new Promise<void>((resolve) => (release = resolve));
      const keys = start(person(), server, true);
      await keys.refresh();
      const waiting = keys.untilInviteReady(5000);
      setTimeout(release, 300);
      expect(await waiting).toBe(true);
      expect(keys.inviteReady()).toBe(true);

      const broken = new FakeServer();
      broken.failPosts = 100; // the key can never be published
      const never = start(person(), broken, true);
      expect(await never.untilInviteReady(700)).toBe(false);
      expect(never.inviteReady()).toBe(false);
    });

    it('another person signing in does not inherit it', async () => {
      const server = new FakeServer();
      const keys = start(person(), server, true);
      await keys.refresh();
      await settle();
      expect(keys.inviteReady()).toBe(true);
      const other = start(person(), new FakeServer(), true); // a fresh service: nothing known yet
      expect(other.inviteReady()).toBe(false);
    });
  });
});
