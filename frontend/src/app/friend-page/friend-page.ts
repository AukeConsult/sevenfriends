import { KeyChangedBand } from '../key-changed-band/key-changed-band';
import { LockChainBand } from '../lock-chain-band/lock-chain-band';
import { LockedBand } from '../locked-band/locked-band';
import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { computed, Component, DestroyRef, ElementRef, HostListener, effect, inject, untracked, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { moodIcon, moodLabel } from '../core/moods';
import { MyAvatarService } from '../core/my-avatar.service';
import { ApiService } from '../core/api.service';
import { UiPreferencesService } from '../core/ui-preferences';
import { profileColorHex, profileColorInk, profileColorSoft } from '../models';
import { presenceLabel } from '../core/presence';
import { possessive } from '../core/pronoun';
import { RealtimeService } from '../core/realtime.service';
import { FriendAvatar } from '../friend-avatar/friend-avatar';
import { FriendSend } from '../friend-send/friend-send';
import { FeedHelp } from '../friend-help/friend-help';
import { FriendContext } from './friend-context';

/**
 * The page of one friend: /friends/:id. The header stays (the friend, the padlock, the menu, the profile and the lock frame); what is under it changes with the
 * two icons in the header: the messages (the feed), or the safebox with this friend. Everything the header and the pages share is in `FriendContext`.
 */
@Component({
  selector: 'app-friend-page',
  imports: [FeedHelp, FriendSend, KeyChangedBand, LockChainBand, LockedBand, FriendAvatar, RouterLink, RouterLinkActive, RouterOutlet, TranslocoDirective],
  providers: [provideTranslocoScope('friendPage'), FriendContext],
  templateUrl: './friend-page.html',
  // every page under the header has the look of the conversation: a light tint of the friend's colour, and my own colour for what is mine
  host: {
    class: 'd-block sf-friend-page',
    '[class.sf-feed-tinted]': '!!feedBackground()',
    '[style.--sf-feed-bg]': 'feedBackground()',
    '[style.--sf-friend]': 'ctx.friendColor()',
    '[style.--sf-friend-ink]': 'ctx.friendInk()',
    '[style.--sf-my]': 'myColor()',
    '[style.--sf-my-ink]': 'myInk()',
  }, // the header sticks to the top of this block
})
export class FriendPage {
  protected readonly ctx = inject(FriendContext);
  private readonly realtime = inject(RealtimeService);
  private readonly myAvatar = inject(MyAvatarService);
  private readonly prefs = inject(UiPreferencesService);
  protected readonly feedBackground = computed(() => profileColorSoft(this.ctx.friend()?.color));
  protected readonly myColor = computed(() => profileColorHex(this.myAvatar.color()));
  protected readonly myInk = computed(() => profileColorInk(this.myAvatar.color()));
  private readonly router = inject(Router);
  /** the pages that can have the Send form on top of them */
  protected readonly sendOver = computed(() => this.onFeed() || this.onSafebox());
  /** the feed is oldest first (newest at the bottom): the Send form is at the bottom too, otherwise under the header */
  protected readonly sendAtBottom = computed(() => this.onFeed() && !this.ctx.feed()?.sortDesc());
  private readonly bar = viewChild<ElementRef<HTMLElement>>('bar');
  private sendRedirect = false; // the feed was opened from /send: its Send form starts open
  private lastLive = this.realtime.latestMessage()?.seq ?? 0; // live messages before this page opened are not news

  protected readonly presenceLabel = presenceLabel;
  protected readonly moodIcon = moodIcon;
  protected readonly possessive = possessive;
  protected readonly moodLabel = moodLabel;

  /** the address now: the feed is `/friends/<id>`, anything longer (the safebox) is another page */
  private readonly url = toSignal(this.router.events.pipe(filter((e) => e instanceof NavigationEnd), map(() => this.router.url.split(/[?#]/)[0])), { initialValue: this.router.url.split(/[?#]/)[0] });
  /** the menu has no item for the page you are already on */
  protected readonly onSafebox = computed(() => this.url().startsWith(`/friends/${this.ctx.friendId}/safebox`));
  protected readonly onFeed = computed(() => this.url().replace(/\/$/, '') === `/friends/${this.ctx.friendId}`);
  protected readonly onSend = computed(() => this.url().startsWith(`/friends/${this.ctx.friendId}/send`));
  protected readonly onProfile = computed(() => this.url().startsWith(`/friends/${this.ctx.friendId}/profile`));
  protected readonly onRecovery = computed(() => this.url().startsWith(`/friends/${this.ctx.friendId}/recovery`));
  protected readonly onLock = computed(() => this.url().startsWith(`/friends/${this.ctx.friendId}/lock`));

  constructor() {
    void inject(ApiService).request('/health').catch(() => undefined); // wakes the server when a friend is opened: the first message is not slow
    // new messages from this friend come to this page (the feed, or the dot while the safebox is open), not to the Home list
    this.realtime.openFeed.set(this.ctx.friendId);
    if (this.prefs.get('feedIcons')) void this.myAvatar.load(); // my colour, for what is mine on every page under the header
    inject(DestroyRef).onDestroy(() => {
      if (this.realtime.openFeed() === this.ctx.friendId) this.realtime.openFeed.set(null);
    });

    // a message arrived while the safebox is open: a dot on the Messages icon until the feed is opened
    effect(() => {
      const onFeed = this.onFeed();
      const live = this.realtime.latestMessage();
      untracked(() => {
        if (onFeed) {
          this.ctx.messageDot.set(false);
          if (live) this.lastLive = live.seq;
        } else if (live && live.seq > this.lastLive) {
          this.lastLive = live.seq;
          if (live.connectionId === this.ctx.friendId) this.ctx.messageDot.set(true);
        }
      });
    });

    // moving to another page of the friend closes the help (the Send form is independent of the pages: it stays as it is)
    effect(() => {
      this.url();
      untracked(() => {
        this.ctx.helpOpen.set(false);
        if (this.sendRedirect) this.ctx.feedSendOpen.set(true); // opened from /send; otherwise the Send form keeps its state from page to page
        this.sendRedirect = false;
      });
    });

    // the Send page is the feed with the Send form open on top of it: the address /send goes to the feed and opens the form
    effect(() => {
      if (!this.onSend()) return;
      untracked(() => {
        this.sendRedirect = true;
        void this.router.navigate(['/friends', this.ctx.friendId], { replaceUrl: true });
      });
    });

    // the header's height (it changes with the notch and the font size)
    effect((onCleanup) => {
      const header = this.bar()?.nativeElement;
      if (!header) return;
      const watch = new ResizeObserver(() => this.ctx.barHeight.set(header.offsetHeight));
      watch.observe(header);
      onCleanup(() => watch.disconnect());
    });
  }

  /** On the Send page a tap on the Send icon shows or hides the writing form; on any other page it opens the Send page (form shown). */
  protected toggleSendForm(event: Event): void {
    if (this.onFeed() || this.onSafebox()) { // over the feed or the safebox: the form opens on top of it, the same icon closes it
      event.preventDefault();
      this.ctx.feedSendOpen.update((open) => !open);
      if (this.ctx.feedSendOpen()) window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    if (!this.onSend()) { this.ctx.sendFormOpen.set(true); return; }
    event.preventDefault();
    this.ctx.sendFormOpen.update((open) => !open);
  }

  @HostListener('document:click', ['$event'])
  protected onDocumentClick(event: Event): void {
    const target = event.target as Element | null;
    if (this.ctx.moreOpen() && !target?.closest('.sf-more')) this.ctx.moreOpen.set(false);
    if (this.ctx.helpOpen() && !target?.closest('.sf-help, [aria-controls="feed-help"]')) this.ctx.helpOpen.set(false); // a click anywhere else closes the help
  }
}
