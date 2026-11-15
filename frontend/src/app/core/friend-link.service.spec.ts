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
