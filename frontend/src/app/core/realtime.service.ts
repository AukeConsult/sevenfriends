import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import type { DocumentData, Query, QuerySnapshot } from 'firebase/firestore'; // types only: the SDK itself is loaded on demand below
import { LiveMessage } from '../models';
import { AuthService } from './auth.service';
import { DesktopNoticeService } from './desktop-notice.service';
import { ActiveCircleService, circleLabel, circleType } from './active-circle.service';
import { CircleActivityService } from './circle-activity.service';
import { FriendsService } from './friends.service';
import { LiveChanges } from './live-changes';
import { NotificationsService } from './notifications.service';
import { PushService } from './push.service';
import { SoundService } from './sound.service';
import { tr } from './i18n';

type FirestoreSdk = typeof import('firebase/firestore');
type Added = { id: string; data: DocumentData };
/** Something that happened in a circle: the circle and a unique id of the event */
type Happening = { circle: string; id: string };

/** The circle a ping, message or entry belongs to (`default` for what was stored before circles were written down). */
const circleOf = (data: DocumentData): string => String(data['circleId'] ?? 'default');

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
  private readonly active = inject(ActiveCircleService);
  private readonly activity = inject(CircleActivityService);
  private readonly sound = inject(SoundService);
  private readonly desktop = inject(DesktopNoticeService);
  private readonly push = inject(PushService);
  private readonly live = inject(LiveChanges);

  /** The message feed that is open right now (set by the Chat page): its messages are shown there, not on Home. */
  readonly openFeed = signal<string | null>(null);

  /** The newest message that arrived live. The Chat page refreshes when it belongs to its feed. */
  readonly latestMessage = signal<LiveMessage | null>(null);

  private syncStamps = new Map<string, number>();
  private stops: (() => void)[] = [];
  private messagesChangedAt = new Map<string, number>();
  /** what each friend entry of ANY circle said the last time (`circle/id`): to tell an answer or a sleeper in a circle that is not in use */
  private seen = new Map<string, { status: string; incoming: boolean; asleep: boolean }>();
  private friendsTimer: ReturnType<typeof setTimeout> | undefined;
  /** counts the times listening was (re)started: a start that is overtaken while the SDK loads gives up */
  private run = 0;
  private seq = 0;

  constructor() {
    // follow the login: listen while somebody is signed in, stop at sign-out
    effect(() => {
      const uid = this.auth.user()?.uid ?? null;
      untracked(() => void this.follow(uid));
    });
    // another circle: the listeners go on (they hear every circle), what belongs to the old circle's open page is let go, and the new circle is looked at at once
    this.active.onSwitch(() => {
      this.openFeed.set(null);
      this.latestMessage.set(null);
      if (this.auth.user()) void this.refreshEverything();
    });
  }

  private async follow(uid: string | null): Promise<void> {
    this.stopAll();
    const run = ++this.run;
    this.seen.clear();
    this.messagesChangedAt.clear();
    if (!uid) {
      this.activity.clearAll();
      return;
    }

    try {
      const [sdk, { db }] = await Promise.all([import('firebase/firestore'), import('./firestore')]);
      if (run !== this.run) return; // signed out, another user or another circle while it was loading

      const mine = (collectionName: string) => sdk.collection(db, 'user-account', uid, collectionName);
      this.stops = [
        // 1. pings: somebody added me
        this.watch(sdk, mine('incoming-signal'), (all, first) => {
          // a ping says which circle was asked: one for another circle only makes a note ("Activity in ..."), the check of that circle shows the request when it is opened
          this.elsewhere(all.filter((s) => circleOf(s.data) !== this.active.id).map((s) => ({ circle: circleOf(s.data), id: `request-${s.id}` })), !first);
          if (!first && !all.some((s) => circleOf(s.data) === this.active.id)) return;
          const known = new Set(this.friends.requests().map((r) => r.id));
          if (!first) this.ring('request'); // somebody just added me (what was there already is not announced)
          void this.refreshEverything().then(() => {
            if (first) return;
            for (const request of this.friends.requests()) {
              if (known.has(request.id)) continue;
              this.notify('request', { title: tr('core.wantsToBeYour', '{{ fromName }} wants to be your {{ one }}', { fromName: request.fromName, one: this.active.words.one }), body: request.message ?? tr('core.openToAnswer', 'Open {{ app }} to answer.', { app: this.active.words.app }), id: `request-${request.id}`, go: '/' });
            }
          });
        }),
        // 2. my own friend lists, all circles in one query (every entry carries ownerUid, see firestore.rules): a change means an answer, a deletion or a new link
        this.watchFriends(sdk, sdk.query(sdk.collectionGroup(db, 'friends'), sdk.where('ownerUid', '==', uid))),
        // 2b. my other devices: a changed profile or sounds (times only, written by the backend)
        this.watchSync(sdk, mine('sync')),
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

  /** Listens to the "something changed" stamps: my profile and my sounds, changed on any of my devices. */
  private watchSync(sdk: FirestoreSdk, source: Query<DocumentData>): () => void {
    return this.listen(
      sdk,
      source,
      (snapshot, first) => {
        for (const change of snapshot.docChanges()) {
          for (const field of ['profileAt', 'preferencesAt', 'requestsAt']) {
            const stamp = change.doc.data()[field]?.toMillis?.() as number | undefined;
            if (stamp === undefined || this.syncStamps.get(field) === stamp) continue;
            this.syncStamps.set(field, stamp);
            if (first) continue; // what was already there is loaded by the pages themselves
            // the person who asked took the request back, or I answered it on another device: the search is run again, so the request goes from Home and the seats
            if (field === 'requestsAt') void this.refreshEverything();
            else this.live.emit({ type: field === 'profileAt' ? 'profile' : 'sounds' });
          }
        }
      },
      'my other devices',
    );
  }

  /**
   * Listens to the friend lists of ALL circles. A change in the circle in use reloads the list (changes that come together are one reload). A change in
   * another circle is not looked at beyond what matters: an answer to my request or the end of a friendship makes a note ("Activity in ..."); moods,
   * presence, seats and the like do not.
   */
  private watchFriends(sdk: FirestoreSdk, source: Query<DocumentData>): () => void {
    const stop = this.listen(
      sdk,
      source,
      (snapshot, first) => {
        const elsewhere: Happening[] = [];
        let here = false;
        for (const change of snapshot.docChanges()) {
          const circle = change.doc.ref.parent.parent?.id ?? 'default';
          const data = change.doc.data();
          const key = `${circle}/${change.doc.id}`;
          const before = this.seen.get(key);
          const status = String(data['status'] ?? 'pending');
          if (change.type === 'removed') this.seen.delete(key);
          else this.seen.set(key, { status, incoming: Boolean(data['incomingRequestId']), asleep: data['asleep'] === true });

          if (circle !== this.active.id) {
            const answered = change.type === 'modified' && before?.status === 'pending' && !before.incoming && (status === 'confirmed' || status === 'rejected');
            if (!first && (change.type === 'removed' || answered)) elsewhere.push({ circle, id: `${change.type}-${change.doc.id}-${status}` });
            continue;
          }
          here = true;
          // the friend edited or deleted a message: the friendship was touched with a new `messagesChangedAt`
          const stamp = data['messagesChangedAt']?.toMillis?.() as number | undefined;
          if (stamp === undefined) continue;
          if (!first && this.messagesChangedAt.get(change.doc.id) !== stamp) this.live.emit({ type: 'feed', connectionId: change.doc.id });
          this.messagesChangedAt.set(change.doc.id, stamp);
        }
        this.elsewhere(elsewhere, true);
        if (first || !here) return;
        clearTimeout(this.friendsTimer);
        this.friendsTimer = setTimeout(() => void this.onFriendsChanged(), 250);
      },
      'the friend lists',
    );
    return () => {
      clearTimeout(this.friendsTimer);
      stop();
    };
  }

  /**
   * Something happened in a circle that is not in use: the circle gets its note ("Activity in ...", see CircleActivityService) and, when it is new (`announce`:
   * not what was waiting at the start), the default message sound plays and a desktop notice says it. Never what it is about.
   */
  private elsewhere(events: Happening[], announce: boolean): void {
    if (!events.length) return;
    for (const e of events) this.activity.mark(e.circle);
    if (!announce) return;
    if (!this.pushCovers()) this.sound.playDefault('message');
    for (const e of events) {
      this.notify('message', {
        title: tr('core.activityIn', 'Activity in {{ circle }}', { circle: circleLabel(e.circle) }),
        body: '',
        id: `activity-${e.id}`,
        go: `/?opencircle=${circleType(e.circle)}`, // a tap on the notice opens that circle
      });
    }
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
      this.ring('answer');
      this.notify('answer', {
        title: friend.status === 'confirmed' ? tr('core.acceptedYourFriendRequest', '{{ friendName }} accepted your friend request', { friendName: friend.name }) : tr('core.rejectedYourFriendRequest', '{{ friendName }} rejected your friend request', { friendName: friend.name }),
        body: '',
        id: `answer-${friend.id}-${friend.status}`, // one per answer
        go: '/',
      });
    }
    // gone from my list although I did not delete it (my own deletes are removed from the list at once): they ended it
    for (const [id, was] of before) {
      if (now.has(id)) continue;
      if (was.status === 'pending' && !was.incoming) {
        // my own request, still waiting, is gone: they rejected it (a rejection deletes my entry; the push has the same id)
        this.ring('answer');
        this.notify('answer', { title: tr('core.rejectedYourFriendRequest', '{{ friendName }} rejected your friend request', { friendName: was.name }), body: '', id: `answer-${id}-rejected`, go: '/' });
      } else {
        this.notify('answer', { title: tr('core.removedTheFriendship', '{{ wasName }} removed the friendship', { wasName: was.name }), body: tr('core.theConversationIsDeleted', 'The conversation is deleted for both of you.'), id: `removed-${id}`, go: '/' });
      }
    }
  }

  /**
   * In the Android app, while the app is NOT in view and push is on, the phone's own notification (with the chosen
   * jingle, sent by the backend) tells the person. The page must then stay quiet, or everything is announced twice.
   * In the browser, and in the app while it is in view, the page announces as usual.
   */
  private pushCovers(): boolean {
    return Capacitor.isNativePlatform() && this.push.enabled() && document.visibilityState !== 'visible';
  }

  /** Plays the sound chosen for this event, unless the phone's own notification does it. */
  private ring(event: 'message' | 'request' | 'answer'): void {
    if (!this.pushCovers()) this.sound.play(event);
  }

  /** A desktop notice (only when the tab is not in view and the person allowed it). The system adds no sound of its own when the app plays one. */
  private notify(event: 'message' | 'request' | 'answer', notice: { title: string; body: string; id: string; go: string }): void {
    if (this.pushCovers()) return;
    this.desktop.show({
      title: notice.title,
      body: notice.body,
      id: notice.id,
      silent: this.sound.choices()[event] !== 'none',
      go: notice.go,
    });
  }

  private onMessages(all: Added[], first: boolean): void {
    // a message of another circle: a note only (no sound of its own kind, no notice of what it says, no open feed). A friend on that circle's sleep list is silent, as in the circle in use.
    const elsewhere = all.filter((m) => circleOf(m.data) !== this.active.id);
    for (const m of elsewhere) this.activity.mark(circleOf(m.data));
    this.elsewhere(
      elsewhere
        .filter((m) => m.data['poke'] === true || !this.seen.get(`${circleOf(m.data)}/${String(m.data['connectionId'])}`)?.asleep)
        .map((m) => ({ circle: circleOf(m.data), id: `message-${m.id}` })),
      !first,
    );
    const added = all.filter((m) => circleOf(m.data) === this.active.id);
    if (!first) {
      // tell the open feed (the Chat page checks that the message is for its connection)
      for (const m of added) {
        const connectionId = m.data['connectionId'] as string | undefined;
        if (connectionId) this.latestMessage.set({ connectionId, messageId: m.id, seq: ++this.seq });
      }
      // a sound, unless I am reading that very conversation (I see the message arrive)
      // a friend on my sleep list is silent: no sound and no desktop notice, unless the message is a poke (it stays unread)
      const asleep = new Set(this.friends.sleeping().map((f) => f.id));
      const unseen = added.filter((m) => m.data['connectionId'] !== this.openFeed() && (m.data['poke'] === true || !asleep.has(m.data['connectionId'] as string)));
      if (unseen.length) this.ring('message');
      for (const m of unseen) {
        const connectionId = m.data['connectionId'] as string | undefined;
        const text = m.data['enc'] ? '🔒 New message' : String(m.data['text'] ?? ''); // a locked text is unreadable here: only the sender is named
        this.notify('message', {
          title: String(m.data['fromName'] ?? tr('core.newMessage', 'New message')),
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
