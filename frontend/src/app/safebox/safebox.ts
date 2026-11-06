import { DatePipe } from '@angular/common';
import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FriendsService } from '../core/friends.service';
import { formatBytes, prepareImage } from '../core/image';
import { SafeboxService } from '../core/safebox.service';
import { Safebox as SafeboxData, SafeboxItem } from '../models';

/** The small preview picture of an image in the box (only the preview is read, never the file; a file without one shows an icon instead). */
@Component({
  selector: 'app-safebox-thumb',
  template: `@if (src(); as url) { <img [src]="url" alt="" /> } @else { <span class="sf-box-wait" aria-hidden="true"></span> }`,
  host: { class: 'sf-box-thumb' },
})
export class SafeboxThumb {
  private readonly box = inject(SafeboxService);
  readonly friendId = input.required<string>();
  readonly item = input.required<SafeboxItem>();
  protected readonly src = signal<string | null>(null);

  constructor() {
    effect(() => {
      const item = this.item();
      this.src.set(null);
      if (!item.hasThumb) return; // never the whole file in the list: only the small preview
      this.box
        .file(this.friendId(), item.id, true)
        .then((file) => this.item() === item && this.src.set(file.url))
        .catch(() => undefined); // no picture: the empty frame stays
    });
  }
}

/**
 * The safebox of one friendship (`/friends/:id/safebox`): files, pictures and documents only you and this friend see. Both of you
 * can add, open, rename and delete. The files live on the server under the id of the friendship (nobody else reaches them) and
 * are deleted when the friendship ends.
 */
@Component({
  selector: 'app-safebox',
  imports: [DatePipe, RouterLink, SafeboxThumb],
  templateUrl: './safebox.html',
})
export class Safebox {
  private readonly service = inject(SafeboxService);
  private readonly friends = inject(FriendsService);

  protected readonly friendId = inject(ActivatedRoute).snapshot.paramMap.get('id') ?? '';
  protected readonly friendName = computed(() => this.friends.friends().find((f) => f.id === this.friendId)?.name ?? 'your friend');
  protected readonly box = signal<SafeboxData | null>(null);
  protected readonly loadError = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  /** the name of the file being added, while it is sent */
  protected readonly adding = signal<string | null>(null);
  protected readonly busy = signal(false);
  /** the file whose "take it out" question is open, and the one being renamed (with the new name) */
  protected readonly deleting = signal<string | null>(null);
  protected readonly renaming = signal<{ id: string; name: string } | null>(null);

  protected readonly items = computed(() => this.box()?.items ?? []);
  protected readonly used = computed(() => this.box()?.usedBytes ?? 0);
  protected readonly percent = computed(() => {
    const box = this.box();
    return box ? Math.min(100, Math.round((box.usedBytes / box.maxBytes) * 100)) : 0;
  });
  protected readonly formatBytes = formatBytes;

  constructor() {
    if (!this.friends.friends().length) void this.friends.load().catch(() => undefined); // for the friend's name
    void this.reload();
  }

  protected async reload(): Promise<void> {
    this.loadError.set(null);
    try {
      this.box.set(await this.service.load(this.friendId));
    } catch (err: any) {
      this.loadError.set(err.message ?? 'Could not open the safebox');
    }
  }

  /** Files chosen with the button: pictures are made smaller here (with a preview), everything else goes as it is. */
  protected async chosen(input: HTMLInputElement): Promise<void> {
    const files = Array.from(input.files ?? []);
    input.value = ''; // the same file can be chosen again
    this.error.set(null);
    const max = this.box()?.maxFileBytes ?? 0;
    for (const file of files) {
      this.adding.set(file.name);
      try {
        if (file.type.startsWith('image/')) await this.service.addImage(this.friendId, await prepareImage(file as File));
        else if (max && file.size > max) throw new Error(`“${file.name}” is too big (at most ${formatBytes(max)})`);
        else await this.service.add(this.friendId, file, file.name);
      } catch (err: any) {
        this.error.set(err.message ?? `Could not add “${file.name}”`);
        break;
      }
    }
    this.adding.set(null);
    await this.reload();
  }

  /** Saves the file under its own name. */
  protected async download(item: SafeboxItem): Promise<void> {
    this.error.set(null);
    this.busy.set(true);
    try {
      this.save((await this.service.file(this.friendId, item.id)).url, item.name);
    } catch (err: any) {
      this.error.set(err.message ?? 'Could not download the file');
    } finally {
      this.busy.set(false);
    }
  }

  private save(url: string, name: string): void {
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
  }

  protected startRename(item: SafeboxItem): void {
    this.deleting.set(null);
    this.renaming.set({ id: item.id, name: item.name });
  }

  protected async rename(): Promise<void> {
    const edit = this.renaming();
    if (!edit) return;
    const name = edit.name.trim();
    if (!name) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.service.rename(this.friendId, edit.id, name);
      this.renaming.set(null);
      await this.reload();
    } catch (err: any) {
      this.error.set(err.message ?? 'Could not rename the file');
    } finally {
      this.busy.set(false);
    }
  }

  protected async remove(item: SafeboxItem): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.service.remove(this.friendId, item.id);
      this.service.forget(this.friendId, item.id);
      this.deleting.set(null);
      await this.reload();
    } catch (err: any) {
      this.error.set(err.message ?? 'Could not take the file out');
    } finally {
      this.busy.set(false);
    }
  }

  /** What the file is, in a word, for people who read the list with a screen reader */
  protected kindLabel(item: SafeboxItem): string {
    return { image: 'Picture', video: 'Video', audio: 'Sound', document: 'Document' }[item.kind];
  }
}
