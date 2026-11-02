import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import type { DocumentData, Query } from 'firebase/firestore'; // types only: the SDK itself is loaded on demand below
import { LiveMessage } from '../models';
import { AuthService } from './auth.service';
import { FriendsService } from './friends.service';
import { NotificationsService } from './notifications.service';

type FirestoreSdk = typeof import('firebase/firestore');
type Added = { id: string; data: DocumentData };

/**
 * The ONE place that listens for live changes (Firestore realtime listeners, `onSnapshot`) under the
 * signed-in user's own account. Two things can ping:
 *
 *  1. incoming-signal: somebody added me as a friend.
 *     -> run the ordinary backend search (the check) and reload the friends, so the request shows
 *        in the incoming events on Home (and as a pending seat on Friends).
 *  2. messages (the unread ones): somebody wrote to me.
 *     -> if that person's feed is OPEN, show the message in it at once (`latestMessage`, the Chat page
 *        reacts and marks it read); otherwise run the search so it shows in the incoming events on Home.
 *
 * The Firestore SDK is loaded after login (a separate download, not part of the first one).
 * Firestore rules: a user can only read their own pings and messages (see firestore.rules).
 */
@Injectable({ providedIn: 'root' })
export class RealtimeService {
  private readonly auth = inject(AuthService);
  private readonly notifications = inject(NotificationsService);
  private readonly friends = inject(FriendsService);

  /** The message feed that is open right now (set by the Chat page): its messages are shown there, not on Home. */
  readonly openFeed = signal<string | null>(null);

  /** The newest message that arrived live. The Chat page refreshes when it belongs to its feed. */
  readonly latestMessage = signal<LiveMessage | null>(null);

  private stops: (() => void)[] = [];
  private listeningFor: string | null = null;
  private seq = 0;

  constructor() {
    // follow the login: listen while somebody is signed in, stop at sign-out
    effect(() => {
      const uid = this.auth.user()?.uid ?? null;
      untracked(() => void this.follow(uid));
    });
  }

  private async follow(uid: string | null): Promise<void> {
    this.stopAll();
    this.listeningFor = uid;
    if (!uid) return;

    try {
      const [sdk, { db }] = await Promise.all([import('firebase/firestore'), import('./firestore')]);
      if (this.listeningFor !== uid) return; // signed out (or another user) while it was loading

      const mine = (collectionName: string) => sdk.collection(db, 'user-account', uid, collectionName);
      this.stops = [
        // 1. pings: somebody added me
        this.watch(sdk, mine('incoming-signal'), () => void this.refreshEverything()),
        // 2. messages: only the unread ones (what I wrote is already read), so a new document is a new message for me
        this.watch(sdk, sdk.query(mine('messages'), sdk.where('read', '==', false)), (added, first) => this.onMessages(added, first)),
      ];
    } catch (error) {
      console.warn('Could not start listening for live updates:', error);
    }
  }

  /** One live query. `handle` gets the documents that were ADDED (documents that go away are ignored). */
  private watch(sdk: FirestoreSdk, source: Query<DocumentData>, handle: (added: Added[], first: boolean) => void): () => void {
    let first = true; // the first snapshot is what is there already
    return sdk.onSnapshot(
      source,
      (snapshot) => {
        const added = snapshot.docChanges().filter((c) => c.type === 'added').map((c) => ({ id: c.doc.id, data: c.doc.data() }));
        const isFirst = first;
        first = false;
        if (added.length) handle(added, isFirst);
      },
      (error) => console.warn('Live updates are not available:', error.message),
    );
  }

  private onMessages(added: Added[], first: boolean): void {
    if (!first) {
      // tell the open feed (the Chat page checks that the message is for its connection)
      for (const m of added) {
        const connectionId = m.data['connectionId'] as string | undefined;
        if (connectionId) this.latestMessage.set({ connectionId, messageId: m.id, seq: ++this.seq });
      }
    }
    // Home: run the search, unless every new message is for the feed that is open now
    // (that page shows it at once and marks it read, so it must not turn up in the incoming events)
    const open = this.openFeed();
    if (first || added.some((m) => m.data['connectionId'] !== open)) void this.notifications.refresh();
  }

  /** The ordinary search, then show what it found. */
  private async refreshEverything(): Promise<void> {
    await this.notifications.refresh();
    await this.friends.load().catch(() => undefined); // the Friends page shows the new pending seat
  }

  private stopAll(): void {
    this.stops.forEach((stop) => stop());
    this.stops = [];
  }
}
