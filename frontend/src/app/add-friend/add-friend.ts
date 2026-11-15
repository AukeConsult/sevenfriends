import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { tr } from '../core/i18n';
import { circleLink } from '../core/friend-link.service';
import { Clearable } from '../core/clearable';
import { ActiveCircleService } from '../core/active-circle.service';
import { Component, computed, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { debounceTime, from, switchMap, tap } from 'rxjs';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { FriendsService } from '../core/friends.service';
import { InviteLinkService } from '../core/invite-link.service';
import { ApiError } from '../core/api.service';
import { isValidPhone } from '../core/countries';
import { Friend } from '../models';
import { PageBar } from '../page-bar/page-bar';
import { InviteFriendState } from '../invite-friend/invite-friend';

/**
 * A full page to add a friend. Two ways, both on the page from the start: find somebody who is on the app by an email or a phone number (the request is sent at
 * once), or, when nobody is found, the invitation page (`invite-friend/`) opens AT ONCE: there the person decides to send the link, which also saves the invitation for an email
 * (it waits, and shows as soon as that person signs up or logs on with the email); a phone number nobody has saves nothing (only the link goes out).
 */
@Component({
  selector: 'app-add-friend',
  imports: [PageBar, RouterLink, Clearable, TranslocoDirective],
  templateUrl: './add-friend.html',
  providers: [provideTranslocoScope('addFriend')],
})
export class AddFriend {
  private readonly circle = inject(ActiveCircleService);
  protected readonly w = this.circle.words;
  private get circleType(): string { return this.circle.type; }
  /** shown inside Home (under its top, in place of everything else) instead of as a page of its own: Cancel and Done tell Home to close it */
  readonly embedded = input(false);
  readonly closed = output<void>();
  private readonly friends = inject(FriendsService);
  private readonly router = inject(Router);
  /** opened from the setup wizard: Done, Cancel and a friend with an account go on to the wizard's last step instead of the friends page */
  private readonly fromSetup = inject(ActivatedRoute).snapshot.queryParamMap.has('setup');
  protected readonly backTo = this.fromSetup ? '/setup' : '/';
  protected readonly backParams = this.fromSetup ? { step: 'friend' } : null;
  protected readonly invite = inject(InviteLinkService);
  private readonly user = inject(AuthService).user;

  /** the link to send: the welcome page of the circle with my invite code (never my email address or phone number) */
  private readonly link = computed(() => this.invite.link() ?? circleLink(this.circleType, ''));
  /** what is made: a person (an email or a phone number) or a group (a name; the people come in later) */
  protected readonly mode = signal<'person' | 'group'>('person');
  protected readonly groupName = signal('');

  /** what was typed: an email or a phone number */
  protected readonly query = signal('');
  protected readonly sending = signal(false);
  protected readonly error = signal<string | null>(null);
  /**
   * What is known about what was typed, while it is typed (asked a moment after the last key, and only when it is a complete email or phone number):
   * 'checking', 'found' (somebody is on the app), 'none', 'note' (my own address, or somebody already on my list: `lookupText` says which), 'limit' (too many searches)
   */
  protected readonly lookup = signal<'idle' | 'checking' | 'found' | 'none' | 'note' | 'limit'>('idle');
  protected readonly lookupText = signal('');
  /** the answers already got in this visit (a value that is typed again is not asked again: every look counts as a search) */
  private readonly looked = new Map<string, 'found' | 'none'>();

  /** My own email or phone number (the same rule as on the server, which has the last word). */
  private isMe(email: string, phone: string): boolean {
    const me = this.user();
    const last8 = (value: string | null | undefined) => (value ?? '').replace(/\D/g, '').slice(-8);
    return (
      (!!email.trim() && email.trim().toLowerCase() === me?.email?.toLowerCase()) ||
      (last8(phone).length === 8 && last8(phone) === last8(me?.phoneNumber))
    );
  }

  constructor() {
    void this.invite.load(); // the link is ready when it is tapped
    // what was typed is looked up a moment after the last key: somebody is on the app, or not
    toObservable(this.query)
      .pipe(
        tap(() => this.lookup.set('idle')),
        debounceTime(700),
        switchMap((value) => from(this.check(value))), // a look that is overtaken by the next key is dropped
        takeUntilDestroyed(),
      )
      .subscribe((state) => {
        this.lookup.set(state);
        if (state === 'none') this.openInvitePage(); // nobody has it: the invitation page opens at once, and there the person decides to send the link (and so save the invitation)
      });
  }

  /** Somebody on my list with this email or phone number (the same rule as on the server, which has the last word). */
  private sameFriend(email: string, phone: string): Friend | undefined {
    const digits = (v: string | null | undefined) => (v ?? '').replace(/\D/g, '').slice(-8);
    return this.friends.friends().find(
      (f) => f.status !== 'rejected' && ((email && f.email?.toLowerCase() === email.toLowerCase()) || (digits(phone).length >= 8 && digits(f.phone) === digits(phone))),
    );
  }

  /** The state to show for what was typed: nothing is asked until it is a complete email address or a phone number. */
  private async check(raw: string): Promise<'idle' | 'checking' | 'found' | 'none' | 'note' | 'limit'> {
    const value = raw.trim();
    if (this.mode() !== 'person' || !value) return 'idle';
    const email = value.includes('@') ? value : '';
    const phone = value.includes('@') ? '' : value;
    const complete = email ? /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) : phone.replace(/\D/g, '').length >= 8 && isValidPhone(phone);
    if (!complete) return 'idle';
    if (this.isMe(email, phone)) {
      this.lookupText.set(tr('addFriend.thatIsYouAdd', 'That is you. Add the email or phone number of a {{ one }}.', { one: this.w.one }));
      return 'note';
    }
    const same = this.sameFriend(email, phone);
    if (same) {
      this.lookupText.set(same.status === 'confirmed' ? tr('addFriend.isAlreadyYour', '{{ sameName }} is already your {{ one }}.', { sameName: same.name, one: this.w.one }) : tr('addFriend.youHaveAlreadyAdded', 'You have already added {{ sameName }}: the request waits for them.', { sameName: same.name }));
      return 'note';
    }
    const key = this.keyOf(email, phone);
    const known = this.looked.get(key);
    if (known) return known;
    this.lookup.set('checking');
    try {
      const status = await this.friends.lookup(email || null, phone || null);
      if (status !== 'found' && status !== 'none') return 'idle';
      this.looked.set(key, status);
      return status;
    } catch (err) {
      return err instanceof ApiError && err.status === 429 ? 'limit' : 'idle'; // any other failure: nothing is said (sending the request still tells)
    }
  }

  /** Opens the invitation page for what was typed (nobody on the app has it). */
  private openInvitePage(): void {
    const to = this.query().trim();
    if (!to || this.mode() !== 'person') return;
    void this.router.navigate(['/friends/add/invite'], { state: { to, back: this.backTo, params: this.backParams } satisfies InviteFriendState });
  }

  /** What a look is remembered by: the email, or the last 8 digits of the phone number. */
  private keyOf(email: string, phone: string): string {
    return email ? email.toLowerCase() : phone.replace(/\D/g, '').slice(-8);
  }

  protected shareLink(): void {
    void this.invite.share(this.link());
  }

  protected copyLink(): void {
    void this.invite.copy(this.link());
  }

  /** Make the group: it is a friend entry of mine, and its conversation opens. */
  protected async makeGroup(): Promise<void> {
    const name = this.groupName().trim();
    if (this.sending()) return;
    if (!name) {
      this.error.set(tr('addFriend.giveTheGroupA', 'Give the group a name.'));
      return;
    }
    this.sending.set(true);
    this.error.set(null);
    try {
      const id = await this.friends.addGroup(name);
      if (this.embedded()) this.closed.emit();
      else await this.router.navigate(['/friends', id]);
    } catch (err: any) {
      this.error.set(err.message ?? tr('addFriend.couldNotMakeThe', 'Could not make the group.'));
    } finally {
      this.sending.set(false);
    }
  }

  /** Leaves the page: the request or the invitation is with them. */
  protected async done(): Promise<void> {
    if (this.embedded()) this.closed.emit();
    else await this.router.navigate([this.backTo], { queryParams: this.backParams });
  }

  /** Find somebody on the app by what was typed and send the request. Nobody found: an email can be saved as an invitation (a second tap, on "Send invitation"), a phone number saves nothing. */
  protected async send(): Promise<void> {
    const value = this.query().trim();
    if (this.sending()) return;

    if (!value) {
      this.error.set(tr('addFriend.addAnEmailOr', 'Add an email or a phone number, so your {{ one }} can be found.', { one: this.w.one }));
      return;
    }
    const email = value.includes('@') ? value : '';
    const phone = value.includes('@') ? '' : value;

    if (this.isMe(email, phone)) {
      this.error.set(tr('addFriend.thatIsYouAdd', 'That is you. Add the email or phone number of a {{ one }}.', { one: this.w.one })); // the server refuses it too
      return;
    }

    // already on this list: say so, and send nothing (the server refuses it too)
    const same = this.sameFriend(email, phone);
    if (same) {
      this.error.set(same.status === 'confirmed' ? tr('addFriend.isAlreadyYour', '{{ sameName }} is already your {{ one }}.', { sameName: same.name, one: this.w.one }) : tr('addFriend.youHaveAlreadyAdded', 'You have already added {{ sameName }}: the request waits for them.', { sameName: same.name }));
      return;
    }

    this.sending.set(true);
    this.error.set(null);
    try {
      await this.friends.add({ name: '', email: email || null, phone: phone || null, message: null, onlyIfOnApp: true });
      await this.done(); // the request is with them
    } catch (err: any) {
      if (err instanceof ApiError && err.status === 422) {
        // nobody has it (the person tapped before the look was done): the invitation page opens, as it does after the look
        this.looked.set(this.keyOf(email, phone), 'none');
        this.lookup.set('none');
        this.openInvitePage();
      } else this.error.set(err.message ?? tr('addFriend.sendFailed', 'Could not send the request.'));
    } finally {
      this.sending.set(false);
    }
  }
}
