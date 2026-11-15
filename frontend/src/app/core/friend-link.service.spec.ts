import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActiveCircleService } from './active-circle.service';
import { FriendLinkService } from './friend-link.service';
import { PendingFriend, UiPreferencesService } from './ui-preferences';

/** The waiting invitation travels inside the emailed sign-in link, so whichever browser opens that link still has it. */
describe('FriendLinkService.query: the invitation inside the email sign-in link', () => {
  const setup = () => {
    const stored = signal<PendingFriend | null>(null);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: UiPreferencesService, useValue: { value: () => stored, set: (_key: string, value: PendingFriend | null) => stored.set(value), get: () => stored() } },
        { provide: ActiveCircleService, useValue: { id: 'default', choose: () => undefined } },
      ],
    });
    return { service: TestBed.inject(FriendLinkService), stored };
  };
  /** what the other browser does: it opens the emailed link (an address with this query) and the app reads the invitation from it */
  const openedElsewhere = (query: string): PendingFriend | null => {
    const other = setup();
    other.service.use(`https://app.example.com/login/link?${query}&oobCode=abc&mode=signIn`);
    return other.stored();
  };

  it('no invitation: nothing is added to the link', () => {
    expect(setup().service.query()).toBe('');
  });

  it('an invitation with a code arrives intact in another browser, with its circle', () => {
    const { service } = setup();
    expect(service.use('https://app.example.com/welcome/buddy?invite=abcde12345')).toBe(true);
    const query = service.query();
    expect(query).toBe('invite=abcde12345&circle=buddies');
    expect(openedElsewhere(query)).toEqual({ code: 'abcde12345', email: null, phone: null, circle: 'buddies' });
  });

  it('an invitation to an email address or a phone number arrives intact too', () => {
    const mail = setup();
    mail.service.use('https://app.example.com/welcome/friends?from=kari%2Btest@example.com');
    expect(openedElsewhere(mail.service.query())).toEqual(mail.stored());
    const phone = setup();
    phone.service.use('https://app.example.com/welcome/friends?from=%2B4791234567');
    expect(phone.stored()?.phone).toBe('+4791234567');
    expect(openedElsewhere(phone.service.query())).toEqual(phone.stored());
  });

  it('after it is answered (cleared) nothing is carried any more', () => {
    const { service } = setup();
    service.use('https://app.example.com/welcome/friends?invite=abcde12345');
    expect(service.query()).not.toBe('');
    service.clear();
    expect(service.query()).toBe('');
  });
});

/** The link that is COPIED (the page for the wrong browser, the welcome page) carries everything the opened link had, the invitation code first of all. */
describe('FriendLinkService.linkText: the copied link is the whole invitation', () => {
  const HASH = 'abcdef0123456789abcdef0123456789';
  const setup = () => {
    const stored = signal<PendingFriend | null>(null);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: UiPreferencesService, useValue: { value: () => stored, set: (_key: string, value: PendingFriend | null) => stored.set(value), get: () => stored() } },
        { provide: ActiveCircleService, useValue: { id: 'default', choose: () => undefined } },
      ],
    });
    return { service: TestBed.inject(FriendLinkService), stored };
  };
  beforeEach(() => {
    try { localStorage.removeItem('sf-link-pins'); } catch { /* no storage */ }
  });
  afterAll(() => {
    try { localStorage.removeItem('sf-link-pins'); } catch { /* no storage */ }
  });

  it('the copied link has the invitation code, in the circle the link was for', () => {
    for (const [route, type] of [['friends', 'friends'], ['buddy', 'buddies'], ['work', 'work'], ['family', 'family']]) {
      const { service, stored } = setup();
      service.use('https://sevenfriends.io/welcome/' + route + '?invite=abcde12345');
      expect(stored()?.circle).withContext(route).toBe(type);
      expect(service.linkText(stored()!)).withContext(route).toContain('/welcome/' + route + '?invite=abcde12345');
    }
  });

  it('a link to an email address or a phone number is copied with it', () => {
    const { service, stored } = setup();
    service.use('https://sevenfriends.io/welcome/friends?from=kari%40example.com');
    expect(service.linkText(stored()!)).toContain('from=kari%40example.com');
  });

  it('the pin of the inviter (the part after the #) is copied too, so it is not lost on the way to the right browser', () => {
    const { service, stored } = setup();
    service.use('https://sevenfriends.io/welcome/friends?invite=abcde12345#u=inviter1&v=3&h=' + HASH);
    expect(stored()?.pinUid).toBe('inviter1');
    const copied = service.linkText(stored()!);
    expect(copied).toContain('?invite=abcde12345');
    expect(copied.endsWith('#u=inviter1&v=3&h=' + HASH)).toBe(true);
  });

  it('pasted in the right browser, the copied link gives the same invitation and the same pin again', () => {
    const first = setup();
    first.service.use('https://sevenfriends.io/welcome/buddy?invite=abcde12345#u=inviter1&v=3&h=' + HASH);
    const copied = first.service.linkText(first.stored()!);
    localStorage.removeItem('sf-link-pins'); // the other browser has nothing of it
    const other = setup();
    expect(other.service.use(copied)).toBe(true);
    expect(other.stored()).toEqual(first.stored());
    expect(other.service.linkText(other.stored()!)).toBe(copied);
  });

  it('a link with no pin is copied with no pin (and no stray # at the end)', () => {
    const { service, stored } = setup();
    service.use('https://sevenfriends.io/welcome/friends?invite=abcde12345');
    const copied = service.linkText(stored()!);
    expect(copied).toContain('?invite=abcde12345');
    expect(copied).not.toContain('#');
  });
});
