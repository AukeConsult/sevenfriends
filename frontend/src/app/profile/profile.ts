import { Clearable } from '../core/clearable';
import { Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { MoodEditor } from '../mood-editor/mood-editor';
import { ApiService } from '../core/api.service';
import { authMessage } from '../core/auth-errors';
import { AuthService } from '../core/auth.service';
import { LiveChanges } from '../core/live-changes';
import { countries, dialCode, fullNumber, isValidPhone, nationalNumber } from '../core/countries';
import { SOCIAL_NETWORKS, draftFromSocials, emptySocialDraft, socialsFromDraft } from '../core/social';
import { ProfileDetails, ProfileDraft, ProfilePicture, SaveState } from '../models';

/** Changes are saved by themselves: a moment after you stop typing, and when you leave a field or the page. */
const AUTOSAVE_MS = 800;
/** A save that failed (offline, a server hiccup) is tried again after this long, until it works. */
const RETRY_MS = 5000;

@Component({
  selector: 'app-profile',
  imports: [RouterLink, MoodEditor, Clearable],
  templateUrl: './profile.html',
})
export class Profile {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly live = inject(LiveChanges);

  protected readonly user = this.auth.user;
  protected readonly networks = SOCIAL_NETWORKS;

  protected readonly form = signal<ProfileDraft>({ name: '', phone: '', country: '', ...emptySocialDraft() });
  protected readonly loading = signal(true);
  /** the seat icon (1-7) chosen as my own picture, when I have no photo; null = none */
  protected readonly icon = signal<number | null>(null);
  /** the picture I uploaded (a data URL), when I have one */
  protected readonly picture = signal<string | null>(null);
  protected readonly icons = [1, 2, 3, 4, 5, 6, 7];
  protected readonly countries = countries();

  /** the calling code of the chosen country (without the +): "47" for Norway; null while no country is chosen */
  protected readonly dial = computed(() => dialCode(this.form().country));
  /** the number has the code of ANOTHER country than the chosen one */
  protected readonly otherCode = computed(() => {
    const dial = this.dial();
    const phone = this.form().phone.trim();
    return Boolean(dial && phone.startsWith('+') && !phone.startsWith('+' + dial));
  });
  /** the code of the chosen country is shown in front of the number (always, unless the number has another country's code) */
  protected readonly showCode = computed(() => Boolean(this.dial()) && !this.phoneVerified() && !this.otherCode());
  /** what is in the phone field: the number without its code when the code is shown in front of it */
  protected readonly phoneField = computed(() => (this.showCode() ? nationalNumber(this.form().phone, this.form().country) : this.form().phone));
  /** a phone number that is not valid yet is not saved (the rest is): this says so next to the field */
  protected readonly phoneProblem = computed(() => {
    const phone = this.form().phone.trim();
    return Boolean(phone) && !isValidPhone(phone);
  });
  protected readonly countryName = computed(() => this.countries.find((c) => c.code === this.form().country)?.name ?? '');
  /** the row of icons is only open when the person wants to choose */
  protected readonly iconsOpen = signal(false);
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
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
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
    // changed on another device of mine: the picture, the icon and the verification follow at once (the form is not touched while I may be typing)
    this.live.on('profile').pipe(takeUntilDestroyed()).subscribe(() => void this.refreshLive());
    void this.refreshVerification();
    this.load();
    // nothing may be lost: save when the page is hidden or closed (the request is allowed to finish after the page is gone)
    // and try again when the connection is back
    const onHide = () => {
      if (document.visibilityState === 'hidden' && this.dirty) void this.flush(true);
    };
    const onClose = () => {
      if (this.dirty) void this.flush(true);
    };
    const onOnline = () => {
      if (this.dirty) void this.flush();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onClose);
    window.addEventListener('online', onOnline);
    inject(DestroyRef).onDestroy(() => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onClose);
      window.removeEventListener('online', onOnline);
      clearTimeout(this.timer);
      clearTimeout(this.retryTimer);
      if (this.dirty) void this.flush(true); // leaving the page: save what is left (the request finishes by itself)
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
  /** The number with its country code, also when it was saved without (before a country was chosen). */
  private fullPhone(): string {
    const phone = this.form().phone.trim();
    return this.dial() && !phone.startsWith('+') ? (fullNumber(phone, this.form().country) ?? phone) : phone;
  }

  /** Typed in the phone field: with the code of the chosen country in front, only the number itself is typed. */
  protected setPhone(typed: string): void {
    // a number without a code gets the code of the chosen country; one typed with another country's code is kept as typed (and flagged)
    const full = this.dial() && !this.phoneVerified() ? fullNumber(typed, this.form().country) : null;
    this.setField('phone', full ?? typed);
  }

  /** A country was chosen: the code in front of the number changes with it (the number itself is kept). */
  protected setCountry(country: string): void {
    const oldDial = this.dial();
    const newDial = dialCode(country);
    const phone = this.form().phone.trim();
    let next = phone;
    if (phone && newDial && !this.phoneVerified()) {
      if (oldDial && phone.startsWith('+' + oldDial)) next = '+' + newDial + phone.slice(oldDial.length + 1); // the same number under another code
      else if (!phone.startsWith('+')) next = fullNumber(phone, country) ?? phone; // a number saved without a code gets this one
    }
    if (next !== phone) this.form.update((f) => ({ ...f, phone: next }));
    this.setField('country', country);
  }

  protected async verifyPhone(): Promise<void> {
    await this.flush();
    if (this.state() === 'error') return; // the number was refused: the message is shown here
    await this.router.navigate(['/verify-phone'], { queryParams: { phone: this.fullPhone() } });
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

  private async refreshLive(): Promise<void> {
    try {
      const res = await this.api.request<ProfileDetails>('/profile');
      this.phoneVerified.set(res.phoneVerified);
      this.emailVerified.set(res.emailVerified);
      this.icon.set(res.icon);
      this.picture.set(res.hasPicture ? (await this.api.request<ProfilePicture>('/profile/picture').catch(() => null))?.image ?? null : null);
    } catch {
      /* the next change tries again */
    }
  }

  protected async load(): Promise<void> {
    this.error.set(null);
    this.loadFailed = false;
    try {
      const res = await this.api.request<ProfileDetails>('/profile');
      this.phoneVerified.set(res.phoneVerified);
      this.emailVerified.set(res.emailVerified);
      this.icon.set(res.icon);
      this.picture.set(res.hasPicture ? (await this.api.request<ProfilePicture>('/profile/picture').catch(() => null))?.image ?? null : null);
      this.form.set({ name: res.name ?? '', phone: res.phone ?? '', country: res.country ?? '', ...draftFromSocials(res) });
    } catch (err: any) {
      this.loadFailed = true;
      this.state.set('error');
      this.error.set(err.message ?? 'Could not load your profile');
    } finally {
      this.loading.set(false);
    }
  }

  /** Choose one of the seven icons as my own picture (saved by itself, like everything on this page). */
  protected toggleIcons(): void {
    this.iconsOpen.update((open) => !open);
  }

  protected chooseIcon(n: number): void {
    this.iconsOpen.set(false); // chosen: the row closes again
    this.icon.set(n);
    this.dirty = true;
    this.state.set('dirty');
    void this.flush();
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
  protected async flush(keepalive = false): Promise<void> {
    clearTimeout(this.timer);
    clearTimeout(this.retryTimer);
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
          keepalive, // when the page is being closed, the request still goes through
          // no name while it is empty (the old one stays) and no phone number that is not valid yet: everything else still saves
          body: JSON.stringify({
            ...(name ? { name } : {}),
            ...(!sent.phone.trim() || isValidPhone(sent.phone) ? { phone: sent.phone.trim() || null } : {}),
            icon: this.icon(),
            country: sent.country || null,
            ...socialsFromDraft(sent),
          }),
        });
        // show the cleaned-up values (for example a leading @ removed), unless the user typed on meanwhile
        if (!this.dirty && this.form() === sent) {
          // (a phone number that was not valid is kept in the field as typed, and the message says it is not saved)
          this.form.update((f) => ({ ...f, phone: this.phoneProblem() ? f.phone : (res.phone ?? ''), ...draftFromSocials(res) }));
        }
      }
      this.state.set('saved');
    } catch (err: any) {
      this.dirty = true; // not saved: try again by itself in a few seconds (and when the connection is back), on the next change, a blur or "Try again"
      this.state.set('error');
      this.error.set(err.message ?? 'Could not save');
      this.retryTimer = setTimeout(() => void this.flush(), RETRY_MS);
    } finally {
      this.saving = false;
    }
  }
}
