import { ActiveCircleService } from '../core/active-circle.service';
import { NgTemplateOutlet } from '@angular/common';
import { Component, inject } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { WelcomeService } from '../core/welcome.service';

/**
 * Three welcome pages for Seven Work (the same app for business relations), public: /work1 (seven key contacts with roles), /work2 (stay close to the
 * people your work needs) and /work3 (one private space for each business relation). Only the page is new: the app inside is the same one.
 */
@Component({
  selector: 'app-work',
  imports: [NgTemplateOutlet, RouterLink],
  templateUrl: './work.html',
})
export class Work {
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
    if (this.active.bindIfFree('work', '/login')) return;
    void this.router.navigateByUrl('/login');
  }
}
