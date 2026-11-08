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
  imports: [RouterLink, Clearable],
  templateUrl: './add-friend.html',
})
export class AddFriend {
  private readonly circle = inject(ActiveCircleService);
  protected readonly w = this.circle.words;
  private readonly circleType = this.circle.type;
  /** shown inside Home (under its top, in place of everything else) instead of as a page of its own: Cancel and Done tell Home to close it */
  readonly embedded = input(false);
  readonly closed = output<void>();
  private readonly friends = inject(FriendsService);
  private readonly router = inject(Router);
  /** opened from the setup wizard: Done, Cancel and a friend with an account go on to the wizard's last step instead of the friends page */
  private readonly fromSetup = inject(ActivatedRoute).snapshot.queryParamMap.has('setup');
  protected readonly backTo = this.fromSetup ? '/setup' : '/';
  protected readonly backParams = this.fromSetup ? { step: 'install' } : null;
  protected readonly invite = inject(InviteLinkService);
  private readonly user = inject(AuthService).user;

  /** the link to send: the welcome page of the circle with my invite code (never my email address or phone number) */
  private readonly link = computed(() => this.invite.link() ?? circleLink(this.circleType, ''));
  /** set when the person has no account yet: who it was for, and the link to send */
  protected readonly result = signal<{ to: string; link: string } | null>(null);

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

  protected async send(): Promise<void> {
    const d = this.draft();
    if (this.sending()) return;

    const hasContact = [d.email, d.phone].some((v) => v.trim());
    if (!hasContact) {
      this.error.set('Add an email or a phone number, so your ' + this.w.one + ' can be found.');
      return;
    }

    if (this.isMe(d.email, d.phone)) {
      this.error.set('That is you. Add the email or phone number of a ' + this.w.one + '.'); // the server refuses it too
      return;
    }

    // already on this list: say so, and send nothing (the server refuses it too)
    const digits = (v: string | null | undefined) => (v ?? '').replace(/\D/g, '').slice(-8);
    const same = this.friends.friends().find(
      (f) => f.status !== 'rejected' && ((d.email.trim() && f.email?.toLowerCase() === d.email.trim().toLowerCase()) || (digits(d.phone).length >= 8 && digits(f.phone) === digits(d.phone))),
    );
    if (same) {
      this.error.set(same.status === 'confirmed' ? `${same.name} is already your ${this.w.one}.` : `You have already added ${same.name}: the request waits for them.`);
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
        this.result.set({ to: created.name || created.email || created.phone || 'This person', link: this.link() });
      }
    } catch (err: any) {
      this.error.set(err.message ?? 'Could not send the ' + this.w.one + ' request');
    } finally {
      this.sending.set(false);
    }
  }
}
