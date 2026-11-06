import { Injectable, computed, inject, signal } from '@angular/core';
import { ApiService } from './api.service';

/**
 * My invite link (`/welcome?invite=<code>`): whoever opens it, signs in and confirms sends me a friend request.
 * The code is made on the server the first time it is asked for. Shown on the profile page and on Add a friend.
 */
@Injectable({ providedIn: 'root' })
export class InviteLinkService {
  private readonly api = inject(ApiService);

  private readonly code = signal<string | null>(null);
  /** the link to give away; null until the code is loaded */
  readonly link = computed(() => (this.code() ? `${location.origin}/welcome?invite=${this.code()}` : null));
  /** why the link could not be loaded (null = no problem); shown instead of the link, with a way to try again */
  readonly problem = signal<string | null>(null);
  /** what a button just did ("Link copied"), shown for a moment */
  readonly note = signal<string | null>(null);

  /** Loads my code (once; later calls do nothing). */
  async load(): Promise<void> {
    if (this.code()) return;
    this.problem.set(null);
    try {
      this.code.set((await this.api.request<{ code: string }>('/invite/code')).code);
    } catch (err: any) {
      // the rest of the page works without the link; 404 = the backend has not been deployed with the invite routes yet
      this.problem.set(err?.status === 404 ? 'The invite link is not available yet (the server needs to be updated).' : `Could not load your invite link: ${err?.message ?? 'no connection'}`);
    }
  }

  private say(text: string): void {
    this.note.set(text);
    setTimeout(() => this.note.set(null), 2500);
  }

  /** Shares the link (the phone's share sheet), or copies it where there is none. */
  async share(url: string | null = this.link()): Promise<void> {
    if (!url) return;
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Seven Friends', text: 'Be my friend on Seven Friends:', url });
        return;
      }
      await navigator.clipboard.writeText(url);
      this.say('Link copied');
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') this.say('Could not copy: select the link and copy it');
    }
  }

  async copy(url: string | null = this.link()): Promise<void> {
    try {
      await navigator.clipboard.writeText(url ?? '');
      this.say('Link copied');
    } catch {
      this.say('Could not copy: select the link and copy it');
    }
  }

  /** A new code: the old link stops working. */
  async reset(): Promise<void> {
    try {
      this.code.set((await this.api.request<{ code: string }>('/invite/code/reset', { method: 'POST' })).code);
      this.say('New link made: the old one no longer works');
    } catch {
      this.say('Could not make a new link');
    }
  }
}
