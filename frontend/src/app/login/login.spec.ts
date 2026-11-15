import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoLoader, provideTransloco, TRANSLOCO_MISSING_HANDLER } from '@jsverse/transloco';
import { of } from 'rxjs';
import { ActiveCircleService } from '../core/active-circle.service';
import { AuthService } from '../core/auth.service';
import { FriendLinkService } from '../core/friend-link.service';
import { REQUIRED_BROWSER, RequiredBrowser } from '../core/in-app-browser';
import { EmptyMissingHandler } from '../core/transloco-missing.handler';
import { Login } from './login';

class NoTexts implements TranslocoLoader {
  getTranslation = () => of({});
}

/** The sign-in page offers Google and the email link in BOTH modes: a person who comes with an invitation (and starts at "Create account") gets the same ways in as everybody. */
describe('Login page: the ways in', () => {
  const build = (invited: boolean, need: RequiredBrowser | null = null) => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideTransloco({ config: { availableLangs: ['en'], defaultLang: 'en', prodMode: true }, loader: NoTexts }),
        { provide: TRANSLOCO_MISSING_HANDLER, useClass: EmptyMissingHandler },
        { provide: AuthService, useValue: { user: signal(null), signedOutNotice: signal(null) } },
        { provide: ActiveCircleService, useValue: { words: { app: 'Seven Friends', slogan: '', one: 'friend' }, id: 'default', type: 'friends' } },
        { provide: REQUIRED_BROWSER, useValue: need },
        { provide: FriendLinkService, useValue: { pending: signal(invited ? { code: 'abcde12345', email: null, phone: null, circle: 'friends' } : null), inviter: async () => null } },
      ],
    });
    const fixture = TestBed.createComponent(Login);
    fixture.detectChanges();
    const page = fixture.nativeElement as HTMLElement;
    return { fixture, page };
  };
  const text = (page: HTMLElement) => page.textContent ?? '';
  const offersBoth = (page: HTMLElement) => text(page).includes('Continue with Google') && !!page.querySelector('a[href="/login/email"]');
  const toggle = (page: HTMLElement) => (Array.from(page.querySelectorAll('button.btn-link')).find((b) => /account|sign in/i.test(b.textContent ?? '') && !/forgot/i.test(b.textContent ?? '')) as HTMLButtonElement | undefined);

  it('a regular visit (sign in): Google and the email link are there', () => {
    const { page } = build(false);
    expect(text(page)).not.toContain('Create your account');
    expect(offersBoth(page)).toBe(true);
  });

  it('an invited visit starts at "Create your account", and Google and the email link are there too', () => {
    const { page } = build(true);
    expect(text(page)).toContain('Create your account');
    expect(offersBoth(page)).toBe(true);
  });

  it('they stay when the person switches between creating an account and signing in', () => {
    const { fixture, page } = build(true);
    toggle(page)!.click();
    fixture.detectChanges();
    expect(text(page)).not.toContain('Create your account');
    expect(offersBoth(page)).toBe(true);
    toggle(page)!.click();
    fixture.detectChanges();
    expect(text(page)).toContain('Create your account');
    expect(offersBoth(page)).toBe(true);
  });

  it('Google is pointed out when creating an account (a line above it), and is the first thing offered, before the password form', () => {
    const { page } = build(true);
    expect(text(page)).toContain('Have a Gmail or Google account?');
    const google = Array.from(page.querySelectorAll('button')).find((b) => (b.textContent ?? '').includes('Continue with Google'))!;
    const password = page.querySelector('input[type="password"]')!;
    expect(google.compareDocumentPosition(password) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy(); // the password form comes after the Google button
    expect(build(false).page.textContent).not.toContain('Have a Gmail or Google account?'); // a plain sign-in does not need the line
  });

  /** every way to get in, as the page shows it */
  const ways = (page: HTMLElement) => ({
    google: text(page).includes('Continue with Google'),
    emailLink: !!page.querySelector('a[href="/login/email"]'),
    email: !!page.querySelector('input[type="email"]'),
    password: !!page.querySelector('input[type="password"]'),
    submit: Array.from(page.querySelectorAll('button[type="submit"]')).map((b) => (b.textContent ?? '').trim()),
  });

  it('ANY way to create an account is offered on the create page: Google, the email link, and email with a password (with the name and the repeated password)', () => {
    for (const invited of [true, false]) {
      const { fixture, page } = build(invited);
      if (!invited) {
        toggle(page)!.click(); // a regular visitor who chooses "Create one"
        fixture.detectChanges();
      }
      expect(text(page)).toContain('Create your account');
      const found = ways(page);
      expect(found.google).withContext('Google, invited=' + invited).toBe(true);
      expect(found.emailLink).withContext('email link, invited=' + invited).toBe(true);
      expect(found.email).withContext('email field').toBe(true);
      expect(found.password).withContext('password field').toBe(true);
      expect(found.submit.some((s) => /create account/i.test(s))).withContext('Create account button').toBe(true);
      expect(page.querySelectorAll('input[type="password"]').length).withContext('password and repeat').toBe(2);
      expect(page.querySelector('input[name="name"]:not([hidden])')).withContext('name field').not.toBeNull();
    }
  });

  it('ANY way to sign in is offered on the sign-in page too: Google, the email link, email with a password', () => {
    const { page } = build(false);
    const found = ways(page);
    expect(found.google && found.emailLink && found.email && found.password).toBe(true);
    expect(found.submit.some((s) => /sign in/i.test(s))).toBe(true);
  });

  it('a person with an invitation can still paste one ("I have an invitation") next to all of it', () => {
    expect(text(build(false).page)).toContain('invitation');
  });

  it('in the WRONG browser (Safari / Chrome / a real browser is required) there is nothing to sign in with, and no way to create an account', () => {
    for (const need of ['safari', 'chrome', 'browser', 'home-screen'] as RequiredBrowser[]) {
      for (const invited of [true, false]) {
        const { page } = build(invited, need);
        const found = ways(page);
        expect(found.google).withContext(need + ' google').toBe(false);
        expect(found.emailLink).withContext(need + ' email link').toBe(false);
        expect(found.email).withContext(need + ' email').toBe(false);
        expect(found.password).withContext(need + ' password').toBe(false);
        expect(found.submit).withContext(need + ' submit').toEqual([]);
        expect(page.querySelector('input[name="name"]')).withContext(need + ' name').toBeNull();
      }
    }
  });

  it('an iPhone Safari tab where the person chose to continue in Safari: every way in is offered, as in any browser', () => {
    try {
      localStorage.setItem('sf-ui', JSON.stringify({ iosSafariOk: true }));
      const { page } = build(true, 'home-screen');
      const found = ways(page);
      expect(found.google && found.emailLink && found.email && found.password).toBe(true);
    } finally {
      localStorage.removeItem('sf-ui');
    }
  });

  it('the password form is still below them in both modes', () => {
    const invited = build(true).page;
    expect(invited.querySelector('input[type="password"]')).not.toBeNull();
    const regular = build(false).page;
    expect(regular.querySelector('input[type="password"]')).not.toBeNull();
  });
});
