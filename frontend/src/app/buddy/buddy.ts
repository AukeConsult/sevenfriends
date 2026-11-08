import { ActiveCircleService } from '../core/active-circle.service';
import { NgTemplateOutlet } from '@angular/common';
import { Component, inject } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { WelcomeService } from '../core/welcome.service';

/**
 * Three short welcome pages for Seven Buddies (young people, 13 to 18), public: /buddy1 (close friends only, the seats in a row), /buddy2 (your people, a stack of friends
 * and a little chat) and /buddy3 (your inner circle, you in the middle). Few words, one picture, one button; the button goes on to sign-in (or home when signed in).
 */
@Component({
  selector: 'app-buddy',
  imports: [NgTemplateOutlet, RouterLink],
  templateUrl: './buddy.html',
})
export class Buddy {
  private readonly active = inject(ActiveCircleService);
  private readonly router = inject(Router);
  private readonly welcome = inject(WelcomeService);
  protected readonly auth = inject(AuthService);
  protected readonly variant: 1 | 2 | 3 = (inject(ActivatedRoute).snapshot.data['variant'] ?? 1) as 1 | 2 | 3;

  protected start(): void {
    if (this.auth.user()) {
      void this.router.navigateByUrl('/');
      return;
    }
    this.welcome.continueInBrowser();
    // an app that has no circle yet is bound to this page's circle (the page decides) and the sign-in opens in it
    if (this.active.bindIfFree('buddies', '/login')) return;
    void this.router.navigateByUrl('/login');
  }
}
