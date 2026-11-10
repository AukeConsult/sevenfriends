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
import { FriendDraft } from '../models';

const emptyDraft = (): FriendDraft => ({ name: '', email: '', phone: '', message: '' });

/**
 * A full page to add a friend: an email or a phone number. Somebody who has an account gets the request at once; for somebody who has
 * none the request is saved anyway (it waits for them), and the page shows the link to send them (it opens the welcome page).
 */
@Component({
  selector: 'app-add-friend',
  imports: [RouterLink, Clearable, TranslocoDirective],
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
  /** set when the person has no account yet: who it was for, and the link to send */
  protected readonly result = signal<{ to: string; link: string } | null>(null);

  /** what is made: a person (an email or a phone number) or a group (a name; the people come in later) */
  protected readonly mode = signal<'person' | 'group'>('person');
  protected readonly groupName = signal('');

  protected readonly draft = signal<FriendDraft>(emptyDraft());
  protected readonly sending = signal(false);
  protected readonly error = signal<string | null>(null);

  /** My own email or phone number (the same rule as on the server, which has the last word). */
  private isMe(email: string, phone: string): boolean {
    const me = this.user();
    const last8 = (value: string | null | undefined) => (value ?? '').replace(/\D/g, '').slice(-8);
    return (
      (!!email.trim() && email.trim().toLowerCase() === me?.email?.toLowerCase()) ||
      (last8(phone).length === 8 && last8(phone) === last8(me?.phoneNumber))
    );
  }

  /** "Add another" after a saved invitation. */
  protected another(): void {
    this.result.set(null);
    this.draft.set(emptyDraft());
  }

  protected setField(field: keyof FriendDraft, value: string): void {
    this.draft.update((d) => ({ ...d, [field]: value }));
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

  protected async send(): Promise<void> {
    const d = this.draft();
    if (this.sending()) return;

    const hasContact = [d.email, d.phone].some((v) => v.trim());
    if (!hasContact) {
      this.error.set(tr('addFriend.addAnEmailOr', 'Add an email or a phone number, so your {{ one }} can be found.', { one: this.w.one }));
      return;
    }

    if (this.isMe(d.email, d.phone)) {
      this.error.set(tr('addFriend.thatIsYouAdd', 'That is you. Add the email or phone number of a {{ one }}.', { one: this.w.one })); // the server refuses it too
      return;
    }

    // already on this list: say so, and send nothing (the server refuses it too)
    const digits = (v: string | null | undefined) => (v ?? '').replace(/\D/g, '').slice(-8);
    const same = this.friends.friends().find(
      (f) => f.status !== 'rejected' && ((d.email.trim() && f.email?.toLowerCase() === d.email.trim().toLowerCase()) || (digits(d.phone).length >= 8 && digits(f.phone) === digits(d.phone))),
    );
    if (same) {
      this.error.set(same.status === 'confirmed' ? tr('addFriend.isAlreadyYour', '{{ sameName }} is already your {{ one }}.', { sameName: same.name, one: this.w.one }) : tr('addFriend.youHaveAlreadyAdded', 'You have already added {{ sameName }}: the request waits for them.', { sameName: same.name }));
      return;
    }

    this.sending.set(true);
    this.error.set(null);
    try {
      const created = await this.friends.add({
        name: d.name,
        email: d.email || null,
        phone: d.phone || null,
        message: d.message.trim() || null,
      });
      if (created.invited || created.onApp) {
        if (this.embedded()) this.closed.emit(); // has an account: the request is with them already
        else await this.router.navigate([this.backTo], { queryParams: this.backParams });
      } else {
        await this.invite.load();
        this.result.set({ to: created.name || created.email || created.phone || tr('addFriend.thisPerson', 'This person'), link: this.link() });
      }
    } catch (err: any) {
      this.error.set(err.message ?? tr('addFriend.sendFailed', 'Could not send the request.'));
    } finally {
      this.sending.set(false);
    }
  }
}
