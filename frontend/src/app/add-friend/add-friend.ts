import { Clearable } from '../core/clearable';
import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { FriendsService } from '../core/friends.service';
import { InviteLinkService } from '../core/invite-link.service';
import { emptySocialDraft, socialsFromDraft } from '../core/social';
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
  private readonly friends = inject(FriendsService);
  private readonly router = inject(Router);
  protected readonly invite = inject(InviteLinkService);
  private readonly user = inject(AuthService).user;

  /** the link to send: the welcome page, which says who invited (my email or phone number, as in every friend link) */
  private readonly link = computed(() => {
    const me = this.user();
    const contact = me?.email ?? me?.phoneNumber;
    return `${location.origin}/welcome${contact ? `?friend=${encodeURIComponent(contact)}` : ''}`;
  });
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
      this.error.set('Add an email or a phone number, so your friend can be found.');
      return;
    }

    if (this.isMe(d.email, d.phone)) {
      this.error.set('That is you. Add the email or phone number of a friend.'); // the server refuses it too
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
        ...socialsFromDraft(emptySocialDraft()), // no social accounts are asked for here
      });
      if (created.invited) {
        await this.router.navigateByUrl('/friends'); // has an account: the request is with them already
      } else {
        this.result.set({ to: created.name || created.email || created.phone || 'This person', link: this.link() });
      }
    } catch (err: any) {
      this.error.set(err.message ?? 'Could not send the friend request');
    } finally {
      this.sending.set(false);
    }
  }
}
