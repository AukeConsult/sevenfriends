import { Injectable, computed, inject, signal } from '@angular/core';
import { RecoveryItem } from '../models';
import { ActiveCircleService } from './active-circle.service';
import { CircleActivityService } from './circle-activity.service';
import { ApiService } from './api.service';

/** What a refresh found that is new (the app rings and shows a notice for it). */
export interface RecoveryNews {
  item: RecoveryItem;
  /** the circle in use shows the thing itself; another circle only gets its "Activity in ..." note */
  here: boolean;
}

/**
 * The recovery requests that are about me, in ALL my circles (design: docs/design/recovery-by-friend.md):
 * - a friend asks ME for help (`toHelp`): a card under "Needs you" with Open and Decline;
 * - a friend DECLINED my request (`declined`): a card with Ask again and Dismiss;
 * - a friend FINISHED my request: a fading notice (`finished`), and the request is dismissed (deleted) as soon as it has been shown; nothing is kept.
 * What is in another circle only makes that circle's note ("Activity in ..."); nothing of it is shown. A finished request of another circle waits
 * until that circle is opened.
 */
@Injectable({ providedIn: 'root' })
export class RecoveryInboxService {
  // only the light services: Attention (the title of the page, which the Router needs) counts these, so nothing heavy may be injected here (NG0200, see CLAUDE.md)
  private readonly api = inject(ApiService);
  private readonly active = inject(ActiveCircleService);
  private readonly activity = inject(CircleActivityService);

  readonly requests = signal<RecoveryItem[]>([]);
  /** friends who finished my request, in the circle in use, to be told once (Home turns each into a notice that fades) */
  readonly finished = signal<string[]>([]);

  /** friends of the circle in use who ask me for help (also while I am already helping: Open continues) */
  readonly toHelp = computed(() => this.requests().filter((r) => r.role === 'helper' && r.circleId === this.active.id));
  /** my requests of the circle in use that a friend declined */
  readonly declined = computed(() => this.requests().filter((r) => r.role === 'requester' && r.status === 'declined' && r.circleId === this.active.id));
  /** how many things wait for me in the circle in use (the tab title and the icon badge) */
  readonly count = computed(() => this.toHelp().length + this.declined().length);

  private seen = new Set<string>();
  private started = false;

  constructor() {
    // another circle: what was shown belongs to the old one (the next refresh brings the new circle's)
    this.active.onSwitch(() => this.requests.set([]));
  }

  clear(): void {
    this.requests.set([]);
    this.finished.set([]);
    this.seen = new Set();
    this.started = false;
  }

  /** Asks the server, shows what is there and returns what is new since the last time (nothing at the start: what was waiting is only shown). */
  async refresh(): Promise<RecoveryNews[]> {
    const generation = this.active.generation;
    let list: RecoveryItem[];
    try {
      list = (await this.api.request<{ requests: RecoveryItem[] }>('/recovery')).requests;
    } catch {
      return []; // a help, not a requirement: Home works without it
    }
    if (generation !== this.active.generation) return []; // the circle was changed meanwhile
    const first = !this.started;
    this.started = true;
    const news: RecoveryNews[] = [];
    const keys = new Set<string>();
    for (const item of list) {
      const key = `${item.circleId}/${item.id}/${item.role}/${item.status}/${item.createdAt}`;
      keys.add(key);
      const happening = item.role === 'helper' ? item.status === 'asked' : item.status === 'declined' || item.status === 'done';
      if (happening && !first && !this.seen.has(key)) news.push({ item, here: item.circleId === this.active.id });
    }
    this.seen = keys;
    this.requests.set(list);

    // another circle: its note, nothing more
    for (const item of list) {
      if (item.circleId === this.active.id) continue;
      if (item.role === 'helper' || item.status === 'declined' || item.status === 'done') this.activity.mark(item.circleId);
    }
    // a finished request of the circle in use: told once, then deleted
    for (const item of list.filter((r) => r.role === 'requester' && r.status === 'done' && r.circleId === this.active.id)) {
      this.finished.update((names) => [...names, item.friendName]);
      void this.post(item, 'dismiss').then(() => this.requests.update((all) => all.filter((r) => r !== item))).catch(() => undefined);
    }
    return news;
  }

  /** The friend says no from Home. */
  async decline(item: RecoveryItem): Promise<void> {
    await this.post(item, 'decline');
    this.requests.update((all) => all.filter((r) => r !== item));
  }

  /** The asker has read that the friend said no. */
  async dismiss(item: RecoveryItem): Promise<void> {
    await this.post(item, 'dismiss');
    this.requests.update((all) => all.filter((r) => r !== item));
  }

  private post(item: RecoveryItem, what: 'decline' | 'dismiss'): Promise<unknown> {
    return this.api.request<unknown>(`/circles/${item.circleId}/friends/${item.id}/recovery/${what}`, { method: 'POST' });
  }
}
