import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { authMessage, wasCancelled } from '../core/auth-errors';
import { AuthService } from '../core/auth.service';
import { AuthMode } from '../models';

@Component({
  selector: 'app-login',
  imports: [RouterLink],
  templateUrl: './login.html',
  styleUrl: './login.scss',
})
export class Login {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly mode = signal<AuthMode>('signin');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly info = signal<string | null>(null);

  protected toggleMode(): void {
    this.mode.update((m) => (m === 'signin' ? 'signup' : 'signin'));
    this.error.set(null);
    this.info.set(null);
  }

  protected google(): Promise<void> {
    return this.run(() => this.auth.signInWithGoogle());
  }

  protected submit(email: string, password: string, name: string): Promise<void> {
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
      this.error.set('Enter your email first.');
      return;
    }
    try {
      await this.auth.resetPassword(email.trim());
      this.info.set('Password reset email sent (if the account exists).');
    } catch (err: any) {
      this.error.set(authMessage(err, 'Could not send reset email.'));
    }
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    this.info.set(null);
    try {
      await action();
      await this.router.navigateByUrl('/');
    } catch (err) {
      if (!wasCancelled(err)) this.error.set(authMessage(err, 'Sign-in failed. Please try again.'));
    } finally {
      this.busy.set(false);
    }
  }
}
