import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActiveCircleService } from './active-circle.service';
import { ApiService } from './api.service';
import { FriendsService } from './friends.service';
import { KeysService } from './keys.service';
import { UiPreferencesService } from './ui-preferences';

/** A friendship is never confirmed before MY keys are properly set: no request goes to the server, and the request stays as it is. */
describe('FriendsService.acceptRequest: waits for my keys', () => {
  const setup = (ready: boolean, result: 'confirmed' | 'no-seats' = 'confirmed') => {
    const calls: string[] = [];
    const waited: number[] = [];
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiService, useValue: { request: async (path: string) => { calls.push(path); return { ok: true, result }; } } },
        { provide: UiPreferencesService, useValue: { get: () => null, value: () => signal(null) } },
        { provide: ActiveCircleService, useValue: { onSwitch: () => undefined, id: 'default', generation: 0 } },
        { provide: KeysService, useValue: { untilInviteReady: async (ms?: number) => { waited.push(ms ?? 0); return ready; } } },
      ],
    });
    const service = TestBed.inject(FriendsService);
    service.requests.set([{ id: 'r1' } as never, { id: 'r2' } as never]);
    return { service, calls, waited };
  };

  it('keys ready: the request is confirmed and leaves the list', async () => {
    const { service, calls } = setup(true);
    expect(await service.acceptRequest('r1')).toBe('confirmed');
    expect(calls).toEqual(['/friend-requests/r1/accept']);
    expect(service.requests().map((r) => r.id)).toEqual(['r2']);
  });

  it('keys not ready: nothing is sent to the server, the request stays, and the person is told to wait', async () => {
    const { service, calls } = setup(false);
    let error: { status?: number; message?: string } | null = null;
    try {
      await service.acceptRequest('r1');
    } catch (err) {
      error = err as { status?: number; message?: string };
    }
    expect(error?.status).toBe(409);
    expect(error?.message).toContain('still being set up');
    expect(calls).toEqual([]);
    expect(service.requests().map((r) => r.id)).toEqual(['r1', 'r2']);
  });

  it('keys ready but no free seat: the request stays pending, as before', async () => {
    const { service, calls } = setup(true, 'no-seats');
    expect(await service.acceptRequest('r1')).toBe('no-seats');
    expect(calls.length).toBe(1);
    expect(service.requests().length).toBe(2);
  });
});

/** Nobody is asked to be a friend before MY keys are properly set. */
describe('FriendsService.add: no request before my keys are set', () => {
  const setup = (ready: boolean) => {
    const calls: { path: string; method?: string }[] = [];
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiService, useValue: { request: async (path: string, init?: { method?: string }) => { calls.push({ path, method: init?.method }); return path === '/circles' ? { circles: [{ id: 'default' }] } : path.endsWith('/friends') && !init?.method ? { friends: [] } : { id: 'f1', name: 'Kari' }; } } },
        { provide: UiPreferencesService, useValue: { get: () => null, value: () => signal(null) } },
        { provide: ActiveCircleService, useValue: { onSwitch: () => undefined, id: 'default', generation: 0 } },
        { provide: KeysService, useValue: { untilInviteReady: async () => ready } },
      ],
    });
    return { service: TestBed.inject(FriendsService), calls };
  };
  const body = { name: 'Kari', email: 'kari@example.com', phone: null, message: null };

  it('keys not ready: no request is sent, nothing is even loaded, and the person is told to wait', async () => {
    const { service, calls } = setup(false);
    let error: { status?: number; message?: string } | null = null;
    try {
      await service.add(body);
    } catch (err) {
      error = err as { status?: number; message?: string };
    }
    expect(error?.status).toBe(409);
    expect(error?.message).toContain('still being set up');
    expect(calls).toEqual([]);
    expect(service.friends()).toEqual([]);
  });

  it('keys ready: the request is sent and the friend is in the list', async () => {
    const { service, calls } = setup(true);
    const friend = await service.add(body);
    expect(friend.id).toBe('f1');
    expect(calls.some((c) => c.method === 'POST' && c.path.endsWith('/friends'))).toBe(true);
    expect(service.friends().map((f) => f.id)).toEqual(['f1']);
  });
});
