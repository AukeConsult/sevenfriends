import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import type { DocumentData, Query, QuerySnapshot } from 'firebase/firestore'; // types only: the SDK itself is loaded on demand below
import { LiveMessage } from '../models';
import { AuthService } from './auth.service';
import { DesktopNoticeService } from './desktop-notice.service';
import { FriendsService } from './friends.service';
import { NotificationsService } from './notifications.service';
import { SoundService } from './sound.service';

type FirestoreSdk = typeof import('firebase/firestore');
type Added = { id: string; data: DocumentData };

/** How long to wait before a broken live listener is started again. */
const RETRY_MS = 5000;

/**
 * The ONE place that listens for live changes (Firestore realtime listeners, `onSnapshot`) under the
 * signed-in user's own account. Two things can ping:
 *
 *  1. incoming-signal: somebody added me as a friend.
 *     -> run the ordinary backend search (the check) and reload the friends, so the request shows
 *        in the incoming events on Home (and as a pending seat on Friends).
 *  2. my friend list: any change of an entry (the person I asked confirmed or rejected, somebody deleted me,
 *     a request got linked ...). The list is reloaded at once, so the answer to my request shows live on
 *     Friends, and a desktop notification says who answered (when the tab is not in view).
 *  3. messages (the unread ones): somebody wrote to me.
 *     -> if that person's feed is OPEN, show the message in it at once (`latestMessage`, the Chat page
 *        reacts and marks it read); otherwise run the search so it shows in the incoming events on Home.
 *
 * The Firestore SDK is loaded after login (a separate download, not part of the first one).
 * Firestore rules: a user can only read their own pings, messages and friend list (see firestore.rules).
 */
@Injectable({ providedIn: 'root' })
export class RealtimeService {
  private readonly auth = inject(AuthService);
  private readonly notifications = inject(NotificationsService);
  private readonly friends = inject(FriendsService);
  private readonly sound = inject(SoundService);
  private readonly desktop = inject(DesktopNoticeService);

  /** The message feed that is open right now (set by the Chat page): its messages are shown there, not on Home. */
  readonly openFeed = signal<string | null>(null);

  /** The newest message that arrived live. The Chat page refreshes when it belongs to its feed. */
  readonly latestMessage = signal<LiveMessage | null>(null);

  /** A feed whose messages were edited or deleted by the friend (the Chat page of that feed reloads). */
  readonly feedChanged = signal<{ connectionId: string; seq: number } | null>(null);

  private stops: (() => void)[] = [];
  private messagesChangedAt = new Map<string, number>();
  private friendsTimer: ReturnType<typeof setTimeout> | undefined;
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
        this.watch(sdk, mine('incoming-signal'), (_added, first) => {
          const known = new Set(this.friends.requests().map((r) => r.id));
          if (!first) this.sound.play('request'); // somebody just added me (what was there already is not announced)
          void this.refreshEverything().then(() => {
            if (first) return;
            for (const request of this.friends.requests()) {
              if (known.has(request.id)) continue;
              this.notify('request', { title: `${request.fromName} wants to be your friend`, body: request.message ?? 'Open Seven Friends to answer.', id: `request-${request.id}`, go: '/' });
            }
          });
        }),
        // 2. my own friend list: a change means an answer, a deletion or a new link
        this.watchFriends(sdk, sdk.collection(db, 'user-account', uid, 'friend-circle', 'default', 'friends')),
        // 3. messages: only the unread ones (what I wrote is already read), so a new document is a new message for me
        this.watch(sdk, sdk.query(mine('messages'), sdk.where('read', '==', false)), (added, first) => this.onMessages(added, first)),
      ];
    } catch (error) {
      console.warn('Could not start listening for live updates:', error);
    }
  }

  /**
   * One live query. `onSnapshot(snapshot, first)` runs for every snapshot (`first`: what was there already).
   * When the connection to the database breaks (or is refused for a moment, for example while the rules reload),
   * the listener is started again after a few seconds, so live updates never silently stop.
   */
  private listen(
    sdk: FirestoreSdk,
    source: Query<DocumentData>,
    onSnapshot: (snapshot: QuerySnapshot<DocumentData>, first: boolean) => void,
    label: string,
  ): () => void {
    let stopped = false;
    let unsubscribe: () => void = () => undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const start = () => {
      let first = true;
      unsubscribe = sdk.onSnapshot(
        source,
        (snapshot) => {
          const isFirst = first;
          first = false;
          onSnapshot(snapshot, isFirst);
        },
        (error) => {
          console.warn(`Live updates of ${label} stopped (${error.message}); trying again in a few seconds`);
          if (!stopped) retry = setTimeout(start, RETRY_MS);
        },
      );
    };
    start();

    return () => {
      stopped = true;
      clearTimeout(retry);
      unsubscribe();
    };
  }

  /** One live query. `handle` gets the documents that were ADDED (documents that go away are ignored). */
  private watch(sdk: FirestoreSdk, source: Query<DocumentData>, handle: (added: Added[], first: boolean) => void): () => void {
    return this.listen(
      sdk,
      source,
      (snapshot, first) => {
        const added = snapshot.docChanges().filter((c) => c.type === 'added').map((c) => ({ id: c.doc.id, data: c.doc.data() }));
        if (added.length) handle(added, first);
      },
      'pings and messages',
    );
  }

  /** Listens to the friend list: every change after the first snapshot reloads the list (changes that come together are one reload). */
  private watchFriends(sdk: FirestoreSdk, source: Query<DocumentData>): () => void {
    const stop = this.listen(
      sdk,
      source,
      (snapshot, first) => {
        // the friend edited or deleted a message: the friendship was touched with a new `messagesChangedAt`
        for (const change of snapshot.docChanges()) {
          const stamp = change.doc.data()['messagesChangedAt']?.toMillis?.() as number | undefined;
          if (stamp === undefined) continue;
          if (!first && this.messagesChangedAt.get(change.doc.id) !== stamp) this.feedChanged.set({ connectionId: change.doc.id, seq: ++this.seq });
          this.messagesChangedAt.set(change.doc.id, stamp);
        }
        if (first || !snapshot.docChanges().length) return;
        clearTimeout(this.friendsTimer);
        this.friendsTimer = setTimeout(() => void this.onFriendsChanged(), 250);
      },
      'the friend list',
    );
    return () => {
      clearTimeout(this.friendsTimer);
      stop();
    };
  }

  /** Reload the friends and tell what happened: an answer to a request I sent, or a friend who removed me. */
  private async onFriendsChanged(): Promise<void> {
    const before = new Map(this.friends.friends().map((f) => [f.id, f]));
    try {
      await this.friends.load();
    } catch {
      return;
    }
    const now = new Map(this.friends.friends().map((f) => [f.id, f]));
    for (const friend of now.values()) {
      const was = before.get(friend.id);
      if (was?.status !== 'pending' || friend.incoming) continue; // only answers to MY requests
      this.sound.play('answer');
      this.notify('answer', {
        title: friend.status === 'confirmed' ? `${friend.name} accepted your friend request` : `${friend.name} rejected your friend request`,
        body: '',
        id: `answer-${friend.id}-${friend.status}`, // one per answer
        go: '/friends',
      });
    }
    // gone from my list although I did not delete it (my own deletes are removed from the list at once): they ended it
    for (const [id, was] of before) {
      if (!now.has(id)) {
        this.notify('answer', { title: `${was.name} removed the friendship`, body: 'The conversation is deleted for both of you.', id: `removed-${id}`, go: '/friends' });
      }
    }
  }

  /** A desktop notice (only when the tab is not in view and the person allowed it). The system adds no sound of its own when the app plays one. */
  private notify(event: 'message' | 'request' | 'answer', notice: { title: string; body: string; id: string; go: string }): void {
    this.desktop.show({
      title: notice.title,
      body: notice.body,
      id: notice.id,
      silent: this.sound.choices()[event] !== 'none',
      go: notice.go,
    });
  }

  private onMessages(added: Added[], first: boolean): void {
    if (!first) {
      // tell the open feed (the Chat page checks that the message is for its connection)
      for (const m of added) {
        const connectionId = m.data['connectionId'] as string | undefined;
        if (connectionId) this.latestMessage.set({ connectionId, messageId: m.id, seq: ++this.seq });
      }
      // a sound, unless I am reading that very conversation (I see the message arrive)
      const unseen = added.filter((m) => m.data['connectionId'] !== this.openFeed());
      if (unseen.length) this.sound.play('message');
      for (const m of unseen) {
        const connectionId = m.data['connectionId'] as string | undefined;
        const text = String(m.data['text'] ?? '');
        this.notify('message', {
          title: String(m.data['fromName'] ?? 'New message'),
          body: text.length > 120 ? `${text.slice(0, 120)}…` : text,
          id: `message-${m.id}`, // one per message
          go: connectionId ? `/friends/${connectionId}` : '/',
        });
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
