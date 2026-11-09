import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { tr } from '../core/i18n';
import { formatBytes, prepareImage } from '../core/image';
import { SafeboxService } from '../core/safebox.service';
import { SafeboxThumb } from '../safebox/safebox';
import { ALBUM_PICTURES_MAX, ATTACHMENTS_MAX, BoxKeys, SafeboxItem } from '../models';

/**
 * The attachments of one object of the safebox (design: docs/design/safebox-objects.md): files that belong to it, locked like any file of the box and
 * stored with `parentId`. On an object that exists, a chosen file is sent at once; on a new object (no `parentId` yet) the files wait here until the
 * page has saved the object and calls `uploadPending(id)`. An album holds only pictures (up to 100), any other object up to 10 files.
 */
@Component({
  selector: 'app-safebox-attachments',
  imports: [RouterLink, SafeboxThumb, TranslocoDirective],
  templateUrl: './safebox-attachments.html',
  providers: [provideTranslocoScope('safeboxAttachments')],
})
export class SafeboxAttachments {
  private readonly service = inject(SafeboxService);

  readonly friendId = input.required<string>();
  /** the object these belong to; null = a new object that is not saved yet */
  readonly parentId = input<string | null>(null);
  readonly album = input(false);
  /** a different limit than the usual (a case holds more) */
  readonly limit = input<number | null>(null);
  /** the keys of both friends: a file is always locked, so without them nothing can be added */
  readonly keys = input<BoxKeys | null>(null);

  protected readonly saved = signal<SafeboxItem[]>([]);
  protected readonly pending = signal<File[]>([]);
  protected readonly uploading = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly confirm = signal<string | null>(null);
  protected readonly max = computed(() => this.limit() ?? (this.album() ? ALBUM_PICTURES_MAX : ATTACHMENTS_MAX));
  protected readonly count = computed(() => this.saved().length + this.pending().length);
  protected readonly accept = computed(() => (this.album() ? 'image/*' : 'image/*,video/*,audio/*,.pdf,.txt,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.odp,.zip,.csv'));
  protected readonly formatBytes = formatBytes;
  protected readonly toRemove = computed(() => this.saved().find((i) => i.id === this.confirm()) ?? null);

  constructor() {
    effect(() => {
      if (this.parentId()) void this.reload();
    });
  }

  private async reload(): Promise<void> {
    const parent = this.parentId();
    if (!parent) return;
    try {
      this.saved.set(await this.service.children(this.friendId(), parent));
    } catch (err: any) {
      this.error.set(err?.message ?? tr('safeboxAttachments.couldNotRead', 'Could not read the attachments'));
    }
  }

  protected async chosen(input: HTMLInputElement): Promise<void> {
    let files = Array.from(input.files ?? []);
    input.value = ''; // the same file can be chosen again
    this.error.set(null);
    if (this.album()) files = files.filter((f) => f.type.startsWith('image/'));
    files = files.slice(0, Math.max(0, this.max() - this.count()));
    if (!files.length) return;
    const parent = this.parentId();
    if (parent) {
      const failed = await this.send(parent, files);
      if (failed) this.error.set(tr('safeboxAttachments.couldNotAddCount', '{{ count }} file(s) could not be added.', { count: failed }));
      await this.reload();
    } else this.pending.update((list) => [...list, ...files]);
  }

  /** Sends the files that waited (the object has been saved now). Answers how many could not be sent. */
  async uploadPending(parent: string): Promise<number> {
    const files = this.pending();
    const failed = await this.send(parent, files);
    this.pending.set([]);
    return failed;
  }

  private async send(parent: string, files: File[]): Promise<number> {
    const keys = this.keys();
    let failed = 0;
    for (const file of files) {
      this.uploading.set(file.name);
      try {
        if (!keys) throw new Error(tr('safeboxAttachments.noKeys', 'The keys are not known yet.'));
        if (file.type.startsWith('image/')) {
          const image = await prepareImage(file);
          await this.service.addAttachment(this.friendId(), parent, image.blob, image.name, image.thumb, keys);
        } else await this.service.addAttachment(this.friendId(), parent, file, file.name, undefined, keys);
      } catch (err: any) {
        failed++;
        this.error.set(err?.message ?? tr('safeboxAttachments.couldNotAdd', 'Could not add “{{ fileName }}”', { fileName: file.name }));
      }
    }
    this.uploading.set(null);
    return failed;
  }

  protected dropPending(index: number): void {
    this.pending.update((list) => list.filter((_, i) => i !== index));
  }

  protected async remove(item: SafeboxItem): Promise<void> {
    this.error.set(null);
    try {
      await this.service.remove(this.friendId(), item.id);
      this.service.forget(this.friendId(), item.id);
      this.confirm.set(null);
      await this.reload();
    } catch (err: any) {
      this.error.set(err?.message ?? tr('safeboxAttachments.couldNotTakeOut', 'Could not take it out'));
    }
  }
}
