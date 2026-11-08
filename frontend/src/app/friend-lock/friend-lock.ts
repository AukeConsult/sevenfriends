import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { SafeboxService } from '../core/safebox.service';
import { UiPreferencesService } from '../core/ui-preferences';
import { FriendContext } from '../friend-page/friend-context';
import { SafeboxItem } from '../models';

/**
 * Locking and keys with one friend (`/friends/:id/lock`, from the menu of the friend page): whether messages and files are locked, who has a key,
 * locking the files that were put in the safebox before there were keys, and under Advanced how locking works, the choice for new files and
 * messages, and the codes to check that the key is really the friend's. (It used to be the padlock frame of the safebox.)
 */
@Component({
  selector: 'app-friend-lock',
  imports: [RouterLink],
  templateUrl: './friend-lock.html',
})
export class FriendLock {
  protected readonly ctx = inject(FriendContext);
  private readonly service = inject(SafeboxService);
  protected readonly prefs = inject(UiPreferencesService);
  protected readonly keys = this.ctx.keysService;

  protected readonly friendName = computed(() => this.ctx.friend()?.name ?? 'your friend');
  /** the codes and the details are behind the Advanced button (the address can ask for them open: ?advanced) */
  protected readonly advanced = signal(inject(ActivatedRoute).snapshot.queryParamMap.has('advanced'));
  /** ticked (and remembered on this device): what I send is not locked even though both of us have a key */
  protected readonly plain = this.prefs.value('boxPlain');
  protected readonly canEncrypt = computed(() => this.ctx.keyStatus() === 'both');

  /** the files of the safebox that are not locked (null until the box is read) */
  private readonly items = signal<SafeboxItem[] | null>(null);
  protected readonly plainItems = computed(() => (this.items() ?? []).filter((item) => !item.enc));
  protected readonly encrypting = signal<{ done: number; total: number } | null>(null);
  protected readonly error = signal<string | null>(null);

  constructor() {
    void this.reload();
  }

  private async reload(): Promise<void> {
    try {
      this.items.set((await this.service.load(this.ctx.friendId)).items);
    } catch {
      this.items.set([]); // the box cannot be read: nothing to lock here
    }
  }

  /** Locks every unencrypted file of the box (one by one; it stops at the first one that fails and says which). */
  protected async encryptAll(): Promise<void> {
    if (!this.canEncrypt() || this.encrypting()) return;
    const files = this.plainItems();
    this.error.set(null);
    this.encrypting.set({ done: 0, total: files.length });
    try {
      for (const item of files) {
        try {
          await this.ctx.lockExisting(item);
        } catch (err: any) {
          this.error.set(`“${item.name}” could not be encrypted: ${err.message ?? 'something went wrong'}`);
          break;
        }
        this.encrypting.update((p) => p && { ...p, done: p.done + 1 });
      }
    } finally {
      this.encrypting.set(null);
      await this.reload();
    }
  }
}
