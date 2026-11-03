import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';

/** The word that must be typed, so nobody erases themselves by accident. */
const CONFIRM_WORD = 'DELETE';

/** A full page to erase yourself from the system, for good. */
@Component({
  selector: 'app-delete-account',
  imports: [RouterLink],
  templateUrl: './delete-account.html',
})
export class DeleteAccount {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);

  protected readonly word = CONFIRM_WORD;
  protected readonly typed = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly confirmed = () => this.typed().trim() === CONFIRM_WORD;

  protected async erase(): Promise<void> {
    if (!this.confirmed()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.api.request<void>('/users/me', { method: 'DELETE', body: JSON.stringify({ confirm: CONFIRM_WORD }) });
    } catch (err: any) {
      this.error.set(err.message ?? 'Could not delete your account. Nothing was changed, please try again.');
      this.busy.set(false);
      return;
    }
    // everything is gone on the server: leave this device too
    try {
      await this.auth.logout();
    } catch {
      /* the login no longer exists; nothing more to sign out of */
    }
    // open the front page again with a clean start: a full reload drops everything this device still remembers
    location.assign('/');
  }
}
