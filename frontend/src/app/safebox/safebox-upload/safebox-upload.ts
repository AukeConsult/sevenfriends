import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { Location } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { SafeboxCapture } from '../safebox-capture/safebox-capture';
import { FriendsService } from '../../core/friends.service';
import { tr } from '../../core/i18n';
import { formatBytes, prepareImage } from '../../core/image';
import { SafeboxService } from '../../core/safebox.service';
import { UiPreferencesService } from '../../core/ui-preferences';
import { FriendContext } from '../../friend-page/friend-context';
import { BoxKeys, ChosenFile } from '../../models';

/**
 * Put files in the safebox (`/friends/:id/safebox/new/file`): choose or drop files (or take a photo), see the list, and Upload. Pictures are made smaller
 * here (with a preview); everything is locked on this device when both friends have a key (and the "plain" choice of the list page is off).
 * The files go one by one; the page shows how each is going and goes back to the list when all are in.
 */
@Component({
  selector: 'app-safebox-upload',
  imports: [RouterLink, SafeboxCapture, TranslocoDirective],
  templateUrl: './safebox-upload.html',
  providers: [provideTranslocoScope('safebox')],
})
export class SafeboxUpload {
  private readonly service = inject(SafeboxService);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly ctx = inject(FriendContext);
  private readonly friends = inject(FriendsService);
  private readonly prefs = inject(UiPreferencesService);

  protected readonly friendId = inject(ActivatedRoute).snapshot.paramMap.get('id') ?? '';
  protected readonly friendName = computed(() => this.friends.friends().find((f) => f.id === this.friendId)?.name ?? tr('safebox.common.yourFriend', 'your friend'));
  protected readonly list = ['/friends', this.friendId, 'safebox'];
  /** the item the new files are to be linked with ("Add a new item and link it"), taken when the page opens */
  private readonly linkTo = this.service.takeLinkFrom();
  /** where Cancel, the title and a finished upload go: the item the files were made for, otherwise the list */
  protected readonly leave = this.linkTo ? (this.service.openPath(this.friendId, this.linkTo) ?? this.list) : this.list;
  protected readonly formatBytes = formatBytes;

  protected readonly chosen = signal<ChosenFile[]>([]);
  protected readonly busy = signal(false);
  protected readonly over = signal(false);
  protected readonly keyStatus = this.ctx.keyStatus;
  /** the files are locked when both of us have a key and the "plain" choice is off */
  protected readonly locked = computed(() => this.keyStatus() === 'both' && !this.prefs.value('boxPlain')());
  protected readonly waiting = computed(() => this.chosen().filter((c) => c.state === 'waiting' || c.state === 'failed').length);

  constructor() {
    if (!this.friends.friends().length) void this.friends.load().catch(() => undefined); // for the friend's name
  }

  private keys(): BoxKeys | null {
    return this.locked() ? this.ctx.boxKeys() : null;
  }

  protected readonly cameraError = signal<string | null>(null);

  protected captured(file: File): void {
    this.cameraError.set(null);
    this.add([file]);
  }

  /** Away from this page: one step back in the history (the list, or the item the files were made for); opened directly: `leave`. */
  protected leaveNow(event?: Event): void {
    event?.preventDefault();
    if ((history.state?.navigationId ?? 1) > 1) this.location.back();
    else void this.router.navigate(this.leave, { replaceUrl: true });
  }

  protected pick(input: HTMLInputElement): void {
    this.add(Array.from(input.files ?? []));
    input.value = ''; // the same file can be chosen again
  }

  protected dragOver(event: DragEvent): void {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault(); // allows the drop
    this.over.set(true);
  }

  protected dropped(event: DragEvent): void {
    event.preventDefault();
    this.over.set(false);
    if (!this.busy()) this.add(Array.from(event.dataTransfer?.files ?? []));
  }

  private add(files: File[]): void {
    this.chosen.update((list) => [...list, ...files.map((file) => ({ file, state: 'waiting' as const }))]);
  }

  protected drop(index: number): void {
    this.chosen.update((list) => list.filter((_, i) => i !== index));
  }

  /** Sends the files that are not in yet, one by one. A file that fails stays in the list with the reason, and the others go on. */
  protected async upload(): Promise<void> {
    if (this.busy() || !this.waiting()) return;
    this.busy.set(true);
    const keys = this.keys();
    const files = this.chosen();
    for (let i = 0; i < files.length; i++) {
      if (files[i].state === 'done') continue;
      this.mark(i, { state: 'sending', error: undefined });
      try {
        const file = files[i].file;
        const made = file.type.startsWith('image/') ? await this.service.addImage(this.friendId, await prepareImage(file), keys) : await this.service.add(this.friendId, file, file.name, undefined, keys);
        if (this.linkTo && keys) await this.service.addLink(this.friendId, this.linkTo, made.id, keys).catch(() => undefined); // made from "Add a new item and link it"
        this.mark(i, { state: 'done' });
      } catch (err: any) {
        this.mark(i, { state: 'failed', error: err?.message ?? tr('safebox.upload.couldNotAdd', 'Could not add this file') });
      }
    }
    this.busy.set(false);
    if (this.chosen().every((c) => c.state === 'done')) {
      this.prefs.set('boxHidden', this.prefs.value('boxHidden')().filter((k) => k !== 'file')); // files are shown again
      this.leaveNow();
    }
  }

  private mark(index: number, change: Partial<ChosenFile>): void {
    this.chosen.update((list) => list.map((c, i) => (i === index ? { ...c, ...change } : c)));
  }
}
