import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { TranslocoLoader, provideTransloco, TRANSLOCO_MISSING_HANDLER } from '@jsverse/transloco';
import { of } from 'rxjs';
import { ActiveCircleService } from '../core/active-circle.service';
import { ApiError } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { FriendsService } from '../core/friends.service';
import { InviteLinkService } from '../core/invite-link.service';
import { EmptyMissingHandler } from '../core/transloco-missing.handler';
import { AddFriend } from './add-friend';

class NoTexts implements TranslocoLoader {
  getTranslation = () => of({});
}

/**
 * Add a friend: somebody who is on the app is a valid invitation by itself (the request is sent at once and the page closes). When nobody on the app has the email or phone
 * number that was typed, the invitation page opens AT ONCE (nothing else is shown or asked here): there the person decides to send the link, which saves the invitation.
 */
describe('AddFriend: somebody who is not on the app', () => {
  const EMAIL = 'kari@example.com';
  const PHONE = '+4791234567';

  const build = (look: 'found' | 'none', add?: (body: unknown) => Promise<unknown>) => {
    const added: Record<string, unknown>[] = [];
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideTransloco({ config: { availableLangs: ['en'], defaultLang: 'en', prodMode: true }, loader: NoTexts }),
        { provide: TRANSLOCO_MISSING_HANDLER, useClass: EmptyMissingHandler },
        { provide: ActiveCircleService, useValue: { words: { one: 'friend', many: 'friends', app: 'Seven Friends' }, type: 'friends' } },
        { provide: AuthService, useValue: { user: signal({ email: 'me@example.com', phoneNumber: null }) } },
        { provide: InviteLinkService, useValue: { load: async () => undefined, link: signal('https://sevenfriends.io/welcome/friends?invite=abcde12345'), canShare: false, note: signal(null), share: async () => true, copy: async () => true } },
        {
          provide: FriendsService,
          useValue: {
            friends: signal([]),
            lookup: async () => look,
            add: async (body: Record<string, unknown>) => {
              added.push(body);
              return add ? add(body) : { id: 'f1' };
            },
          },
        },
      ],
    });
    const router = TestBed.inject(Router);
    const navigated: unknown[] = [];
    spyOn(router, 'navigate').and.callFake(async (commands: unknown[], extras?: unknown) => { navigated.push([commands, extras]); return true; });
    const fixture = TestBed.createComponent(AddFriend);
    fixture.detectChanges();
    return { fixture, added, navigated, page: fixture.nativeElement as HTMLElement };
  };
  const type = async (fixture: ReturnType<typeof build>['fixture'], value: string, wait = 900) => {
    const input = fixture.nativeElement.querySelector('input[type="text"]') as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, wait)); // the look-up is made a moment after the last key
    fixture.detectChanges();
  };
  const text = (page: HTMLElement) => (page.textContent ?? '').replace(/\s+/g, ' ').trim();
  const submit = (page: HTMLElement) => page.querySelector('button[type="submit"]') as HTMLButtonElement | null;
  const tapSubmit = async (fixture: ReturnType<typeof build>['fixture']) => {
    submit(fixture.nativeElement)!.click();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  it('an email nobody has: the invitation page opens at once, and nothing is saved or asked on this page', async () => {
    const { fixture, added, navigated, page } = build('none');
    await type(fixture, EMAIL);
    expect(navigated).toEqual([[['/friends/add/invite'], { state: { to: EMAIL, back: '/', params: null } }]]);
    expect(added).toEqual([]);
    expect(text(page)).not.toContain('Send invitation'); // there is no extra step here
    expect(text(page)).not.toContain('We can save an invitation');
  });

  it('a phone number nobody has: the same page opens (it saves nothing there, an invitation needs an email)', async () => {
    const { fixture, added, navigated } = build('none');
    await type(fixture, PHONE);
    expect(navigated).toEqual([[['/friends/add/invite'], { state: { to: PHONE, back: '/', params: null } }]]);
    expect(added).toEqual([]);
  });

  it('somebody who is on the app: nothing opens, the confirmation "Send them your invitation?" is asked, and "Send invitation" sends the request at once and the page closes (a valid invitation, nothing more to do)', async () => {
    const { fixture, added, navigated, page } = build('found');
    await type(fixture, EMAIL);
    expect(navigated).toEqual([]);
    expect(text(page)).toContain(EMAIL + ' is on Seven Friends. Send them your invitation?'); // the person is asked to confirm that they receive it
    expect(submit(page)!.textContent?.trim()).toBe('Send invitation');
    expect(added).toEqual([]); // nothing is sent before the tap
    await tapSubmit(fixture);
    expect(added).toEqual([{ name: '', email: EMAIL, phone: null, message: null, onlyIfOnApp: true }]);
    expect(navigated).toEqual([[['/'], { queryParams: null }]]); // the page closes
  });

  it('a tap before the look-up was done: if nobody has it, nothing is saved and the invitation page opens, as after the look-up', async () => {
    const { fixture, added, navigated } = build('none', async () => { throw new ApiError('Nobody with that email or phone number is on the app yet.', 422); });
    const input = fixture.nativeElement.querySelector('input[type="text"]') as HTMLInputElement;
    input.value = EMAIL;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await tapSubmit(fixture); // before the look-up
    expect(added.length).toBe(1);
    expect(added[0]['onlyIfOnApp']).toBe(true); // nothing is saved for somebody who is not on the app
    expect((navigated[0] as unknown[])[0]).toEqual(['/friends/add/invite']);
  });

  it('the general link frame is still there for anybody (before anything is typed)', () => {
    const { page } = build('none');
    expect(text(page)).toContain('Invite with a link');
    expect(text(page)).toContain('Who do you want to add?');
    expect(text(page)).not.toContain('Already on Seven Friends?'); // you always type an email or a phone number: the heading must not suggest they are on the app
  });
});
