import { NgTemplateOutlet } from '@angular/common';
import { Component, inject } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { WelcomeService } from '../core/welcome.service';

/**
 * Three short welcome pages for Seven Buddies (young people, 13 to 18), public: /young1 (close friends only, the seats in a row), /young2 (your people, a stack of friends
 * and a little chat) and /young3 (your inner circle, you in the middle). Few words, one picture, one button; the button goes on to sign-in (or home when signed in).
 */
@Component({
  selector: 'app-young',
  imports: [NgTemplateOutlet, RouterLink],
  templateUrl: './young.html',
})
export class Young {
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
    void this.router.navigateByUrl('/login');
  }
}
