import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { tr } from '../core/i18n';
import { circleLink } from '../core/friend-link.service';
import { Clearable } from '../core/clearable';
import { ActiveCircleService } from '../core/active-circle.service';
import { Component, computed, inject, input, output, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { FriendsService } from '../core/friends.service';
import { InviteLinkService } from '../core/invite-link.service';
import { ApiError } from '../core/api.service';
import { PageBar } from '../page-bar/page-bar';

/**
 * A full page to add a friend. Two ways, both on the page from the start: find somebody who is on the app by an email or a phone number (the request is sent at
 * once; when nobody is found nothing is saved), or send a link to somebody who is not (nothing is saved until they sign up with it).
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
  /** nobody with what was typed is on the app: the invite link under it is what to use */
  protected readonly notFound = signal(false);

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

  /** Find somebody on the app by what was typed and send the request. Nobody found: nothing is saved. */
  protected async send(): Promise<void> {
    const value = this.query().trim();
    if (this.sending()) return;
    this.notFound.set(false);

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
    const digits = (v: string | null | undefined) => (v ?? '').replace(/\D/g, '').slice(-8);
    const same = this.friends.friends().find(
      (f) => f.status !== 'rejected' && ((email && f.email?.toLowerCase() === email.toLowerCase()) || (digits(phone).length >= 8 && digits(f.phone) === digits(phone))),
    );
    if (same) {
      this.error.set(same.status === 'confirmed' ? tr('addFriend.isAlreadyYour', '{{ sameName }} is already your {{ one }}.', { sameName: same.name, one: this.w.one }) : tr('addFriend.youHaveAlreadyAdded', 'You have already added {{ sameName }}: the request waits for them.', { sameName: same.name }));
      return;
    }

    this.sending.set(true);
    this.error.set(null);
    try {
      await this.friends.add({ name: '', email: email || null, phone: phone || null, message: null, onlyIfOnApp: true });
      if (this.embedded()) this.closed.emit(); // the request is with them
      else await this.router.navigate([this.backTo], { queryParams: this.backParams });
    } catch (err: any) {
      if (err instanceof ApiError && err.status === 422) this.notFound.set(true);
      else this.error.set(err.message ?? tr('addFriend.sendFailed', 'Could not send the request.'));
    } finally {
      this.sending.set(false);
    }
  }
}
