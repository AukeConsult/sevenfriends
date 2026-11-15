import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { TranslocoLoader, provideTransloco, TRANSLOCO_MISSING_HANDLER } from '@jsverse/transloco';
import { of } from 'rxjs';
import { ActiveCircleService } from '../core/active-circle.service';
import { ApiError } from '../core/api.service';
import { FriendsService } from '../core/friends.service';
import { InviteLinkService } from '../core/invite-link.service';
import { EmptyMissingHandler } from '../core/transloco-missing.handler';
import { InviteFriend } from './invite-friend';

class NoTexts implements TranslocoLoader {
  getTranslation = () => of({});
}

/**
 * The invitation page (Add a friend opens it at once when nobody on the app has what was typed): the person decides to send the link, and sending it is what saves the
 * invitation for an email. Nothing is saved before, nor when the share is cancelled; a phone number saves nothing.
 */
describe('InviteFriend: the invitation page', () => {
  const EMAIL = 'kari@example.com';
  const PHONE = '+4791234567';

  const build = (state: unknown, opts: { share?: boolean; copy?: boolean; add?: (body: unknown) => Promise<unknown> } = {}) => {
    const added: Record<string, unknown>[] = [];
    const result = { share: opts.share ?? true, copy: opts.copy ?? true };
    const asked = { share: 0, copy: 0 };
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideTransloco({ config: { availableLangs: ['en'], defaultLang: 'en', prodMode: true }, loader: NoTexts }),
        { provide: TRANSLOCO_MISSING_HANDLER, useClass: EmptyMissingHandler },
        { provide: ActiveCircleService, useValue: { words: { one: 'friend', many: 'friends', app: 'Seven Friends' } } },
        { provide: InviteLinkService, useValue: { load: async () => undefined, canShare: false, note: signal(null), share: async () => { asked.share++; return result.share; }, copy: async () => { asked.copy++; return result.copy; } } },
        { provide: FriendsService, useValue: { add: async (body: Record<string, unknown>) => { added.push(body); return opts.add ? opts.add(body) : { id: 'f1' }; } } },
      ],
    });
    const router = TestBed.inject(Router);
    const navigated: unknown[] = [];
    spyOn(router, 'navigate').and.callFake(async (commands: unknown[], extras?: unknown) => { navigated.push([commands, extras]); return true; });
    spyOn(router, 'navigateByUrl').and.callFake(async (url: unknown) => { navigated.push(['url', url]); return true; });
    spyOn(router, 'getCurrentNavigation').and.returnValue({ extras: { state } } as never);
    const fixture = TestBed.createComponent(InviteFriend);
    fixture.detectChanges();
    return { fixture, added, navigated, result, asked, page: fixture.nativeElement as HTMLElement };
  };
  const text = (page: HTMLElement) => (page.textContent ?? '').replace(/\s+/g, ' ').trim();
  const button = (page: HTMLElement, label: string) => Array.from(page.querySelectorAll('button')).find((b) => (b.textContent ?? '').trim() === label) as HTMLButtonElement | undefined;
  const press = async (fixture: ReturnType<typeof build>['fixture'], label: string) => {
    button(fixture.nativeElement, label)!.click();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  it('an email: says it is not on Seven Friends, that sending the link saves the invitation, and that nothing is saved before', () => {
    const { page, added } = build({ to: EMAIL, back: '/' });
    expect(text(page)).toContain(EMAIL);
    expect(text(page)).toContain('is not on Seven Friends yet.');
    expect(text(page)).toContain('When you send it, we save your invitation too.');
    expect(text(page)).toContain('Nothing is saved until the link is sent.');
    expect(button(page, 'Share invite link')).toBeDefined();
    expect(button(page, 'Copy link')).toBeDefined();
    expect(added).toEqual([]);
  });

  it('the link is shared: the invitation is saved for that email, and the page says it is ready', async () => {
    const { fixture, added, page } = build({ to: EMAIL, back: '/' });
    await press(fixture, 'Share invite link');
    expect(added).toEqual([{ name: '', email: EMAIL, phone: null, message: null }]);
    expect(text(page)).toContain('Invitation ready');
    expect(text(page)).toContain('Your invitation is saved for ' + EMAIL + '. The next time they sign up or log on to Seven Friends with this email, your friend request is waiting for them.');
    expect(text(page)).toContain('Invited, waiting for sign-up');
    expect(button(page, 'Share the link again')).toBeUndefined(); // nothing more to send: it is stored for the next time they log on
    expect(button(page, 'Share invite link')).toBeUndefined();
    expect(button(page, 'Copy link')).toBeUndefined();
    expect(button(page, 'Done')).toBeDefined();
  });

  it('the link is copied: the invitation is saved too', async () => {
    const { fixture, added, page } = build({ to: EMAIL, back: '/' });
    await press(fixture, 'Copy link');
    expect(added.length).toBe(1);
    expect(text(page)).toContain('Invitation ready');
  });

  it('Share and Copy are always on: sharing needs no key and no approval', () => {
    const { page } = build({ to: EMAIL, back: '/' });
    expect(button(page, 'Share invite link')!.disabled).toBe(false);
    expect(button(page, 'Copy link')!.disabled).toBe(false);
    expect(text(page)).not.toContain('not approved');
    expect(text(page)).not.toContain('Your lock is still being set up');
  });

  it('a device whose key is not approved yet can still send the invitation: nothing here asks for approval', async () => {
    const { fixture, added, page } = build({ to: EMAIL, back: '/' });
    await press(fixture, 'Share invite link');
    expect(added.length).toBe(1);
    expect(text(page)).toContain('Invitation ready');
  });

  it('Cancel leaves without saving anything, back to where Add a friend was opened from', async () => {
    const { fixture, added, navigated } = build({ to: EMAIL, back: '/setup', params: { step: 'friend' } });
    await press(fixture, 'Cancel');
    expect(added).toEqual([]);
    expect(navigated).toEqual([[['/setup'], { queryParams: { step: 'friend' } }]]);
  });

  it('there is no Cancel once the invitation is saved (Done is there instead)', async () => {
    const { fixture, page } = build({ to: EMAIL, back: '/' });
    await press(fixture, 'Share invite link');
    expect(button(page, 'Cancel')).toBeUndefined();
    expect(button(page, 'Done')).toBeDefined();
  });

  it('the share is cancelled (or the copy fails): NOTHING is saved and the page stays as it was', async () => {
    const shareCancelled = build({ to: EMAIL, back: '/' }, { share: false });
    await press(shareCancelled.fixture, 'Share invite link');
    expect(shareCancelled.added).toEqual([]);
    expect(text(shareCancelled.page)).not.toContain('Invitation ready');
    const copyFailed = build({ to: EMAIL, back: '/' }, { copy: false });
    await press(copyFailed.fixture, 'Copy link');
    expect(copyFailed.added).toEqual([]);
  });

  it('when saving fails the error is shown, nothing is shown as ready, and the next send tries again', async () => {
    let fail = true;
    const { fixture, added, page } = build({ to: EMAIL, back: '/' }, { add: async () => { if (fail) throw new ApiError('This circle is full (max 7 friends)', 409); return { id: 'f1' }; } });
    await press(fixture, 'Share invite link');
    expect(text(page)).toContain('This circle is full');
    expect(text(page)).not.toContain('Invitation ready');
    fail = false;
    await press(fixture, 'Share invite link');
    expect(added.length).toBe(2);
    expect(text(page)).toContain('Invitation ready');
  });

  it('a phone number: the same page, but an invitation needs an email, so sending the link saves nothing', async () => {
    const { fixture, added, page } = build({ to: PHONE, back: '/' });
    expect(text(page)).toContain('An invitation needs an email, so nothing is saved for a phone number.');
    expect(text(page)).not.toContain('Nothing is saved until the link is sent.');
    await press(fixture, 'Share invite link');
    expect(added).toEqual([]);
    expect(text(page)).not.toContain('Invitation ready');
  });

  it('Done goes back to where Add a friend was opened from (the home page, or the setup)', async () => {
    const home = build({ to: EMAIL, back: '/' });
    await press(home.fixture, 'Share invite link');
    await press(home.fixture, 'Done');
    expect(home.navigated).toEqual([[['/'], { queryParams: null }]]);
    const setup = build({ to: EMAIL, back: '/setup', params: { step: 'friend' } });
    await press(setup.fixture, 'Share invite link');
    await press(setup.fixture, 'Done');
    expect(setup.navigated).toEqual([[['/setup'], { queryParams: { step: 'friend' } }]]);
  });

  it('opened by hand or reloaded (nothing handed over): nothing is shown, the person is taken back to Add a friend', () => {
    const { page, navigated } = build(null);
    expect(text(page)).not.toContain('Send them the link');
    expect(navigated).toEqual([['url', '/friends/add']]);
  });
});
