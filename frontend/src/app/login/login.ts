import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../core/auth.service';

type Mode = 'signin' | 'signup';

const MESSAGES: Record<string, string> = {
  'auth/invalid-credential': 'Wrong email or password.',
  'auth/wrong-password': 'Wrong email or password.',
  'auth/user-not-found': 'Wrong email or password.',
  'auth/invalid-email': 'Please enter a valid email address.',
  'auth/email-already-in-use': 'An account with this email already exists.',
  'auth/weak-password': 'Password must be at least 6 characters.',
  'auth/too-many-requests': 'Too many attempts. Try again later.',
  'auth/operation-not-allowed': 'This sign-in method is not enabled in Firebase.',
};

@Component({
  selector: 'app-login',
  templateUrl: './login.html',
  styleUrl: './login.scss',
})
export class Login {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly mode = signal<Mode>('signin');
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
      this.error.set(MESSAGES[err?.code] ?? 'Could not send reset email.');
    }
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    this.info.set(null);
    try {
      await action();
      await this.router.navigateByUrl('/');
    } catch (err: any) {
      const code: string | undefined = err?.code;
      if (code !== 'auth/popup-closed-by-user' && code !== 'auth/cancelled-popup-request') {
        this.error.set(MESSAGES[code ?? ''] ?? 'Sign-in failed. Please try again.');
      }
    } finally {
      this.busy.set(false);
    }
  }
}
