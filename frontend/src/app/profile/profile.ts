import { Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from '../core/api.service';
import { authMessage } from '../core/auth-errors';
import { AuthService } from '../core/auth.service';
import { SOCIAL_NETWORKS, draftFromSocials, emptySocialDraft, socialsFromDraft } from '../core/social';
import { ProfileDetails, ProfileDraft, SaveState } from '../models';

/** Changes are saved by themselves: a moment after you stop typing, and when you leave a field or the page. */
const AUTOSAVE_MS = 800;

@Component({
  selector: 'app-profile',
  templateUrl: './profile.html',
  styleUrl: './profile.scss',
})
export class Profile {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly user = this.auth.user;
  protected readonly networks = SOCIAL_NETWORKS;

  protected readonly form = signal<ProfileDraft>({ name: '', phone: '', ...emptySocialDraft() });
  protected readonly loading = signal(true);
  /** the phone is confirmed by SMS: it can no longer be typed over */
  protected readonly phoneVerified = signal(false);
  /** from the server (the login token), so it always agrees with what friends can find */
  protected readonly emailVerified = signal(false);
  protected readonly verificationSent = signal(false);
  protected readonly verificationError = signal<string | null>(null);
  protected readonly state = signal<SaveState>('idle');
  protected readonly error = signal<string | null>(null);

  /** A name can never be empty: while it is, the old name is kept and everything else still saves. */
  protected readonly nameMissing = computed(() => !this.form().name.trim());

  protected readonly initial = computed(() => (this.form().name.trim() || this.user()?.email || '?')[0].toUpperCase());
  protected readonly provider = computed(() => {
    const id = this.user()?.providerData[0]?.providerId;
    return id === 'google.com' ? 'Google' : id === 'password' ? 'Email' : id === 'phone' ? 'Phone' : (id ?? 'Unknown');
  });
  protected readonly memberSince = computed(() => {
    const created = this.user()?.metadata.creationTime;
    return created ? new Date(created).toLocaleDateString() : null;
  });

  private timer: ReturnType<typeof setTimeout> | undefined;
  private dirty = false; // something changed that is not saved yet
  private saving = false;
  private loadFailed = false;

  constructor() {
    // verifying the phone or email changes what the server knows about this person: load again
    let first = true;
    effect(() => {
      this.auth.accountVersion();
      if (first) first = false;
      else void this.load();
    });
    void this.refreshVerification();
    this.load();
    inject(DestroyRef).onDestroy(() => {
      clearTimeout(this.timer);
      if (this.dirty) void this.flush(); // leaving the page: save what is left (the request finishes by itself)
    });
  }

  /** Picks up a verification done in another tab or on another device. */
  private async refreshVerification(): Promise<void> {
    try {
      await this.auth.refreshAccount();
    } catch {
      /* offline or signed out: the page still works with what it has */
    }
  }

  protected deleteAccount(): void {
    void this.router.navigateByUrl('/delete-account');
  }

  /** Saves the number as typed, then opens the SMS page for exactly that number. */
  protected async verifyPhone(): Promise<void> {
    await this.flush();
    if (this.state() === 'error') return; // the number was refused: the message is shown here
    await this.router.navigate(['/verify-phone'], { queryParams: { phone: this.form().phone.trim() } });
  }

  protected async sendVerificationEmail(): Promise<void> {
    this.verificationError.set(null);
    try {
      await this.auth.sendVerificationEmail();
      this.verificationSent.set(true);
    } catch (err) {
      this.verificationError.set(authMessage(err, 'Could not send the email. Please try again.'));
    }
  }

  protected async load(): Promise<void> {
    this.error.set(null);
    this.loadFailed = false;
    try {
      const res = await this.api.request<ProfileDetails>('/profile');
      this.phoneVerified.set(res.phoneVerified);
      this.emailVerified.set(res.emailVerified);
      this.form.set({ name: res.name ?? '', phone: res.phone ?? '', ...draftFromSocials(res) });
    } catch (err: any) {
      this.loadFailed = true;
      this.state.set('error');
      this.error.set(err.message ?? 'Could not load your profile');
    } finally {
      this.loading.set(false);
    }
  }

  /** "Try again": load the profile if that failed, otherwise save again. */
  protected retry(): void {
    if (this.loadFailed) void this.load();
    else void this.flush();
  }

  protected setField(field: keyof ProfileDraft, value: string): void {
    this.form.update((f) => ({ ...f, [field]: value }));
    this.dirty = true;
    this.state.set('dirty');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), AUTOSAVE_MS);
  }

  /** Saves now if anything changed (also called when a field loses focus, and by "Try again"). */
  protected async flush(): Promise<void> {
    clearTimeout(this.timer);
    if (!this.dirty || this.saving) return; // a save that is running repeats itself if more changed
    this.saving = true;
    this.state.set('saving');
    this.error.set(null);
    try {
      while (this.dirty) {
        this.dirty = false;
        const sent = this.form();
        const name = sent.name.trim();
        const res = await this.api.request<ProfileDetails>('/profile', {
          method: 'PUT',
          // no name while it is empty: the old one stays, phone and accounts still save
          body: JSON.stringify({ ...(name ? { name } : {}), phone: sent.phone || null, ...socialsFromDraft(sent) }),
        });
        // show the cleaned-up values (for example a leading @ removed), unless the user typed on meanwhile
        if (!this.dirty && this.form() === sent) {
          this.form.update((f) => ({ ...f, phone: res.phone ?? '', ...draftFromSocials(res) }));
        }
      }
      this.state.set('saved');
    } catch (err: any) {
      this.dirty = true; // not saved: try again on the next change, a blur or "Try again"
      this.state.set('error');
      this.error.set(err.message ?? 'Could not save');
    } finally {
      this.saving = false;
    }
  }
}
