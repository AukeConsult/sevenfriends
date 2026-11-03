import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FriendsService } from '../core/friends.service';

/**
 * A full page between adding a friend who has no account yet and sending the invitation:
 * check the address (a wrong one would send your message to a stranger), then send it by email.
 */
@Component({
  selector: 'app-invite-friend',
  imports: [RouterLink],
  templateUrl: './invite-friend.html',
})
export class InviteFriend {
  private readonly friends = inject(FriendsService);
  private readonly router = inject(Router);
  private readonly id = inject(ActivatedRoute).snapshot.paramMap.get('id') ?? '';

  protected readonly loaded = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly friend = computed(() => this.friends.friends().find((f) => f.id === this.id) ?? null);

  constructor() {
    void this.start();
  }

  private async start(): Promise<void> {
    try {
      if (!this.friend()) await this.friends.load(); // opened directly (a reload): fetch the list
    } catch (err: any) {
      this.error.set(err.message ?? 'Could not load your friends');
    }
    const friend = this.friend();
    if (!friend || !friend.invite) {
      await this.router.navigateByUrl('/friends'); // nothing to invite (already on Seven Friends, or gone)
      return;
    }
    this.loaded.set(true);
  }

  protected async send(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.friends.sendInvite(this.id);
      await this.router.navigateByUrl('/friends');
    } catch (err: any) {
      this.error.set(err.message ?? 'Could not send the invitation');
      this.busy.set(false);
    }
  }

  /** The address is wrong: remove this friend and start again. */
  protected async wrongAddress(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      await this.friends.remove(this.id);
      await this.router.navigateByUrl('/friends/add');
    } catch (err: any) {
      this.error.set(err.message ?? 'Could not remove this friend');
      this.busy.set(false);
    }
  }
}
