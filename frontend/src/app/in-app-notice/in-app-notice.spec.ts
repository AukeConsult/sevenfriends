import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslocoLoader, provideTransloco, TRANSLOCO_MISSING_HANDLER } from '@jsverse/transloco';
import { of } from 'rxjs';
import { FriendLinkService } from '../core/friend-link.service';
import { BrowserRuleService } from '../core/browser-rule.service';
import { REQUIRED_BROWSER, RequiredBrowser } from '../core/in-app-browser';
import { EmptyMissingHandler } from '../core/transloco-missing.handler';
import { InAppNotice } from './in-app-notice';

class NoTexts implements TranslocoLoader {
  getTranslation = () => of({});
}

const LINK = 'https://sevenfriends.io/welcome/friends?invite=abcde12345';

/** The page for the wrong browser: short, says it is an invitation, and the only thing to do is copy the link, open the right browser and paste it there. */
describe('InAppNotice: the page for the wrong browser', () => {
  const build = (need: RequiredBrowser | null, invited = true) => {
    const pending = invited ? { code: 'abcde12345', email: null, phone: null, circle: 'friends' } : null;
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideTransloco({ config: { availableLangs: ['en'], defaultLang: 'en', prodMode: true }, loader: NoTexts }),
        { provide: TRANSLOCO_MISSING_HANDLER, useClass: EmptyMissingHandler },
        { provide: FriendLinkService, useValue: { pending: signal(pending), linkText: () => LINK } },
        { provide: REQUIRED_BROWSER, useValue: need },
      ],
    });
    const fixture = TestBed.createComponent(InAppNotice);
    fixture.detectChanges();
    return { fixture, page: fixture.nativeElement as HTMLElement };
  };
  const text = (page: HTMLElement) => (page.textContent ?? '').replace(/\s+/g, ' ').trim();
  /** each step as the person reads it: its number (or tick), a space, its words */
  const steps = (page: HTMLElement) => Array.from(page.querySelectorAll('.sf-step')).map((li) => Array.from(li.querySelectorAll('span')).map((part) => (part.textContent ?? '').trim()).join(' '));
  const copyButton = (page: HTMLElement) => page.querySelector('button') as HTMLButtonElement;

  it('says it is an invitation to Seven Friends', () => {
    expect(text(build('safari').page)).toContain("You're invited to Seven Friends");
  });

  it('without an invitation it welcomes the person instead', () => {
    const { page } = build('safari', false);
    expect(text(page)).toContain('Welcome to Seven Friends');
    expect(text(page)).not.toContain('invited');
  });

  it('an iPhone in the browser of another app: the menu first (Open in Safari), copy and paste as the fallback', () => {
    const { page } = build('safari');
    expect(steps(page)).toEqual(['1 Tap ⋯ (or the compass icon), then Open in Safari']); // the menu of Messenger's browser: one tap
    expect(text(page)).toContain("Can't find it? Copy the link, open Safari and paste it there."); // and the way that always works
    expect(copyButton(page).textContent?.trim()).toBe('Copy link');
  });

  it('Android: the same with Chrome', () => {
    expect(steps(build('chrome').page)).toEqual(['1 Copy the link', '2 Open Chrome', '3 Paste the link there']);
  });

  it('Windows: the same with the browser', () => {
    expect(steps(build('browser').page)).toEqual(['1 Copy the link', '2 Open your browser', '3 Paste the link there']);
  });

  it('is SHORT: a name, a headline, three steps, one button and one line (Android, Windows); the iPhone pages add the apology and what comes next, and stay short too', () => {
    for (const need of ['chrome', 'browser'] as RequiredBrowser[]) {
      const { page } = build(need);
      expect(page.querySelectorAll('button').length).withContext(need).toBe(1);
      expect(page.querySelectorAll('a, input').length).withContext(need).toBe(0); // nothing to follow, nothing to fill in
      expect(text(page).length).withContext(need).toBeLessThan(200);
    }
    for (const need of ['safari', 'home-screen'] as RequiredBrowser[]) {
      const { page } = build(need);
      expect(page.querySelectorAll('button').length).withContext(need).toBe(need === 'home-screen' ? 2 : 1); // (home screen: Copy link, and Continue in Safari instead)
      expect(page.querySelectorAll('a, input').length).withContext(need).toBe(0);
      expect(text(page).length).withContext(need).toBeLessThan(need === 'home-screen' ? 900 : 560);
    }
  });

  it('nothing to sign in with and nowhere else to go: no links, no form, no password, no Google', () => {
    const { page } = build('chrome');
    expect(page.querySelectorAll('a, form, input').length).toBe(0);
    expect(text(page)).not.toMatch(/Google|password|sign in|Create account/i);
  });

  it('an iPhone in a Safari TAB with an invitation: copy the invitation, add the app to the home screen, open it and paste the invitation there', () => {
    const { page } = build('home-screen');
    expect(steps(page)).toEqual([
      '1 Copy the invitation',
      '2 Tap Share, then Add to Home Screen',
      '3 Open Seven Friends from its icon, tap “I have an invitation”, paste the invitation and create your account',
    ]);
    expect(copyButton(page).textContent?.trim()).toBe('Copy link');
    expect(text(page)).toContain('Safari and the app on your home screen do not share logins, so the account is made in the app.');
    expect(text(page)).toContain("You're invited to Seven Friends");
  });

  it('an iPhone in a Safari tab with no invitation: two steps and no copy button (nothing to copy)', () => {
    const { page } = build('home-screen', false);
    expect(steps(page)).toEqual(['1 Tap Share, then Add to Home Screen', '2 Open Seven Friends from its icon and create your account there']);
    expect(Array.from(page.querySelectorAll('button')).map((b) => (b.textContent ?? '').trim())).toEqual(['Continue in Safari instead']); // nothing to copy: only the other way
    expect(text(page)).toContain('Welcome to Seven Friends');
  });

  it('on an iPhone (the browser inside Messenger, or a Safari tab) the page says sorry and why the app must be on the home screen; elsewhere it does not', () => {
    for (const need of ['safari', 'home-screen'] as RequiredBrowser[]) {
      expect(text(build(need).page)).withContext(need).toContain('Sorry for the extra steps! On iPhone, Seven Friends works best on your home screen, so your account and lock key stay safe in one place.');
    }
    for (const need of ['chrome', 'browser'] as RequiredBrowser[]) {
      expect(text(build(need).page)).withContext(need).not.toContain('Sorry for the extra steps');
    }
  });

  it('from the browser inside Messenger on an iPhone the page also says what comes after Safari: the home screen, where the account is made', () => {
    expect(text(build('safari').page)).toContain('After that, Safari shows you how to add Seven Friends to your home screen, where you create your account.');
    expect(text(build('chrome').page)).not.toContain('add Seven Friends to your home screen');
  });

  it('an iPhone Safari tab offers TWO ways: the install steps marked Recommended, and "Continue in Safari instead" with the risk said plainly', () => {
    const { page } = build('home-screen');
    expect(text(page)).toContain('Recommended');
    expect(text(page)).toContain('In Safari, your account and lock key can be wiped if you do not open it for a week.');
    expect(Array.from(page.querySelectorAll('button')).map((b) => (b.textContent ?? '').trim())).toEqual(['Copy link', 'Continue in Safari instead']);
  });

  it('"Continue in Safari instead" makes the choice (the page then gives way to the sign-in page); no other page has it', () => {
    const { page } = build('home-screen');
    const rule = TestBed.inject(BrowserRuleService);
    const chose = spyOn(rule, 'continueInSafari');
    (Array.from(page.querySelectorAll('button')).find((b) => (b.textContent ?? '').trim() === 'Continue in Safari instead') as HTMLButtonElement).click();
    expect(chose).toHaveBeenCalledTimes(1);
    for (const other of ['safari', 'chrome', 'browser'] as RequiredBrowser[]) {
      expect(text(build(other).page)).withContext(other).not.toContain('Continue in Safari instead');
    }
  });

  it('there is nothing to sign in with on the install page either: no links, no form', () => {
    const { page } = build('home-screen');
    expect(page.querySelectorAll('a, form, input').length).toBe(0);
    expect(text(page)).not.toMatch(/Google|password|Create account/i);
  });

  it('Copy link puts the invitation link on the clipboard and says so, and the next steps stand out', async () => {
    const written: string[] = [];
    spyOn(navigator.clipboard, 'writeText').and.callFake(async (value: string) => { written.push(value); });
    const { fixture, page } = build('chrome');
    expect(copyButton(page).textContent?.trim()).toBe('Copy link');
    copyButton(page).click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(written).toEqual([LINK]);
    expect(copyButton(page).textContent?.trim()).toBe('Link copied');
    expect(steps(page)[0]).toContain('✓');
    expect(page.querySelectorAll('.sf-step-next').length).toBe(2); // "Open Safari" and "Paste the link there"
  });

  it('when the browser does not allow the copy, the link is shown to copy by hand', async () => {
    spyOn(navigator.clipboard, 'writeText').and.rejectWith(new Error('not allowed'));
    const { fixture, page } = build('chrome');
    copyButton(page).click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect((page.querySelector('input') as HTMLInputElement).value).toBe(LINK);
    expect(copyButton(page).textContent?.trim()).toBe('Copy link');
  });
});
