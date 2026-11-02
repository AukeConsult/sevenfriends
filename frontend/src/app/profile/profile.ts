import { Component, computed, inject, signal } from '@angular/core';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { SOCIAL_NETWORKS, SocialDraft, Socials, draftFromSocials, emptySocialDraft, socialsFromDraft } from '../core/social';

type Contact = { phone: string } & SocialDraft;
type ContactResponse = { phone: string | null } & Socials;

@Component({
  selector: 'app-profile',
  templateUrl: './profile.html',
  styleUrl: './profile.scss',
})
export class Profile {
  private readonly api = inject(ApiService);

  protected readonly user = inject(AuthService).user;

  protected readonly name = computed(() => this.user()?.displayName || 'No name set');
  protected readonly initial = computed(() => (this.user()?.displayName || this.user()?.email || '?')[0].toUpperCase());
  protected readonly provider = computed(() => {
    const id = this.user()?.providerData[0]?.providerId;
    return id === 'google.com' ? 'Google' : id === 'password' ? 'Email and password' : (id ?? 'Unknown');
  });
  protected readonly memberSince = computed(() => {
    const created = this.user()?.metadata.creationTime;
    return created ? new Date(created).toLocaleDateString() : null;
  });

  // ---- Contact details: phone number + social media accounts ----
  protected readonly contact = signal<Contact>({ phone: '', ...emptySocialDraft() });
  protected readonly networks = SOCIAL_NETWORKS;
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly saved = signal(false);
  protected readonly error = signal<string | null>(null);

  constructor() {
    this.loadContact();
  }

  protected setField(field: keyof Contact, value: string): void {
    this.contact.update((c) => ({ ...c, [field]: value }));
    this.saved.set(false);
  }

  protected async loadContact(): Promise<void> {
    this.error.set(null);
    try {
      const res = await this.api.request<ContactResponse>('/profile');
      this.contact.set({ phone: res.phone ?? '', ...draftFromSocials(res) });
    } catch (err: any) {
      this.error.set(err.message ?? 'Could not load your contact details');
    } finally {
      this.loading.set(false);
    }
  }

  protected async save(): Promise<void> {
    this.saving.set(true);
    this.saved.set(false);
    this.error.set(null);
    try {
      const c = this.contact();
      const res = await this.api.request<ContactResponse>('/profile', {
        method: 'PUT',
        body: JSON.stringify({ phone: c.phone || null, ...socialsFromDraft(c) }),
      });
      this.contact.set({ phone: res.phone ?? '', ...draftFromSocials(res) });
      this.saved.set(true);
    } catch (err: any) {
      this.error.set(err.message ?? 'Could not save');
    } finally {
      this.saving.set(false);
    }
  }
}
