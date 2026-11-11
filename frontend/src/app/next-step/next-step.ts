import { Component, inject, input } from '@angular/core';
import { Router } from '@angular/router';
import { ActiveCircleService } from '../core/active-circle.service';
import { AuthService } from '../core/auth.service';
import { FriendLinkService } from '../core/friend-link.service';
import { WelcomeService } from '../core/welcome.service';

/**
 * The end of every welcome page. It offers no install. Signed in: on to Home. Signed out: ONE button on to the web app (sign-in).
 * Who invited is shown under the headline by `app-inviter`.
 * An app that has no circle yet is bound to the circle of the page on the way (the page decides), so the install and sign-in pages open in it.
 */
@Component({
  selector: 'app-next-step',
  host: { style: 'display:block;text-align:center' },
  template: `
    @if (auth.user()) {
      <button type="button" [class]="ctaClass()" [style.background]="bg()" [style.color]="fg()" (click)="open('/')">{{ back() }}</button>
    } @else {
      <button type="button" [class]="ctaClass()" [style.background]="bg()" [style.color]="fg()" (click)="signIn()">{{ cta() }}</button>
    }
  `,
})
export class NextStep {
  protected readonly auth = inject(AuthService);
  private readonly active = inject(ActiveCircleService);
  private readonly friendLinks = inject(FriendLinkService);
  private readonly router = inject(Router);
  private readonly welcome = inject(WelcomeService);

  /** the id of the circle of this page */
  readonly circle = input.required<string>();
  /** the words of the button when the person is signed out (and in the installed app), and when signed in */
  readonly cta = input.required<string>();
  readonly back = input.required<string>();
  /** the look of the page's own button */
  readonly ctaClass = input.required<string>();
  readonly bg = input.required<string>();
  readonly fg = input.required<string>();

  /** opens a page; an app that has no circle yet is bound to this page's circle first (and starts again on that page) */
  protected open(path: string): void {
    if (!this.auth.user() && this.friendLinks.enterCircleOf(path)) return; // an invitation decides the circle
    if (this.active.bindIfFree(this.circle(), path)) return;
    void this.router.navigateByUrl(path);
  }

  protected signIn(): void {
    this.welcome.continueInBrowser();
    this.open('/login');
  }
}
