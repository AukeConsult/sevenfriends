import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { TranslocoLoader, provideTransloco, TRANSLOCO_MISSING_HANDLER } from '@jsverse/transloco';
import { of } from 'rxjs';
import { ActiveCircleService } from '../core/active-circle.service';
import { AuthService } from '../core/auth.service';
import { FriendLinkService } from '../core/friend-link.service';
import { EmptyMissingHandler } from '../core/transloco-missing.handler';
import { WelcomeService } from '../core/welcome.service';
import { Welcome } from './welcome';

class NoTexts implements TranslocoLoader {
  getTranslation = () => of({});
}

/** The chapters of the welcome page ("How does it work?"), including the one that explains the four circles. */
describe('Welcome page: the chapters', () => {
  const build = () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideTransloco({ config: { availableLangs: ['en'], defaultLang: 'en', prodMode: true }, loader: NoTexts }),
        { provide: TRANSLOCO_MISSING_HANDLER, useClass: EmptyMissingHandler },
        { provide: ActivatedRoute, useValue: { snapshot: { data: { explain: true } } } }, // /welcome/explain: only the explanation (the chapters)
        { provide: AuthService, useValue: { user: signal(null) } },
        { provide: ActiveCircleService, useValue: { choose: () => undefined, id: 'default', words: { app: 'Seven Friends', one: 'friend', many: 'friends' } } },
        { provide: FriendLinkService, useValue: { pending: signal(null), enterCircleOf: () => false } },
        { provide: WelcomeService, useValue: { continueInBrowser: () => undefined } },
      ],
    });
    const fixture = TestBed.createComponent(Welcome);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  };
  const text = (page: HTMLElement) => (page.textContent ?? '').replace(/\s+/g, ' ');

  it('has a chapter that explains there are four circles: Friends, Work, Buddies and Family', () => {
    const page = build();
    const chapter = Array.from(page.querySelectorAll('section')).find((s) => (s.textContent ?? '').includes('Four circles'))!;
    expect(chapter).toBeDefined();
    const words = (chapter.textContent ?? '').replace(/\s+/g, ' ');
    expect(words).toContain('There are four circles: Friends, Work, Buddies and Family.');
    expect(words).toContain('Each circle has its own seven seats, its own chats and its own safebox');
    expect(words).toContain('The same person can be in more than one circle');
  });

  it('lists the four circles, each with what it is for', () => {
    const items = Array.from(build().querySelectorAll('section li')).map((li) => (li.textContent ?? '').trim());
    expect(items).toContain('Friends: the people closest to you.');
    expect(items).toContain('Work: the people you work with.');
    expect(items).toContain('Buddies: your mates and the people you share a hobby with.');
    expect(items).toContain('Family: the people at home and your relatives.');
  });

  it('sits right after "Seven seats" and before "Share anything with your friends"', () => {
    const titles = Array.from(build().querySelectorAll('section h3')).map((h) => (h.textContent ?? '').replace(/\s+/g, ' ').trim());
    const seats = titles.findIndex((t) => t.includes('Seven seats'));
    const circles = titles.findIndex((t) => t.includes('Four circles'));
    const share = titles.findIndex((t) => t.includes('Share anything with your friends'));
    expect(seats).toBeGreaterThanOrEqual(0);
    expect(circles).toBe(seats + 1);
    expect(share).toBe(circles + 1);
  });

  it('the other chapters are still all there', () => {
    const page = text(build());
    for (const title of ['What is Seven Friends?', 'Seven seats', 'A shared safebox for each friend and group', 'Fully locked and secured', 'What is locked?', 'Calm, but you can still reach people', 'Is it free?', 'How to start']) {
      expect(page).withContext(title).toContain(title);
    }
  });

  it('no other chapter has a list of circles', () => {
    const lists = Array.from(build().querySelectorAll('section ul'));
    expect(lists.length).toBe(1);
  });
});
