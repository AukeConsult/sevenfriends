import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { SafeboxTell } from '../safebox-tell/safebox-tell';
import { tr } from '../../core/i18n';
import { toSignal } from '@angular/core/rxjs-interop';
import { Location } from '@angular/common';
import { Component, ElementRef, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { FriendsService } from '../../core/friends.service';
import { formatBytes } from '../../core/image';
import { PREVIEW_LIMIT_BYTES, SheetView, readSheets, renderDocx, renderPdf, renderPptx } from '../../core/office-preview';
import { SafeboxLinks } from '../safebox-links/safebox-links';
import { SafeboxService } from '../../core/safebox.service';
import { isObjectType } from '../../core/safebox-objects';
import { MediaAudio } from '../../media-audio/media-audio';
import { MediaVideo } from '../../media-video/media-video';
import { MediaRef, Safebox, SafeboxItem } from '../../models';
import { PageBar } from '../../page-bar/page-bar';

/** What a document is, from its type and the ending of its name: how it is shown. */
type DocType = 'pdf' | 'text' | 'word' | 'sheet' | 'slides' | 'zip' | 'other';

/** A text file is shown up to this many characters (a bigger one is cut, with a note). */
const TEXT_LIMIT = 200_000;

const ENDINGS: Record<string, DocType> = {
  doc: 'word', docx: 'word', odt: 'word', rtf: 'word',
  xls: 'sheet', xlsx: 'sheet', ods: 'sheet',
  ppt: 'slides', pptx: 'slides', odp: 'slides',
  zip: 'zip',
};

/**
 * One file of the safebox, shown by what it is (`/friends/:id/safebox/:itemId`): a picture big, a video and a sound with the
 * app's own player, a PDF, a Word (.docx), an Excel (.xlsx) and a PowerPoint (.pptx) file drawn in the page (`core/office-preview.ts`),
 * a text file as text, and the other files (old .doc / .xls / .ppt, OpenDocument, zip, too big) as a card with a Download button.
 * Arrows go to the next and the previous file of the box.
 */
@Component({
  selector: 'app-safebox-view',
  imports: [PageBar, SafeboxTell, RouterLink, MediaVideo, MediaAudio, SafeboxLinks, TranslocoDirective],
  templateUrl: './safebox-view.html',
  providers: [provideTranslocoScope('safebox')],
})
export class SafeboxView {
  private readonly service = inject(SafeboxService);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly route = inject(ActivatedRoute);

  protected readonly friendId = this.route.snapshot.paramMap.get('id') ?? '';
  protected readonly list = ['/friends', this.friendId, 'safebox'];
  private readonly friends = inject(FriendsService);
  protected readonly friendName = computed(() => this.friends.friends().find((f) => f.id === this.friendId)?.name ?? tr('safebox.view.yourFriend', 'Your friend'));
  protected readonly itemId = toSignal(this.route.paramMap.pipe(map((p) => p.get('itemId') ?? '')), { initialValue: this.route.snapshot.paramMap.get('itemId') ?? '' });

  protected readonly box = signal<Safebox | null>(null);
  protected readonly loadError = signal<string | null>(null);
  /** the file could not be read */
  protected readonly failed = signal(false);
  /** why a locked file could not be opened (null = the file could not be read: connection) */
  protected readonly failReason = signal<string | null>(null);
  /** the keys a locked file was locked for, and the key of this device (to explain why it does not open) */
  protected readonly failDetails = signal<string | null>(null);
  protected readonly busy = signal(false);

  /** the files of the box (a note has its own page: the arrows go from file to file) */
  private readonly parentOfCurrent = computed(() => (this.box()?.items ?? []).find((i) => i.id === this.itemId())?.parentId ?? null);
  /** the files the arrows go through: the other attachments of the same object, or the files of the box that belong to none */
  private readonly files = computed(() => (this.box()?.items ?? []).filter((i) => !isObjectType(i.type) && (i.parentId ?? null) === this.parentOfCurrent()));
  /** where Back goes: the object this file is attached to, otherwise the list */
  protected readonly back = computed(() => {
    const parent = this.parentOfCurrent();
    if (!parent) return ['/friends', this.friendId, 'safebox'];
    return ['/friends', this.friendId, 'safebox', (this.box()?.items ?? []).find((i) => i.id === parent)?.type === 'note' ? 'note' : 'object', parent];
  });
  /** the arrows from file to file are only for the pictures of an album */
  protected readonly inAlbum = computed(() => {
    const parent = this.parentOfCurrent();
    return !!parent && (this.box()?.items ?? []).find((i) => i.id === parent)?.type === 'album';
  });
  protected readonly index = computed(() => this.files().findIndex((i) => i.id === this.itemId()));
  protected readonly item = computed<SafeboxItem | null>(() => this.files()[this.index()] ?? null);
  /** the files around this one (newest first, like the box) */
  protected readonly newer = computed(() => (this.index() > 0 ? this.files()[this.index() - 1] : null));
  protected readonly older = computed(() => (this.index() >= 0 ? (this.files()[this.index() + 1] ?? null) : null));
  private readonly ending = computed(() => this.item()?.name.split('.').pop()?.toLowerCase() ?? '');
  protected readonly docType = computed<DocType>(() => {
    const item = this.item();
    if (item?.kind !== 'document') return 'other';
    if (item.mime === 'application/pdf') return 'pdf';
    if (item.mime.startsWith('text/')) return 'text';
    return ENDINGS[this.ending()] ?? (item.mime === 'application/zip' ? 'zip' : 'other');
  });
  /** how a document is drawn in the page, or null when it can only be downloaded (old Office files, OpenDocument, zip, too big) */
  protected readonly drawing = computed<'pdf' | 'docx' | 'xlsx' | 'pptx' | null>(() => {
    const item = this.item();
    if (!item || item.kind !== 'document' || item.bytes > PREVIEW_LIMIT_BYTES) return null;
    const type = this.docType();
    const ending = this.ending();
    return type === 'pdf' ? 'pdf' : type === 'word' && ending === 'docx' ? 'docx' : type === 'sheet' && ending === 'xlsx' ? 'xlsx' : type === 'slides' && ending === 'pptx' ? 'pptx' : null;
  });
  /** the words for a document that cannot be shown here */
  protected readonly docLabel = computed(() => ({ pdf: 'PDF', text: tr('safebox.common.text', 'Text'), word: tr('safebox.view.wordDocument', 'Word document'), sheet: 'Spreadsheet', slides: 'Presentation', zip: tr('safebox.view.zipArchive', 'Zip archive'), other: 'File' })[this.docType()]);

  /** the same file as the media components read it: they ask the server for `box-<id>/<item id>` */
  protected readonly ref = computed<MediaRef | null>(() => {
    const item = this.item();
    return item && (item.kind === 'video' || item.kind === 'audio' || item.kind === 'image')
      ? { ownerId: `box-${this.friendId}`, objectId: item.id, kind: item.kind, mime: item.mime, name: item.name, bytes: item.bytes, width: null, height: null, durationMs: null, hasThumb: item.hasThumb }
      : null;
  });

  /** where PDF, Word and PowerPoint files are drawn */
  private readonly host = viewChild<ElementRef<HTMLElement>>('host');
  /** the file is being read and drawn */
  protected readonly drawingNow = signal(false);
  protected readonly sheets = signal<SheetView[]>([]);
  protected readonly sheet = signal(0);
  protected readonly imageUrl = signal<string | null>(null);
  /** an encrypted video or sound, opened here (the media players read the server's file, which is locked) */
  protected readonly mediaUrl = signal<string | null>(null);
  protected readonly text = signal<string | null>(null);
  protected readonly cut = signal(false);
  protected readonly formatBytes = formatBytes;

  constructor() {
    void this.load();
    // draws a PDF, Word, Excel or PowerPoint file once its place in the page exists (the place is part of the template)
    let drawn: string | null = null;
    effect(() => {
      const item = this.item();
      const kind = this.drawing();
      const host = this.host()?.nativeElement;
      if (!item || !kind || (kind !== 'xlsx' && !host) || drawn === item.id) return;
      drawn = item.id;
      this.sheets.set([]);
      untracked(() => void this.draw(item, kind, host));
    });
    effect(() => {
      const item = this.item();
      this.imageUrl.set(null);
      this.mediaUrl.set(null);
      this.text.set(null);
      this.cut.set(false);
      this.failed.set(false);
      this.failReason.set(null);
      this.failDetails.set(null);
      if (!item) return;
      const shows = item.kind === 'image' || (item.enc && (item.kind === 'video' || item.kind === 'audio')) || (item.kind === 'document' && this.docType() === 'text');
      if (!shows) return;
      this.service
        .file(this.friendId, item.id)
        .then(async (file) => {
          if (this.item() !== item) return;
          if (item.kind === 'image') this.imageUrl.set(file.url);
          else if (item.kind === 'video' || item.kind === 'audio') this.mediaUrl.set(file.url);
          else {
            const all = await (await fetch(file.url)).text();
            if (this.item() !== item) return;
            this.cut.set(all.length > TEXT_LIMIT);
            this.text.set(all.slice(0, TEXT_LIMIT));
          }
        })
        .catch((err) => this.item() === item && this.fail(item, err));
    });
  }

  /** Reads a PDF, Word, Excel or PowerPoint file and draws it (when its place in the page is there). */
  private async draw(item: SafeboxItem, kind: 'pdf' | 'docx' | 'xlsx' | 'pptx', host: HTMLElement | undefined): Promise<void> {
    if (kind !== 'xlsx' && !host) return;
    this.drawingNow.set(true);
    this.failed.set(false);
    try {
      const blob = await (await fetch((await this.service.file(this.friendId, item.id)).url)).blob();
      if (this.item() !== item) return;
      if (kind === 'xlsx') {
        this.sheets.set(await readSheets(blob));
        this.sheet.set(0);
      } else if (kind === 'pdf') await renderPdf(blob, host!);
      else if (kind === 'docx') await renderDocx(blob, host!);
      else await renderPptx(blob, host!);
    } catch (err) {
      if (this.item() === item) this.fail(item, err);
    } finally {
      if (this.item() === item) this.drawingNow.set(false);
    }
  }

  private async load(): Promise<void> {
    try {
      this.box.set(await this.service.load(this.friendId));
    } catch (err: any) {
      this.loadError.set(err.message ?? tr('safebox.view.couldNotOpenThe', 'Could not open the file'));
    }
  }

  /** the file type at the end of the name (".jpg"): shown next to the field, never changed */
  protected readonly extension = computed(() => {
    const name = this.item()?.name ?? '';
    const dot = name.lastIndexOf('.');
    return dot > 0 && name.length - dot <= 8 ? name.slice(dot) : '';
  });
  protected readonly baseName = computed(() => (this.item()?.name ?? '').slice(0, (this.item()?.name ?? '').length - this.extension().length));
  /** the new name (without the file type) of the file, while it is being changed */
  protected readonly renaming = signal<string | null>(null);

  protected async rename(): Promise<void> {
    const item = this.item();
    const base = this.renaming()?.trim();
    if (!item || this.busy()) return;
    const name = base ? base + this.extension() : '';
    if (!name || name === item.name) { this.renaming.set(null); return; } // nothing to save: an empty name is not kept
    this.busy.set(true);
    try {
      const changed = await this.service.rename(this.friendId, item.id, name);
      this.box.update((b) => (b ? { ...b, items: b.items.map((i) => (i.id === item.id ? { ...i, name: changed.name ?? name } : i)) } : b));
      this.renaming.set(null);
    } catch (err: any) {
      this.loadError.set(err.message ?? tr('safebox.common.couldNotRename', 'Could not rename the file'));
    } finally {
      this.busy.set(false);
    }
  }

  protected readonly confirmDelete = signal(false);

  /** Takes the file out of the safebox (for both), and goes back to where the file was. */
  protected async remove(): Promise<void> {
    const item = this.item();
    if (!item) return;
    this.busy.set(true);
    try {
      await this.service.remove(this.friendId, item.id);
      this.service.forget(this.friendId, item.id);
      await this.router.navigate(this.back(), { replaceUrl: true });
    } catch (err: any) {
      this.loadError.set(err?.message || tr('safebox.common.couldNotTakeOut', 'Could not take it out'));
      this.busy.set(false);
    }
  }

  /** The title goes back to where the file was opened from (the item with the link, the list ...); to its own item or the list when the page was opened directly. */
  protected goBack(event: Event): void {
    if ((history.state?.navigationId ?? 1) > 1) {
      event.preventDefault();
      this.location.back();
    }
  }

  protected go(item: SafeboxItem | null): void {
    this.renaming.set(null);
    if (item) void this.router.navigate(['/friends', this.friendId, 'safebox', item.id], { replaceUrl: true });
  }

  /** Saves the file under its own name. */
  protected async download(): Promise<void> {
    const item = this.item();
    if (!item) return;
    this.busy.set(true);
    this.failed.set(false);
    try {
      const link = document.createElement('a');
      link.href = (await this.service.file(this.friendId, item.id)).url;
      link.download = item.name;
      link.click();
    } catch (err) {
      this.fail(item, err);
    } finally {
      this.busy.set(false);
    }
  }

  /** The file could not be read. A locked file says why (no key on this device, locked for another device, or changed); anything else is the connection. */
  private fail(item: SafeboxItem, err: unknown): void {
    this.failReason.set(item.enc ? (err instanceof Error ? err.message : tr('safebox.view.thisFileIsLocked2', 'This file is locked and could not be opened.')) : null);
    this.failed.set(true);
    this.failDetails.set(null);
    if (item.enc) {
      void this.service.explain(this.friendId, item.id).then((d) => {
        if (this.item() === item) this.failDetails.set(`Locked for keys: ${d.lockedFor.join(', ') || 'none for you'} · key on this device: ${d.thisDevice ?? 'none'}`);
      });
    }
  }
}
