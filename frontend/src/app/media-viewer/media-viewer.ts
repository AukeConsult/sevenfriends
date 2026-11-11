import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { tr } from '../core/i18n';
import { Location } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { formatBytes } from '../core/image';
import { MediaService, StoredFile } from '../core/media.service';
import { PageBar } from '../page-bar/page-bar';

/**
 * An image, a video or an audio message in full: /media/:ownerId/:objectId. It is read from the server like the one in the conversation,
 * and can be saved on the device (Download: the bytes already read, saved under the file name of the message).
 */
@Component({
  imports: [PageBar, TranslocoDirective],
  selector: 'app-media-viewer',
  templateUrl: './media-viewer.html',
  providers: [provideTranslocoScope('mediaViewer')],
})
export class MediaViewer {
  private readonly location = inject(Location);

  protected readonly file = signal<StoredFile | null>(null);
  protected readonly error = signal<string | null>(null);
  /** an image at its full size (scroll to see all of it) or fitted to the screen */
  protected readonly full = signal(false);
  protected readonly formatBytes = formatBytes;

  private readonly media = inject(MediaService);
  private readonly ownerId: string;
  private readonly objectId: string;
  /** the friendship the message belongs to (from the link in the conversation); without it the name cannot be changed here */
  protected readonly friendId: string | null;
  protected readonly renaming = signal(false);
  protected readonly newName = signal('');
  protected readonly saving = signal(false);
  protected readonly renameError = signal<string | null>(null);

  constructor() {
    const route = inject(ActivatedRoute).snapshot;
    const params = route.paramMap;
    this.ownerId = params.get('ownerId') ?? '';
    this.objectId = params.get('objectId') ?? '';
    this.friendId = route.queryParamMap.get('f');
    this.media
      .object(params.get('ownerId') ?? '', params.get('objectId') ?? '')
      .then((file) => this.file.set(file))
      .catch((err) => this.error.set(err.message ?? tr('mediaViewer.couldNotLoadThe', 'Could not load the file')));
  }

  protected isAudio(file: StoredFile): boolean {
    return file.type.startsWith('audio/');
  }

  protected isVideo(file: StoredFile): boolean {
    return file.type.startsWith('video/');
  }

  /** the ending of the file name (".jpg"): from the name, or else from the type; it is never changed by a rename */
  protected endingOf(file: StoredFile): string {
    const name = file.name ?? '';
    const own = /\.[A-Za-z0-9]{1,8}$/.exec(name)?.[0];
    if (own) return own;
    const extension = file.type.split('/')[1]?.split(';')[0].replace('jpeg', 'jpg').replace('quicktime', 'mov');
    return extension ? `.${extension}` : '';
  }

  protected baseOf(file: StoredFile): string {
    const name = file.name ?? '';
    const ending = /\.[A-Za-z0-9]{1,8}$/.exec(name)?.[0] ?? '';
    return name.slice(0, name.length - ending.length);
  }

  protected startRename(file: StoredFile): void {
    this.newName.set(this.baseOf(file));
    this.renameError.set(null);
    this.renaming.set(true);
  }

  protected async saveRename(file: StoredFile): Promise<void> {
    const base = this.newName().replace(/[\\/]/g, '').trim();
    if (!base || !this.friendId) {
      this.renameError.set(tr('mediaViewer.writeAName', 'Write a name'));
      return;
    }
    this.saving.set(true);
    this.renameError.set(null);
    try {
      const name = base.slice(0, 100 - this.endingOf(file).length) + this.endingOf(file);
      await this.media.rename(this.friendId, this.objectId, this.ownerId, this.objectId, name);
      this.file.set({ ...file, name });
      this.renaming.set(false);
    } catch (err) {
      this.renameError.set((err as Error).message || tr('mediaViewer.couldNotRenameThe', 'Could not rename the file'));
    } finally {
      this.saving.set(false);
    }
  }

  /** The name to save under: the file name of the message, with an extension if it has none. */
  protected saveName(file: StoredFile): string {
    const name = file.name || 'file';
    if (/\.[A-Za-z0-9]{2,5}$/.test(name)) return name;
    const extension = file.type.split('/')[1]?.split(';')[0].replace('jpeg', 'jpg').replace('quicktime', 'mov');
    return extension ? `${name}.${extension}` : name;
  }

  protected back(): void {
    this.location.back();
  }
}
