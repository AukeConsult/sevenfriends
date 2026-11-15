import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { rememberAccount, rememberedAccounts } from './account-registry';
import { AccountWatchService } from './account-watch.service';
import { AuthService, LAST_UID_KEY } from './auth.service';
import { createDeviceKey, getDeviceKey, storedKeyOwners, wipeDeviceKeys } from './device-key';
import { UiPreferencesService } from './ui-preferences';

/**
 * A device that holds an account that was deleted somewhere else wipes it. The server is a fake (what `fetch` answers); the keys, the key store and the
 * browser storage are real (karma, Chrome). The safety rules are tested as hard as the wipe: a doubt never wipes anything.
 */
describe('AccountWatchService: an account deleted elsewhere is wiped from this device', () => {
  let originalTimeout: number;
  beforeAll(() => {
    originalTimeout = jasmine.DEFAULT_TIMEOUT_INTERVAL;
    jasmine.DEFAULT_TIMEOUT_INTERVAL = 120_000;
  });
  afterAll(async () => {
    jasmine.DEFAULT_TIMEOUT_INTERVAL = originalTimeout;
    await wipeDeviceKeys();
    localStorage.clear();
  });
  beforeEach(async () => {
    await wipeDeviceKeys();
    localStorage.clear();
    sessionStorage.clear();
  });

  type Fake = { uid: string; getIdToken: (refresh?: boolean) => Promise<string> };
  /** what the server says: the answer of the account check for each user id, and what the API says to a signed-in call */
  interface Server {
    answers: Record<string, unknown>; // a status, or a function that gives a Response
    check: { uid: string; accountId: string }[];
    apiStatus: number;
    failFetch: boolean;
  }

  let server: Server;
  let user: ReturnType<typeof signal<Fake | null>>;
  let auth: { user: ReturnType<typeof signal<Fake | null>>; logout: jasmine.Spy };
  let prefs: { clearAccountChoices: jasmine.Spy };

  const start = (signedIn: Fake | null = null) => {
    server = { answers: {}, check: [], apiStatus: 200, failFetch: false };
    user = signal<Fake | null>(signedIn);
    auth = { user, logout: jasmine.createSpy('logout').and.callFake(async () => user.set(null)) };
    prefs = { clearAccountChoices: jasmine.createSpy('clearAccountChoices') };
    spyOn(window, 'fetch').and.callFake(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (server.failFetch) throw new TypeError('Failed to fetch');
      const url = String(input);
      if (url.endsWith('/accounts/check')) {
        const body = JSON.parse(String(init?.body));
        server.check.push(body);
        const answer = server.answers[body.uid];
        if (typeof answer === 'function') return (answer as () => Response)();
        return new Response(JSON.stringify({ status: answer ?? 'active' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.endsWith('/keys')) return new Response('{}', { status: server.apiStatus });
      throw new Error(`unexpected fetch ${url}`);
    });
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: auth },
        { provide: UiPreferencesService, useValue: prefs },
      ],
    });
    const service = TestBed.inject(AccountWatchService);
    service.delayMs = 0;
    spyOn(service as unknown as { goHome(): void }, 'goHome');
    return service;
  };

  const withKey = async (uid: string, stamp = `stamp-${uid}`) => {
    await createDeviceKey(uid);
    rememberAccount(uid, stamp);
  };
  const signedIn = (uid: string, token: () => Promise<string> = async () => 'token'): Fake => ({ uid, getIdToken: async () => token() });

  it('does nothing when this browser holds no account (and asks nobody)', async () => {
    const service = start();
    await service.checkAll(true);
    expect(server.check).toEqual([]);
  });

  it('an account that is still there is left alone: key, pair and everything stay', async () => {
    const service = start();
    await withKey('alive');
    server.answers['alive'] = 'active';
    await service.checkAll(true);
    expect(server.check).toEqual([{ uid: 'alive', accountId: 'stamp-alive' }]);
    expect(await getDeviceKey('alive')).not.toBeNull();
    expect(rememberedAccounts().map((a) => a.uid)).toEqual(['alive']);
    expect(service.wiped()).toEqual([]);
  });

  it('an account that is gone is wiped: its key and its pair are gone, and the other account on this browser keeps both', async () => {
    const service = start();
    await withKey('gone');
    await withKey('stays');
    server.answers['gone'] = 'gone';
    server.answers['stays'] = 'active';
    await service.checkAll(true);
    expect(await getDeviceKey('gone')).toBeNull();
    expect(await getDeviceKey('stays')).not.toBeNull();
    expect(rememberedAccounts().map((a) => a.uid)).toEqual(['stays']);
    expect(service.wiped()).toEqual(['gone']);
    expect(localStorage.getItem('sf-accounts')).toContain('stays'); // nothing of the other account was touched
  });

  it('when it was the ONLY account here, everything is wiped: every key, every local choice, other databases', async () => {
    const service = start();
    await withKey('only');
    localStorage.setItem('sf-ui', '{"theme":"dark"}');
    localStorage.setItem(`sf-list-pin:only:friend`, '2');
    sessionStorage.setItem('x', '1');
    const database = `sf-test-${crypto.randomUUID()}`;
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(database, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('t');
      request.onsuccess = () => { request.result.close(); resolve(); };
      request.onerror = () => reject(request.error);
    });
    server.answers['only'] = 'gone';
    await service.checkAll(true);
    expect(await storedKeyOwners()).toEqual([]);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect((await indexedDB.databases()).map((d) => d.name)).not.toContain(database);
  });

  it('with other accounts left, only the gone one\'s pins and last-user marks go', async () => {
    const service = start();
    await withKey('gone');
    await withKey('stays');
    localStorage.setItem('sf-list-pin:gone:friend', '1');
    localStorage.setItem('sf-list-pin:stays:friend', '1');
    localStorage.setItem(LAST_UID_KEY, 'gone');
    sessionStorage.setItem('x', '1');
    server.answers['gone'] = 'gone';
    await service.checkAll(true);
    expect(localStorage.getItem('sf-list-pin:gone:friend')).toBeNull();
    expect(localStorage.getItem('sf-list-pin:stays:friend')).toBe('1');
    expect(localStorage.getItem(LAST_UID_KEY)).toBeNull();
    expect(prefs.clearAccountChoices).toHaveBeenCalledTimes(1);
    expect(sessionStorage.length).toBe(0);
  });

  it('the last-user mark of ANOTHER account is not touched', async () => {
    const service = start();
    await withKey('gone');
    await withKey('stays');
    localStorage.setItem(LAST_UID_KEY, 'stays');
    server.answers['gone'] = 'gone';
    await service.checkAll(true);
    expect(localStorage.getItem(LAST_UID_KEY)).toBe('stays');
    expect(prefs.clearAccountChoices).not.toHaveBeenCalled();
  });

  it('two accounts that are both gone are both wiped', async () => {
    const service = start();
    await withKey('a');
    await withKey('b');
    server.answers['a'] = 'gone';
    server.answers['b'] = 'gone';
    await service.checkAll(true);
    expect(service.wiped().sort()).toEqual(['a', 'b']);
    expect(await storedKeyOwners()).toEqual([]);
  });

  describe('a doubt never wipes anything', () => {
    for (const [name, answer] of [
      ['an answer that is not a status', { nothing: true }],
      ['an unknown status', 'maybe'],
      ['no status at all', undefined],
    ] as const) {
      it(`${name}`, async () => {
        const service = start();
        await withKey('u');
        server.answers['u'] = () => new Response(JSON.stringify(answer === undefined ? {} : typeof answer === 'string' ? { status: answer } : answer), { status: 200 });
        await service.checkAll(true);
        expect(await getDeviceKey('u')).not.toBeNull();
        expect(service.wiped()).toEqual([]);
      });
    }

    it('a server error (500, 404, 429)', async () => {
      const service = start();
      await withKey('u');
      for (const status of [500, 404, 429, 503]) {
        server.answers['u'] = () => new Response(JSON.stringify({ status: 'gone' }), { status });
        await service.checkAll(true);
        expect(await getDeviceKey('u')).not.toBeNull();
      }
      expect(service.wiped()).toEqual([]);
    });

    it('a page that is not ours (a captive portal answers with html)', async () => {
      const service = start();
      await withKey('u');
      server.answers['u'] = () => new Response('<html>please log in to the wifi</html>', { status: 200 });
      await service.checkAll(true);
      expect(await getDeviceKey('u')).not.toBeNull();
    });

    it('no connection', async () => {
      const service = start();
      await withKey('u');
      server.failFetch = true;
      await service.checkAll(true);
      expect(await getDeviceKey('u')).not.toBeNull();
      expect(rememberedAccounts()).toHaveSize(1);
      expect(service.wiped()).toEqual([]);
    });

    it('"gone" once and then "active": the second answer wins', async () => {
      const service = start();
      await withKey('u');
      let calls = 0;
      server.answers['u'] = () => new Response(JSON.stringify({ status: ++calls === 1 ? 'gone' : 'active' }), { status: 200 });
      await service.checkAll(true);
      expect(await getDeviceKey('u')).not.toBeNull();
      expect(calls).toBe(2);
    });

    it('"gone" once and then a failure: nothing is wiped', async () => {
      const service = start();
      await withKey('u');
      let calls = 0;
      server.answers['u'] = () => (++calls === 1 ? new Response(JSON.stringify({ status: 'gone' }), { status: 200 }) : new Response('x', { status: 500 }));
      await service.checkAll(true);
      expect(await getDeviceKey('u')).not.toBeNull();
    });

    it('a stamp or user id that is damaged in the registry is never asked about', async () => {
      const service = start();
      localStorage.setItem('sf-accounts', '{"u":5}');
      await service.checkAll(true);
      expect(server.check).toEqual([]);
    });
  });

  describe('an account that is signed in on this device', () => {
    it('is NOT wiped when the check says gone but the login still works (a fresh token and an API that answers)', async () => {
      const service = start(signedIn('me'));
      await withKey('me');
      server.answers['me'] = 'gone';
      server.apiStatus = 200;
      await service.checkAll(true);
      expect(await getDeviceKey('me')).not.toBeNull();
      expect(auth.logout).not.toHaveBeenCalled();
      expect(service.wiped()).toEqual([]);
    });

    it('is NOT wiped when the API cannot be reached', async () => {
      const service = start(signedIn('me'));
      await withKey('me');
      server.answers['me'] = 'gone';
      (window.fetch as jasmine.Spy).and.callFake(async (input: RequestInfo | URL) => {
        if (String(input).endsWith('/accounts/check')) return new Response(JSON.stringify({ status: 'gone' }), { status: 200 });
        throw new TypeError('offline');
      });
      await service.checkAll(true);
      expect(await getDeviceKey('me')).not.toBeNull();
    });

    it('is wiped, signed out and sent to a clean start when Firebase refuses a fresh token (the login was deleted)', async () => {
      const service = start(signedIn('me', async () => { throw Object.assign(new Error('gone'), { code: 'auth/user-not-found' }); }));
      await withKey('me');
      server.answers['me'] = 'gone';
      await service.checkAll(true);
      expect(await getDeviceKey('me')).toBeNull();
      expect(auth.logout).toHaveBeenCalledTimes(1);
      expect((service as unknown as { goHome: jasmine.Spy }).goHome).toHaveBeenCalledTimes(1);
      expect(service.wiped()).toEqual(['me']);
    });

    it('is wiped when the server refuses the login (401)', async () => {
      const service = start(signedIn('me'));
      await withKey('me');
      server.answers['me'] = 'gone';
      server.apiStatus = 401;
      await service.checkAll(true);
      expect(await getDeviceKey('me')).toBeNull();
      expect(auth.logout).toHaveBeenCalled();
    });

    for (const code of ['auth/network-request-failed', 'auth/too-many-requests', 'auth/internal-error', '']) {
      it('is NOT wiped when the token fails for another reason than "the login is gone": ' + (code || 'no code'), async () => {
        const service = start(signedIn('me', async () => { throw Object.assign(new Error('x'), { code }); }));
        await withKey('me');
        server.answers['me'] = 'gone';
        await service.checkAll(true);
        expect(await getDeviceKey('me')).not.toBeNull();
        expect(auth.logout).not.toHaveBeenCalled();
      });
    }

    it('another account being gone does not sign this one out', async () => {
      const service = start(signedIn('me'));
      await withKey('me');
      await withKey('other');
      server.answers['other'] = 'gone';
      server.answers['me'] = 'active';
      await service.checkAll(true);
      expect(auth.logout).not.toHaveBeenCalled();
      expect(await getDeviceKey('me')).not.toBeNull();
      expect(await getDeviceKey('other')).toBeNull();
      expect((service as unknown as { goHome: jasmine.Spy }).goHome).not.toHaveBeenCalled();
    });
  });

  describe('when it asks', () => {
    it('one run at a time: calls while it runs share the run', async () => {
      const service = start();
      await withKey('u');
      const [a, b] = [service.checkAll(true), service.checkAll(true)];
      await Promise.all([a, b]);
      expect(server.check).toHaveSize(1);
    });

    it('not again within 30 seconds, unless forced', async () => {
      const service = start();
      await withKey('u');
      await service.checkAll(true);
      await service.checkAll();
      await service.checkAll();
      expect(server.check).toHaveSize(1);
      await service.checkAll(true);
      expect(server.check).toHaveSize(2);
    });

    it('asks again when the app comes back to the front and when the connection returns', async () => {
      const service = start();
      await withKey('u');
      await service.checkAll(true);
      (service as unknown as { lastRun: number }).lastRun = 0;
      window.dispatchEvent(new Event('sf-resume'));
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(server.check.length).toBeGreaterThanOrEqual(2);
      const before = server.check.length;
      window.dispatchEvent(new Event('online'));
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(server.check.length).toBeGreaterThan(before);
    });

    it('a destroyed service listens no more', async () => {
      const service = start();
      await withKey('u');
      TestBed.resetTestingModule();
      window.dispatchEvent(new Event('sf-resume'));
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(server.check).toEqual([]);
      expect(service.wiped()).toEqual([]);
    });
  });

  it('after a wipe a new account can sign in on the same browser and make a key at once', async () => {
    const service = start();
    await withKey('old');
    server.answers['old'] = 'gone';
    await service.checkAll(true);
    expect(await storedKeyOwners()).toEqual([]);
    await createDeviceKey('new');
    rememberAccount('new', 'stamp-new');
    expect(await storedKeyOwners()).toEqual(['new']);
    expect(rememberedAccounts()).toEqual([{ uid: 'new', accountId: 'stamp-new' }]);
  });
});
