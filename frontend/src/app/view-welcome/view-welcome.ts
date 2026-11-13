import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { Component, computed, HostListener, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { ActiveCircleService, CIRCLE_CHOICES } from '../core/active-circle.service';
import { tr } from '../core/i18n';

const PHONE_WIDTH = 390; // the width the pages are laid out for

/**
 * A test page (public, /viewwelcome): every welcome page next to each other in a phone-sized frame, with a link to open it alone.
 * Linked from the footer of the welcome page, so the pages can be compared on one screen.
 */
@Component({
  selector: 'app-view-welcome',
  imports: [RouterLink, TranslocoDirective],
  templateUrl: './view-welcome.html',
  providers: [provideTranslocoScope('viewWelcome')],
})
export class ViewWelcome {
  private readonly sanitizer = inject(DomSanitizer);
  protected readonly active = inject(ActiveCircleService);
  private readonly router = inject(Router);

  /** change the circle and stay on this page (the page is made again in the new circle) */
  protected choose(id: string): void {
    this.active.choose(id, this.router.url);
  }
  protected readonly circles = CIRCLE_CHOICES;
  protected readonly pages: { circle: string; path: string; title: string; note: string; src: SafeResourceUrl }[] = [
    { circle: 'default', path: '/welcome', title: tr('viewWelcome.welcome', 'Welcome'), note: tr('viewWelcome.theNormalFirstPage', 'The normal first page') },
    { circle: 'default', path: '/friends1', title: 'Friends 1', note: tr('viewWelcome.sevenPeopleAroundYou', 'Seven people around you') },
    { circle: 'default', path: '/friends2', title: 'Friends 2', note: tr('viewWelcome.quietUntilItMatters', 'Quiet, until it matters') },
    { circle: 'default', path: '/friends3', title: 'Friends 3', note: tr('viewWelcome.aPrivateRoomPer', 'A private room per friend') },
    { circle: 'buddies', path: '/buddy1', title: 'Buddies 1', note: tr('viewWelcome.closeBuddiesOnlySeats', 'Close buddies only, seats in a row') },
    { circle: 'buddies', path: '/buddy2', title: 'Buddies 2', note: tr('viewWelcome.yourPeopleStackAnd', 'Your people, stack and chat') },
    { circle: 'buddies', path: '/buddy3', title: 'Buddies 3', note: tr('viewWelcome.yourInnerCircle', 'Your inner circle') },
    { circle: 'work', path: '/work1', title: 'Work 1', note: tr('viewWelcome.sevenKeyBusinessContacts', 'Seven key business contacts') },
    { circle: 'work', path: '/work2', title: 'Work 2', note: tr('viewWelcome.stayCloseToThe', 'Stay close to the people your work needs') },
    { circle: 'work', path: '/work3', title: 'Work 3', note: tr('viewWelcome.aPrivateSpacePer', 'A private space per business relation') },
    { circle: 'family', path: '/family1', title: 'Family 1', note: tr('viewWelcome.yourSevenClosest', 'Your seven closest') },
    { circle: 'family', path: '/family2', title: 'Family 2', note: tr('viewWelcome.aSafePlaceFor', 'A safe place for your family') },
    { circle: 'family', path: '/family3', title: 'Family 3', note: tr('viewWelcome.closeEvenWhenFar', 'Close, even when far apart') },
  ].map((p) => ({ ...p, src: this.sanitizer.bypassSecurityTrustResourceUrl(p.path) }));

  /** by default only what belongs to the circle this app is in (its welcome pages and its Home); "Show all circles" shows everything, to compare */
  protected readonly showAll = signal(false);
  protected readonly circleLabel = computed(() => CIRCLE_CHOICES.find((c) => c.id === this.active.id)?.label ?? '');
  protected readonly visiblePages = computed(() => this.pages.filter((p) => this.showAll() || p.circle === this.active.id));

  /** how to measure every frame again (the window got another size) */
  private readonly measures = new Set<() => void>();

  @HostListener('window:resize')
  protected resized(): void {
    this.measures.forEach((m) => m());
  }

  /**
   * Each page is shown in full, as on a phone 390 px wide, with no scrolling inside the frame: the frame takes the height of what is in it.
   * When the screen is narrower than that, the whole frame is made smaller to fit (scaled), so nothing is cut off at the side.
   */
  protected fit(event: Event): void {
    const frame = event.target as HTMLIFrameElement;
    const box = frame.parentElement as HTMLElement;
    const measure = () => {
      const doc = frame.contentDocument;
      if (!doc) return;
      const card = doc.querySelector<HTMLElement>('.sf-fr-card'); // the welcome pages: the card plus the space around it (not the animated parts)
      const height = card ? card.offsetHeight + 56 : doc.documentElement.scrollHeight;
      const scale = Math.min(1, box.clientWidth / PHONE_WIDTH);
      frame.style.height = `${height}px`;
      frame.style.transform = scale < 1 ? `scale(${scale})` : '';
      box.style.height = `${height * scale}px`;
    };
    this.measures.add(measure);
    measure();
    setTimeout(measure, 500);
    setTimeout(measure, 1500);
    setTimeout(measure, 3500); // a Home page fills in after it has loaded its friends
  }
}
