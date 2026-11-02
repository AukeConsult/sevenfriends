import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FriendsService } from '../core/friends.service';
import { SOCIAL_NETWORKS, emptySocialDraft, socialsFromDraft } from '../core/social';
import { FriendDraft } from '../models';

const emptyDraft = (): FriendDraft => ({ name: '', email: '', phone: '', ...emptySocialDraft() });

/** A full page to add a friend: a form that ends with Cancel or Send friend request. */
@Component({
  selector: 'app-add-friend',
  imports: [RouterLink],
  templateUrl: './add-friend.html',
  styleUrl: './add-friend.scss',
})
export class AddFriend {
  private readonly friends = inject(FriendsService);
  private readonly router = inject(Router);

  protected readonly networks = SOCIAL_NETWORKS;
  protected readonly draft = signal<FriendDraft>(emptyDraft());
  protected readonly sending = signal(false);
  protected readonly error = signal<string | null>(null);

  protected setField(field: keyof FriendDraft, value: string): void {
    this.draft.update((d) => ({ ...d, [field]: value }));
  }

  protected async send(): Promise<void> {
    const d = this.draft();
    if (this.sending()) return;

    if (!d.name.trim()) {
      this.error.set('Write the name of your friend.');
      return;
    }
    const hasContact = [d.email, d.phone].some((v) => v.trim());
    if (!hasContact) {
      this.error.set('Add an email or a phone number, so your friend can be found.');
      return;
    }

    this.sending.set(true);
    this.error.set(null);
    try {
      await this.friends.add({
        name: d.name,
        email: d.email || null,
        phone: d.phone || null,
        ...socialsFromDraft(d),
      });
      await this.router.navigateByUrl('/friends'); // back to the list, where the new friend shows as pending
    } catch (err: any) {
      this.error.set(err.message ?? 'Could not send the friend request');
    } finally {
      this.sending.set(false);
    }
  }
}
