import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslocoLoader, provideTransloco, TRANSLOCO_MISSING_HANDLER } from '@jsverse/transloco';
import { of } from 'rxjs';
import { FriendLinkService } from '../core/friend-link.service';
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

  it('an iPhone: copy the link, open Safari, paste it there', () => {
    expect(steps(build('safari').page)).toEqual(['1 Copy the link', '2 Open Safari', '3 Paste the link there']);
  });

  it('Android: the same with Chrome', () => {
    expect(steps(build('chrome').page)).toEqual(['1 Copy the link', '2 Open Chrome', '3 Paste the link there']);
  });

  it('Windows: the same with the browser', () => {
    expect(steps(build('browser').page)).toEqual(['1 Copy the link', '2 Open your browser', '3 Paste the link there']);
  });

  it('is SHORT: a name, a headline, three steps, one button and one line', () => {
    const { page } = build('safari');
    expect(page.querySelectorAll('button').length).toBe(1);
    expect(page.querySelectorAll('a, input').length).toBe(0); // nothing to follow, nothing to fill in
    expect(text(page).length).toBeLessThan(200);
  });

  it('nothing to sign in with and nowhere else to go: no links, no form, no password, no Google', () => {
    const { page } = build('chrome');
    expect(page.querySelectorAll('a, form, input').length).toBe(0);
    expect(text(page)).not.toMatch(/Google|password|sign in|Create account/i);
  });

  it('Copy link puts the invitation link on the clipboard and says so, and the next steps stand out', async () => {
    const written: string[] = [];
    spyOn(navigator.clipboard, 'writeText').and.callFake(async (value: string) => { written.push(value); });
    const { fixture, page } = build('safari');
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
    const { fixture, page } = build('safari');
    copyButton(page).click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect((page.querySelector('input') as HTMLInputElement).value).toBe(LINK);
    expect(copyButton(page).textContent?.trim()).toBe('Copy link');
  });
});
