import { DatePipe } from '@angular/common';
import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FriendsService } from '../core/friends.service';
import { KeysService } from '../core/keys.service';
import { formatBytes, prepareImage } from '../core/image';
import { SafeboxService } from '../core/safebox.service';
import { UiPreferencesService } from '../core/ui-preferences';
import { ApiError } from '../core/api.service';
import { BoxKeys, Safebox as SafeboxData, SafeboxItem, keyIdOf } from '../models';

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
  protected readonly keys = inject(KeysService);
  protected readonly prefs = inject(UiPreferencesService);

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

  /** the keys in use of me and of my friend, as the server lists them (null until asked) */
  private readonly boxKeys = signal<BoxKeys | null>(null);
  /**
   * Who has an encryption key: 'checking' (not known yet), 'both' (files can be stored encrypted), 'me' (only my friend has one),
   * 'friend' (only I have one) or 'none'. Files are stored encrypted only on 'both'; otherwise they are stored as before.
   */
  protected readonly keyStatus = computed<'checking' | 'both' | 'me' | 'friend' | 'none'>(() => {
    const box = this.boxKeys();
    const state = this.keys.state();
    if (!box || state === 'checking') return 'checking';
    const mine = state === 'ready' && box.mine.some((k) => k.id === this.keys.thisKeyId());
    const friend = box.friend.length > 0;
    return mine && friend ? 'both' : friend ? 'me' : mine ? 'friend' : 'none';
  });
  /** who has a key: me (on this device) and my friend (on any device); null while it is not known */
  protected readonly meHasKey = computed(() => (this.keyStatus() === 'checking' ? null : this.keyStatus() === 'both' || this.keyStatus() === 'friend'));
  protected readonly friendHasKey = computed(() => (this.keyStatus() === 'checking' ? null : this.keyStatus() === 'both' || this.keyStatus() === 'me'));
  /** files are stored encrypted (both of us have a key) */
  protected readonly canEncrypt = computed(() => this.keyStatus() === 'both');
  /** ticked on the page (and remembered on this device): the files added now are stored unencrypted even though both of us have a key */
  protected readonly plain = this.prefs.value('boxPlain');
  /** the keys to lock a new file for, or null (then it is stored as before) */
  private encryptWith(): BoxKeys | null {
    return this.canEncrypt() && !this.plain() ? this.boxKeys() : null;
  }

  constructor() {
    if (!this.friends.friends().length) void this.friends.load().catch(() => undefined); // for the friend's name
    void this.keys.refresh(); // is there a key for me on this device?
    void this.service.keys(this.friendId).then((keys) => this.boxKeys.set(keys)).catch(() => undefined); // and for my friend?
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
    await this.addAll(files);
  }

  /** a file is being dragged over the frame */
  protected readonly over = signal(false);

  protected dragOver(event: DragEvent): void {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault(); // allows the drop
    this.over.set(true);
  }

  protected async dropped(event: DragEvent): Promise<void> {
    event.preventDefault();
    this.over.set(false);
    if (this.adding() !== null) return;
    await this.addAll(Array.from(event.dataTransfer?.files ?? []));
  }

  /** Adds the files (chosen or dropped) one by one: pictures are made smaller here (with a preview), everything else goes as it is. */
  private async addAll(files: File[]): Promise<void> {
    this.error.set(null);
    const max = this.box()?.maxFileBytes ?? 0;
    for (const file of files) {
      this.adding.set(file.name);
      try {
        if (file.type.startsWith('image/')) await this.service.addImage(this.friendId, await prepareImage(file as File), this.encryptWith());
        else if (max && file.size > max) throw new Error(`“${file.name}” is too big (at most ${formatBytes(max)})`);
        else await this.service.add(this.friendId, file, file.name, undefined, this.encryptWith());
      } catch (err: any) {
        this.error.set(err.message ?? `Could not add “${file.name}”`);
        break;
      }
    }
    this.adding.set(null);
    await this.reload();
  }

  /** the files that are stored unencrypted */
  protected readonly plainItems = computed(() => this.items().filter((item) => !item.enc));
  /** the files being locked: how many are done, of how many (null = not running) */
  protected readonly encrypting = signal<{ done: number; total: number } | null>(null);

  /** Locks every unencrypted file of the box (one by one; it stops at the first one that fails and says which). */
  protected async encryptAll(): Promise<void> {
    await this.encryptFiles(this.plainItems());
  }

  protected async encryptOne(item: SafeboxItem): Promise<void> {
    await this.encryptFiles([item]);
  }

  private async encryptFiles(files: SafeboxItem[]): Promise<void> {
    if (!this.canEncrypt() || this.encrypting()) return;
    this.error.set(null);
    this.busy.set(true);
    this.encrypting.set({ done: 0, total: files.length });
    try {
      for (const item of files) {
        try {
          await this.lockOne(item);
        } catch (err: any) {
          this.error.set(`“${item.name}” could not be encrypted: ${err.message ?? 'something went wrong'}`);
          break;
        }
        this.encrypting.update((p) => p && { ...p, done: p.done + 1 });
      }
    } finally {
      this.encrypting.set(null);
      this.busy.set(false);
      await this.reload();
    }
  }

  /** One file; when the keys changed while it was sent (409) the keys are read again and it is tried once more. */
  private async lockOne(item: SafeboxItem): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      const keys = this.boxKeys();
      if (!keys) throw new Error('The keys are not known yet');
      try {
        await this.service.encryptExisting(this.friendId, item, keys);
        return;
      } catch (err) {
        if (attempt > 0 || !(err instanceof ApiError) || err.status !== 409) throw err;
        this.boxKeys.set(await this.service.keys(this.friendId));
      }
    }
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
