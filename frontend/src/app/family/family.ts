import { ActiveCircleService } from '../core/active-circle.service';
import { NgTemplateOutlet } from '@angular/common';
import { Component, inject } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { WelcomeService } from '../core/welcome.service';

/**
 * Three welcome pages for Seven Family (the same app for close family and safe family matters), public: /family1 (your seven closest), /family2 (a safe place
 * for your family) and /family3 (close, even when far apart). Only the page is new: the app inside is the same one.
 */
@Component({
  selector: 'app-family',
  imports: [NgTemplateOutlet, RouterLink],
  templateUrl: './family.html',
})
export class Family {
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
    if (this.active.bindIfFree('family', '/login')) return;
    void this.router.navigateByUrl('/login');
  }
}
