import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActiveCircleService } from './active-circle.service';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { AutoInviteService } from './auto-invite.service';
import { FriendLinkService } from './friend-link.service';
import { FriendsService } from './friends.service';
import { KeysService } from './keys.service';

/**
 * A friend link is not answered before the account is fully made and its keys are properly set (`KeysService.inviteReady`): not by itself for a new account, not by the page
 * that asks, and it is still there (kept) when the keys become ready.
 */
describe('AutoInviteService: a friend link waits for the keys', () => {
  const setup = (opts: { user?: boolean; link?: boolean; ready?: boolean; fresh?: boolean; found?: Record<string, unknown> } = {}) => {
    const state = {
      user: signal(opts.user === false ? null : { uid: 'me', email: 'me@example.com' }),
      pending: signal<{ code?: string; email: string | null; phone: string | null; circle: string } | null>(opts.link === false ? null : { code: 'CODE1', email: null, phone: null, circle: 'friends' }),
      ready: signal(opts.ready ?? false),
      fresh: opts.fresh ?? true,
      added: [] as unknown[],
      cleared: 0,
      takeNew: 0,
      toPage: 0,
      looked: [] as string[],
    };
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiService, useValue: { request: async (path: string) => { state.looked.push(path); return opts.found ?? { self: false, name: 'Kari', email: 'kari@example.com', phone: null }; } } },
        { provide: AuthService, useValue: { user: state.user, takeNewAccount: () => { state.takeNew++; return state.fresh; } } },
        { provide: FriendLinkService, useValue: { pending: state.pending, clear: () => { state.cleared++; state.pending.set(null); } } },
        { provide: FriendsService, useValue: { add: async (body: unknown) => { state.added.push(body); } } },
        { provide: ActiveCircleService, useValue: { id: 'friends', choose: () => undefined } },
        { provide: KeysService, useValue: { inviteReady: state.ready } },
      ],
    });
    return { service: TestBed.inject(AutoInviteService), state, toPage: () => state.toPage++ };
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

  it('keys not ready: a new account does NOT answer the link, nothing is sent or looked up, and the link is kept', async () => {
    const { service, state, toPage } = setup({ ready: false, fresh: true });
    expect(service.answer('/', toPage)).toBe(false);
    await settle();
    expect(state.added).toEqual([]);
    expect(state.looked).toEqual([]);
    expect(state.toPage).toBe(0);
    expect(state.cleared).toBe(0);
    expect(state.takeNew).toBe(0); // the "this account was made just now" is kept for later
    expect(state.pending()).not.toBeNull();
  });

  it('keys not ready: the page that asks is not opened either, for an account that is not new', () => {
    const { service, state, toPage } = setup({ ready: false, fresh: false });
    expect(service.answer('/', toPage)).toBe(false);
    expect(state.toPage).toBe(0);
    expect(state.pending()).not.toBeNull();
  });

  it('keys ready, a new account: the request to the inviter is sent by itself and the link is done with', async () => {
    const { service, state, toPage } = setup({ ready: true, fresh: true });
    expect(service.answer('/', toPage)).toBe(true);
    await settle();
    expect(state.added).toEqual([{ name: 'Kari', email: 'kari@example.com', phone: null, message: null }]);
    expect(state.cleared).toBe(1);
    expect(state.toPage).toBe(0);
  });

  it('keys ready, not a new account: the page that asks is opened, nothing is sent without the tap', async () => {
    const { service, state, toPage } = setup({ ready: true, fresh: false });
    expect(service.answer('/', toPage)).toBe(true);
    await settle();
    expect(state.toPage).toBe(1);
    expect(state.added).toEqual([]);
  });

  it('the keys become ready later: the same link is answered then, as a new account', async () => {
    const { service, state, toPage } = setup({ ready: false, fresh: true });
    expect(service.answer('/', toPage)).toBe(false); // waits
    state.ready.set(true); // the key and the signed list are in place
    expect(service.answer('/', toPage)).toBe(true);
    await settle();
    expect(state.added.length).toBe(1);
    expect(state.cleared).toBe(1);
  });

  it('nothing to do: signed out, no link, or the asking page is already open', () => {
    expect(setup({ ready: true, user: false }).service.answer('/', () => undefined)).toBe(false);
    expect(setup({ ready: true, link: false }).service.answer('/', () => undefined)).toBe(false);
    const { service, state } = setup({ ready: true });
    expect(service.answer('/friends/join', () => undefined)).toBe(false);
    expect(state.added).toEqual([]);
  });

  it('an unusual link (the inviter already asked me) goes to the asking page, and my own link is just cleared', async () => {
    const asked = setup({ ready: true, fresh: true, found: { self: false, requestId: 'r1' } });
    asked.service.answer('/', asked.toPage);
    await settle();
    expect(asked.state.toPage).toBe(1);
    expect(asked.state.added).toEqual([]);
    const own = setup({ ready: true, fresh: true, found: { self: true } });
    own.service.answer('/', own.toPage);
    await settle();
    expect(own.state.cleared).toBe(1);
    expect(own.state.added).toEqual([]);
  });
});
