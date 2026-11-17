import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FriendAvatar } from '../friend-avatar/friend-avatar';
import { FriendsService } from '../core/friends.service';
import { PageBar } from '../page-bar/page-bar';
import { tr } from '../core/i18n';

/** The most the writing field of a message holds (the same limit as friend-send). */
const MAX_DRAFT = 2000;

/**
 * Something was shared with the app from another app's share dialog (`/share-in?title=&text=&url=`, opened by the Android, iPhone or Windows app, or the
 * browser's share target): the person chooses the friend or group, and the message is written for him in that conversation (`/friends/:id/send?draft=`).
 * Nothing is sent from here: what was shared is untrusted text, so it only lands in the writing field, where the person reads it and presses Send.
 * (`/share` is another page: the links that invite someone.)
 */
@Component({
  selector: 'app-share-in',
  imports: [FriendAvatar, PageBar, TranslocoDirective],
  templateUrl: './share-in.html',
  providers: [provideTranslocoScope('shareIn')],
})
export class ShareIn {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly friendsService = inject(FriendsService);

  /** what was shared, as one text: the title (when the text does not hold it already), the text and the link, each once */
  protected readonly draft = computed(() => {
    const query = this.route.snapshot.queryParamMap;
    const parts: string[] = [];
    for (const key of ['title', 'text', 'url']) {
      const value = (query.get(key) ?? '').trim();
      if (value && !parts.some((p) => p.includes(value))) parts.push(value);
    }
    // a text that already holds the title or the link is not given twice
    return parts.filter((p, i) => !parts.some((q, j) => j !== i && q.length > p.length && q.includes(p))).join('\n').slice(0, MAX_DRAFT);
  });

  /** the shared text line by line (a plain text, never HTML) */
  protected readonly lines = computed(() => this.draft().split('\n'));

  /** those who can be written to: confirmed friends in a seat, and groups */
  protected readonly targets = computed(() => this.friendsService.awake().filter((f) => f.status === 'confirmed'));
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  constructor() {
    this.friendsService
      .load()
      .catch(() => this.error.set(tr('shareIn.loadFailed', 'The list of friends could not be loaded.')))
      .finally(() => this.loading.set(false));
  }

  protected choose(id: string): void {
    void this.router.navigate(['/friends', id, 'send'], { queryParams: { draft: this.draft() } });
  }

  protected cancel(): void {
    void this.router.navigateByUrl('/');
  }
}
