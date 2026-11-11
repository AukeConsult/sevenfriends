import { ActiveCircleService } from '../core/active-circle.service';
import { Clearable } from '../core/clearable';
import { Hero } from '../hero/hero';
import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { tr } from '../core/i18n';
import { authMessage, wasCancelled, wasRejected } from '../core/auth-errors';
import { AuthService } from '../core/auth.service';
import { FriendLinkService } from '../core/friend-link.service';
import { AuthMode } from '../models';
import { Inviter } from '../inviter/inviter';

@Component({
  selector: 'app-login',
  imports: [Inviter, RouterLink, Clearable, Hero, TranslocoDirective],
  providers: [provideTranslocoScope('login')],
  templateUrl: './login.html',
})
export class Login {
  protected readonly w = inject(ActiveCircleService).words;
  /** a friend link was opened: what it is about (shown above the sign-in buttons) */
  private readonly friendLinks = inject(FriendLinkService);
  protected readonly link = this.friendLinks.pending;
  /** "I have an invitation": the box to paste a link or code (for an app installed after the link was opened in the browser) */
  protected readonly inviteOpen = signal(false);
  protected readonly inviteProblem = signal(false);

  /** Reads the clipboard (a tap is needed, and some apps refuse: then the person pastes by hand into the box). */
  protected async pasteInvite(box: HTMLInputElement): Promise<void> {
    try {
      box.value = await navigator.clipboard.readText();
    } catch {
      box.focus();
      return;
    }
    this.useInvite(box.value);
  }

  protected useInvite(text: string): void {
    const ok = this.friendLinks.use(text);
    this.inviteProblem.set(!ok);
    if (ok) this.inviteOpen.set(false);
  }
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  /** Why the person was signed out (for example a failed connection to sign-in), if they were. */
  protected readonly signedOutNotice = this.auth.signedOutNotice;

  /** a person who comes with a friend link starts at "Create account" (the link is an invitation, so most have no account yet); the toggle below goes to sign-in */
  protected readonly mode = signal<AuthMode>(this.friendLinks.pending() ? 'signup' : 'signin');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly info = signal<string | null>(null);
  /** a sign-in with email and password was turned down: the person may not have an account yet, so creating one is offered clearly */
  protected readonly rejected = signal(false);

  protected toggleMode(): void {
    this.mode.update((m) => (m === 'signin' ? 'signup' : 'signin'));
    this.error.set(null);
    this.info.set(null);
    this.rejected.set(false);
  }

  protected google(): Promise<void> {
    return this.run(() => this.auth.signInWithGoogle());
  }

  protected submit(email: string, password: string, name: string, again: string): Promise<void> {
    if (this.mode() === 'signup' && password !== again) {
      this.error.set(tr('login.passwordsDiffer', 'The two passwords are not the same. Type them again.'));
      return Promise.resolve();
    }
    return this.run(() =>
      this.mode() === 'signin'
        ? this.auth.signInWithEmail(email.trim(), password)
        : this.auth.registerWithEmail(email.trim(), password, name.trim() || undefined),
    );
  }

  protected async forgot(email: string): Promise<void> {
    this.error.set(null);
    this.info.set(null);
    if (!email.trim()) {
      this.error.set(tr('login.enterEmail', 'Enter your email first.'));
      return;
    }
    try {
      await this.auth.resetPassword(email.trim());
      this.info.set(tr('login.resetSent', 'Password reset email sent (if the account exists).'));
    } catch (err: any) {
      this.error.set(authMessage(err, tr('login.resetFail', 'Could not send reset email.')));
    }
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    this.info.set(null);
    this.rejected.set(false);
    try {
      await action();
      await this.router.navigateByUrl(this.auth.landingPath());
    } catch (err) {
      if (!wasCancelled(err)) this.error.set(authMessage(err, tr('login.signInFailed', 'Sign-in failed. Please try again.')));
      if (this.mode() === 'signin' && wasRejected(err)) this.rejected.set(true);
    } finally {
      this.busy.set(false);
    }
  }
}
