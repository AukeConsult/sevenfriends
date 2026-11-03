import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FriendsService } from '../core/friends.service';
import { emptySocialDraft, socialsFromDraft } from '../core/social';
import { FriendDraft } from '../models';

const emptyDraft = (): FriendDraft => ({ name: '', email: '', phone: '', message: '' });

/** A full page to add a friend: a form that ends with Cancel or Send friend request. */
@Component({
  selector: 'app-add-friend',
  imports: [RouterLink],
  templateUrl: './add-friend.html',
})
export class AddFriend {
  private readonly friends = inject(FriendsService);
  private readonly router = inject(Router);

  protected readonly draft = signal<FriendDraft>(emptyDraft());
  protected readonly sending = signal(false);
  protected readonly error = signal<string | null>(null);

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

    this.sending.set(true);
    this.error.set(null);
    try {
      const added = await this.friends.add({
        name: d.name,
        email: d.email || null,
        phone: d.phone || null,
        message: d.message.trim() || null,
        ...socialsFromDraft(emptySocialDraft()), // no social accounts are asked for here
      });
      // nobody has an account for this email / phone yet: confirm the address first, then invite them
      await this.router.navigateByUrl(added.invite ? `/friends/${added.id}/invite` : '/friends');
    } catch (err: any) {
      this.error.set(err.message ?? 'Could not send the friend request');
    } finally {
      this.sending.set(false);
    }
  }
}
