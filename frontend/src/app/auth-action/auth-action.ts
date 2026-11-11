import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { authMessage } from '../core/auth-errors';
import { AuthService } from '../core/auth.service';
import { tr } from '../core/i18n';
import { PageBar } from '../page-bar/page-bar';

/**
 * The page the link of the verification email opens (`/auth/action?mode=verifyEmail&oobCode=...`; the address of the link is set in the Firebase console, Authentication,
 * Templates, "Customize action URL"). It checks the code and says plainly whether the email is verified now, or why not.
 */
@Component({
  selector: 'app-auth-action',
  imports: [PageBar, RouterLink, TranslocoDirective],
  providers: [provideTranslocoScope('authAction')],
  templateUrl: './auth-action.html',
})
export class AuthAction {
  private readonly auth = inject(AuthService);
  private readonly query = inject(ActivatedRoute).snapshot.queryParamMap;

  /** 'working' while the code is checked, then 'done' (verified), 'failed' (the link is no good) or 'other' (a kind of link this page does not handle) */
  protected readonly state = signal<'working' | 'done' | 'failed' | 'other'>('working');
  protected readonly email = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly signedIn = this.auth.user;

  constructor() {
    const mode = this.query.get('mode');
    const code = this.query.get('oobCode');
    if (mode !== 'verifyEmail') {
      this.state.set('other');
      return;
    }
    if (!code) {
      this.fail(null);
      return;
    }
    this.auth.applyVerificationCode(code).then(
      (email) => {
        this.email.set(email);
        this.state.set('done');
      },
      (err) => this.fail(err),
    );
  }

  private fail(err: unknown): void {
    this.error.set(authMessage(err, tr('authAction.failed', 'This link could not be used. It may have been used already, or it has expired. Ask for a new one on your profile page.')));
    this.state.set('failed');
  }
}
