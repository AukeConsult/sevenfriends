import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Friend, FriendsService } from '../core/friends.service';
import { NotificationsService } from '../core/notifications.service';
import { SOCIAL_NETWORKS, SocialDraft, emptySocialDraft, socialsFromDraft } from '../core/social';

const MAX_FRIENDS = 7;

interface Slot {
  position: number;
  friend: Friend | null;
}

type Draft = { name: string; email: string; phone: string } & SocialDraft;
const emptyDraft = (): Draft => ({ name: '', email: '', phone: '', ...emptySocialDraft() });

@Component({
  selector: 'app-friends',
  imports: [RouterLink],
  templateUrl: './friends.html',
  styleUrl: './friends.scss',
})
export class Friends {
  private readonly friendsService = inject(FriendsService);
  private readonly notifications = inject(NotificationsService);

  protected readonly circle = this.friendsService.circle;
  protected readonly max = MAX_FRIENDS;
  protected readonly networks = SOCIAL_NETWORKS;
  /** incoming requests that wait for a free seat (shown on the Pending page) */
  protected readonly waiting = computed(() => this.friendsService.requests().filter((r) => !r.seated).length);
  protected readonly filled = computed(() => this.friendsService.friends().length);
  protected readonly slots = computed<Slot[]>(() =>
    Array.from({ length: MAX_FRIENDS }, (_, i) => ({
      position: i + 1,
      friend: this.friendsService.friends()[i] ?? null,
    })),
  );

  protected readonly loadError = signal<string | null>(null);
  protected readonly adding = signal(false);
  protected readonly saving = signal(false);
  protected readonly formError = signal<string | null>(null);
  protected readonly draft = signal<Draft>(emptyDraft());

  constructor() {
    this.reload();
  }

  protected async reload(): Promise<void> {
    this.loadError.set(null);
    await this.notifications.refresh(); // invited? a request gets a free seat as a pending friend
    try {
      await this.friendsService.load();
    } catch (err: any) {
      this.loadError.set(err.message);
    }
  }

  protected openForm(): void {
    this.draft.set(emptyDraft());
    this.formError.set(null);
    this.adding.set(true);
  }

  protected closeForm(): void {
    this.adding.set(false);
  }

  protected setField(field: keyof Draft, value: string): void {
    this.draft.update((d) => ({ ...d, [field]: value }));
  }

  protected async save(): Promise<void> {
    const d = this.draft();
    this.saving.set(true);
    this.formError.set(null);
    try {
      await this.friendsService.add({
        name: d.name,
        email: d.email || null,
        phone: d.phone || null,
        ...socialsFromDraft(d),
      });
      this.adding.set(false);
    } catch (err: any) {
      this.formError.set(err.message ?? 'Could not save friend');
    } finally {
      this.saving.set(false);
    }
  }

  /** Which friend's delete confirmation is open under its card (one at a time). */
  protected readonly deleting = signal<string | null>(null);
  protected readonly deleteBusy = signal(false);

  protected askDelete(friend: Friend): void {
    this.deleting.update((id) => (id === friend.id ? null : friend.id));
  }

  protected cancelDelete(): void {
    this.deleting.set(null);
  }

  protected deleteMessage(friend: Friend): string {
    return friend.invited || friend.incoming
      ? `Delete ${friend.name}? This removes the connection from your list and from theirs.`
      : `Remove ${friend.name} from your circle?`;
  }

  protected async remove(friend: Friend): Promise<void> {
    this.deleteBusy.set(true);
    try {
      await this.friendsService.remove(friend.id);
      this.deleting.set(null);
      await this.reload(); // a freed seat is given to the next waiting request
    } catch (err: any) {
      this.loadError.set(err.message);
    } finally {
      this.deleteBusy.set(false);
    }
  }

  /** Reject a friend who invited me: they will see the request as rejected. */
  protected async reject(friend: Friend): Promise<void> {
    if (!friend.requestId) return;
    try {
      await this.friendsService.rejectRequest(friend.requestId);
      await this.friendsService.load();
    } catch (err: any) {
      this.loadError.set(err.message);
    }
  }

  /** Confirm a friend who invited me (a pending seat). */
  protected async confirm(friend: Friend): Promise<void> {
    if (!friend.requestId) return;
    try {
      await this.friendsService.acceptRequest(friend.requestId);
      await this.friendsService.load();
    } catch (err: any) {
      this.loadError.set(err.message);
    }
  }
}
