import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { ApiService } from '../core/api.service';
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

  protected readonly user = inject(AuthService).user;
  protected readonly networks = SOCIAL_NETWORKS;

  protected readonly form = signal<ProfileDraft>({ name: '', phone: '', ...emptySocialDraft() });
  protected readonly loading = signal(true);
  protected readonly state = signal<SaveState>('idle');
  protected readonly error = signal<string | null>(null);

  /** A name can never be empty: while it is, the old name is kept and everything else still saves. */
  protected readonly nameMissing = computed(() => !this.form().name.trim());

  protected readonly initial = computed(() => (this.form().name.trim() || this.user()?.email || '?')[0].toUpperCase());
  protected readonly provider = computed(() => {
    const id = this.user()?.providerData[0]?.providerId;
    return id === 'google.com' ? 'Google' : id === 'password' ? 'Email and password' : (id ?? 'Unknown');
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
    this.load();
    inject(DestroyRef).onDestroy(() => {
      clearTimeout(this.timer);
      if (this.dirty) void this.flush(); // leaving the page: save what is left (the request finishes by itself)
    });
  }

  protected async load(): Promise<void> {
    this.error.set(null);
    this.loadFailed = false;
    try {
      const res = await this.api.request<ProfileDetails>('/profile');
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
