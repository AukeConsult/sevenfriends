import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { authMessage } from '../core/auth-errors';
import { AuthService } from '../core/auth.service';

/** The page the emailed link opens: it finishes the sign-in. */
@Component({
  selector: 'app-login-link',
  imports: [RouterLink],
  templateUrl: './login-link.html',
})
export class LoginLink {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  /** false when this page was not opened from a sign-in link (or the link is broken) */
  protected readonly valid = this.auth.isSignInLink();
  protected readonly needEmail = signal(false);
  protected readonly email = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  constructor() {
    if (!this.valid) return;
    const remembered = this.auth.rememberedEmail();
    if (remembered) void this.finish(remembered); // same device: no need to ask
    else this.needEmail.set(true); // the link was opened on another device: confirm the address
  }

  protected submit(): void {
    const email = this.email().trim();
    if (email) void this.finish(email);
  }

  private async finish(email: string): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.auth.completeSignInLink(email);
      await this.router.navigateByUrl('/');
    } catch (err) {
      this.error.set(authMessage(err, 'Could not sign you in with this link. Ask for a new one.'));
      this.needEmail.set(true);
    } finally {
      this.busy.set(false);
    }
  }
}
