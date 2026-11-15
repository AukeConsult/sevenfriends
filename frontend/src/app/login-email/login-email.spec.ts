import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoLoader, provideTransloco, TRANSLOCO_MISSING_HANDLER } from '@jsverse/transloco';
import { of } from 'rxjs';
import { ActiveCircleService } from '../core/active-circle.service';
import { AuthService } from '../core/auth.service';
import { FriendLinkService } from '../core/friend-link.service';
import { EmptyMissingHandler } from '../core/transloco-missing.handler';
import { LoginEmail } from './login-email';

class NoTexts implements TranslocoLoader {
  getTranslation = () => of({});
}

/** The email sign-in link carries a waiting invitation, so whichever browser opens it still has the invitation. */
describe('LoginEmail: the invitation goes inside the emailed link', () => {
  const build = (query: string) => {
    const sent: { email: string; query: string }[] = [];
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideTransloco({ config: { availableLangs: ['en'], defaultLang: 'en', prodMode: true }, loader: NoTexts }),
        { provide: TRANSLOCO_MISSING_HANDLER, useClass: EmptyMissingHandler },
        { provide: AuthService, useValue: { user: signal(null), sendSignInLink: async (email: string, q?: string) => { sent.push({ email, query: q ?? '' }); } } },
        { provide: ActiveCircleService, useValue: { words: { app: 'Seven Friends', one: 'friend', many: 'friends' } } },
        { provide: FriendLinkService, useValue: { query: () => query } },
      ],
    });
    const fixture = TestBed.createComponent(LoginEmail);
    fixture.detectChanges();
    return { fixture, sent, page: fixture.nativeElement as HTMLElement };
  };
  const send = async (fixture: ReturnType<typeof build>['fixture'], email: string) => {
    const input = fixture.nativeElement.querySelector('input[type="email"]') as HTMLInputElement;
    input.value = email;
    input.dispatchEvent(new Event('input'));
    fixture.nativeElement.querySelector('form').dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    fixture.detectChanges();
  };

  it('with an invitation waiting, the link is sent with it', async () => {
    const { fixture, sent, page } = build('invite=abcde12345&circle=friends');
    await send(fixture, 'kari@example.com');
    expect(sent).toEqual([{ email: 'kari@example.com', query: 'invite=abcde12345&circle=friends' }]);
    expect(page.textContent).toContain('kari@example.com'); // "Check your email"
  });

  it('without an invitation, the link is a plain sign-in link', async () => {
    const { fixture, sent } = build('');
    await send(fixture, 'kari@example.com');
    expect(sent).toEqual([{ email: 'kari@example.com', query: '' }]);
  });
});
