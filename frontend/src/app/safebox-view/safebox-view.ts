import { toSignal } from '@angular/core/rxjs-interop';
import { Component, ElementRef, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { formatBytes } from '../core/image';
import { PREVIEW_LIMIT_BYTES, SheetView, readSheets, renderDocx, renderPdf, renderPptx } from '../core/office-preview';
import { SafeboxService } from '../core/safebox.service';
import { MediaAudio } from '../media-audio/media-audio';
import { MediaVideo } from '../media-video/media-video';
import { MediaRef, Safebox, SafeboxItem } from '../models';

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
  imports: [RouterLink, MediaVideo, MediaAudio],
  templateUrl: './safebox-view.html',
})
export class SafeboxView {
  private readonly service = inject(SafeboxService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly friendId = this.route.snapshot.paramMap.get('id') ?? '';
  private readonly itemId = toSignal(this.route.paramMap.pipe(map((p) => p.get('itemId') ?? '')), { initialValue: this.route.snapshot.paramMap.get('itemId') ?? '' });

  protected readonly box = signal<Safebox | null>(null);
  protected readonly loadError = signal<string | null>(null);
  /** the file could not be read */
  protected readonly failed = signal(false);
  protected readonly busy = signal(false);

  protected readonly index = computed(() => (this.box()?.items ?? []).findIndex((i) => i.id === this.itemId()));
  protected readonly item = computed<SafeboxItem | null>(() => this.box()?.items[this.index()] ?? null);
  /** the files around this one (newest first, like the box) */
  protected readonly newer = computed(() => (this.index() > 0 ? this.box()!.items[this.index() - 1] : null));
  protected readonly older = computed(() => (this.index() >= 0 ? (this.box()!.items[this.index() + 1] ?? null) : null));
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
  protected readonly docLabel = computed(() => ({ pdf: 'PDF', text: 'Text', word: 'Word document', sheet: 'Spreadsheet', slides: 'Presentation', zip: 'Zip archive', other: 'File' })[this.docType()]);

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
        .catch(() => this.item() === item && this.failed.set(true));
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
    } catch {
      if (this.item() === item) this.failed.set(true);
    } finally {
      if (this.item() === item) this.drawingNow.set(false);
    }
  }

  private async load(): Promise<void> {
    try {
      this.box.set(await this.service.load(this.friendId));
    } catch (err: any) {
      this.loadError.set(err.message ?? 'Could not open the file');
    }
  }

  protected go(item: SafeboxItem | null): void {
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
    } catch {
      this.failed.set(true);
    } finally {
      this.busy.set(false);
    }
  }
}
