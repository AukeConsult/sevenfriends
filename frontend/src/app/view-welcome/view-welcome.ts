import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';

/**
 * A test page (public, /viewwelcome): every welcome page next to each other in a phone-sized frame, with a link to open it alone.
 * Linked from the footer of the welcome page, so the pages can be compared on one screen.
 */
@Component({
  selector: 'app-view-welcome',
  imports: [RouterLink],
  templateUrl: './view-welcome.html',
})
export class ViewWelcome {
  private readonly sanitizer = inject(DomSanitizer);
  protected readonly pages: { path: string; title: string; note: string; src: SafeResourceUrl }[] = [
    { path: '/welcome', title: 'Welcome', note: 'The normal first page' },
    { path: '/young1', title: 'Buddies 1', note: 'Close buddies only, seats in a row' },
    { path: '/young2', title: 'Buddies 2', note: 'Your people, stack and chat' },
    { path: '/young3', title: 'Buddies 3', note: 'Your inner circle' },
    { path: '/work1', title: 'Work 1', note: 'Seven key business contacts' },
    { path: '/work2', title: 'Work 2', note: 'Stay close to the people your work needs' },
    { path: '/work3', title: 'Work 3', note: 'A private space per business relation' },
    { path: '/family1', title: 'Family 1', note: 'Your seven closest' },
    { path: '/family2', title: 'Family 2', note: 'A safe place for your family' },
    { path: '/family3', title: 'Family 3', note: 'Close, even when far apart' },
  ].map((p) => ({ ...p, src: this.sanitizer.bypassSecurityTrustResourceUrl(p.path) }));

  /** each page is shown in full, at the width of a phone, with no scrolling inside the frame: the frame takes the height of what is in it */
  protected fit(event: Event): void {
    const frame = event.target as HTMLIFrameElement;
    const measure = () => {
      const doc = frame.contentDocument;
      if (!doc) return;
      const card = doc.querySelector<HTMLElement>('.sf-yg-card, .sf-wk-card'); // the young and work pages: the card plus the space around it (not the animated parts)
      frame.style.height = `${card ? card.offsetHeight + 56 : doc.documentElement.scrollHeight}px`;
    };
    measure();
    setTimeout(measure, 500);
    setTimeout(measure, 1500);
  }
}
