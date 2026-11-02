import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { authMessage } from '../core/auth-errors';
import { AuthService } from '../core/auth.service';

/** Sign in without a password: we email a link, and opening it signs the person in. */
@Component({
  selector: 'app-login-email',
  imports: [RouterLink],
  templateUrl: './login-email.html',
})
export class LoginEmail {
  private readonly auth = inject(AuthService);

  protected readonly email = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  /** the address the link was sent to (the page then says "check your email") */
  protected readonly sentTo = signal<string | null>(null);

  protected async send(): Promise<void> {
    const email = this.email().trim();
    if (!email) {
      this.error.set('Write your email address first.');
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.auth.sendSignInLink(email);
      this.sentTo.set(email);
    } catch (err) {
      this.error.set(authMessage(err, 'Could not send the link. Please try again.'));
    } finally {
      this.busy.set(false);
    }
  }

  protected useAnother(): void {
    this.sentTo.set(null);
    this.error.set(null);
  }
}
