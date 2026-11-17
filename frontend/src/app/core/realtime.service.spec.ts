import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActiveCircleService } from './active-circle.service';
import { AuthService } from './auth.service';
import { CircleActivityService } from './circle-activity.service';
import { DesktopNoticeService } from './desktop-notice.service';
import { FriendsService } from './friends.service';
import { KeysService } from './keys.service';
import { LiveChanges } from './live-changes';
import { LockedItemsService } from './locked-items.service';
import { NotificationsService } from './notifications.service';
import { OwnRecoveryService } from './own-recovery.service';
import { PushService } from './push.service';
import { RealtimeService } from './realtime.service';
import { RecoveryInboxService } from './recovery-inbox.service';
import { SoundService } from './sound.service';

/**
 * Back in the app after being away: the live listeners are made again (new queries). The real `follow` (it loads the Firestore SDK) is replaced by a spy;
 * what is tested is WHEN a restart happens: on a visible tab and on `sf-resume`, never for nobody signed in, never while the tab is hidden, and not twice
 * within five seconds. The first snapshot of a new listener being silent is the existing "what was already there" rule of `watch` (`first`).
 */
describe('RealtimeService: coming back to the app makes the listeners again', () => {
  let service: RealtimeService;
  let follow: jasmine.Spy;
  let user: ReturnType<typeof signal<{ uid: string } | null>>;
  let visibility: DocumentVisibilityState;

  const restarts = () => follow.calls.allArgs().filter((args) => args[1] === true);
  const show = (state: DocumentVisibilityState) => {
    visibility = state;
    document.dispatchEvent(new Event('visibilitychange'));
  };

  beforeAll(() => {
    follow = spyOn(RealtimeService.prototype as unknown as { follow: () => Promise<void> }, 'follow').and.resolveTo();
    spyOnProperty(document, 'visibilityState', 'get').and.callFake(() => visibility);
    user = signal<{ uid: string } | null>({ uid: 'me' });
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: { user } },
        { provide: FriendsService, useValue: { onLoaded: () => undefined } },
        { provide: ActiveCircleService, useValue: { onSwitch: () => undefined } },
        { provide: NotificationsService, useValue: {} },
        { provide: CircleActivityService, useValue: {} },
        { provide: RecoveryInboxService, useValue: {} },
        { provide: OwnRecoveryService, useValue: {} },
        { provide: LockedItemsService, useValue: {} },
        { provide: KeysService, useValue: {} },
        { provide: SoundService, useValue: {} },
        { provide: DesktopNoticeService, useValue: {} },
        { provide: PushService, useValue: {} },
        { provide: LiveChanges, useValue: {} },
      ],
    });
    service = TestBed.inject(RealtimeService); // one service for all the tests: its listeners on the page are never removed
    TestBed.tick(); // the first start (the login effect)
  });

  beforeEach(() => {
    follow.calls.reset();
    user.set({ uid: 'me' });
    (service as unknown as { restartedAt: number }).restartedAt = 0;
    visibility = 'visible';
  });

  it('makes the listeners again, for the same person and keeping what was seen, when the tab is visible again', () => {
    show('visible');
    expect(restarts()).toEqual([['me', true]]);
  });

  it('does nothing when the tab goes into the background', () => {
    show('hidden');
    expect(follow).not.toHaveBeenCalled();
  });

  it('restarts when the Android app tells that it is back in front (no visibilitychange there)', () => {
    window.dispatchEvent(new Event('sf-resume'));
    expect(restarts()).toEqual([['me', true]]);
  });

  it('does nothing when nobody is signed in', () => {
    user.set(null);
    show('visible');
    window.dispatchEvent(new Event('sf-resume'));
    expect(follow).not.toHaveBeenCalled();
  });

  it('does not restart twice within five seconds (the tab and the Android event together are one restart)', () => {
    show('visible');
    window.dispatchEvent(new Event('sf-resume'));
    show('visible');
    expect(restarts().length).toBe(1);
  });

  it('restarts again after five seconds', () => {
    jasmine.clock().install();
    try {
      jasmine.clock().mockDate(new Date(2030, 0, 1, 12, 0, 0));
      show('visible');
      jasmine.clock().tick(4_000);
      show('visible');
      expect(restarts().length).toBe(1);
      jasmine.clock().tick(1_500);
      show('visible');
      expect(restarts().length).toBe(2);
    } finally {
      jasmine.clock().uninstall();
    }
  });
});
