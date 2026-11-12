import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { tr, translationsLoaded } from '../core/i18n';
import { AppDatePipe } from '../core/app-date.pipe';
import { arrangeKinds, isObjectType, objectIcon, objectKind, boxKinds } from '../core/safebox-objects';
import { NgTemplateOutlet } from '@angular/common';
import { Component, DestroyRef, computed, effect, inject, input, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { KeysService } from '../core/keys.service';
import { FriendsService } from '../core/friends.service';
import { formatBytes } from '../core/image';
import { NoticeClearService } from '../core/notice-clear.service';
import { SafeboxService } from '../core/safebox.service';
import { UiPreferencesService } from '../core/ui-preferences';
import { FriendContext } from '../friend-page/friend-context';
import { HoldDrag } from '../core/hold-drag';
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
  imports: [AppDatePipe, NgTemplateOutlet, RouterLink, SafeboxThumb, TranslocoDirective],
  templateUrl: './safebox.html',
  providers: [provideTranslocoScope('safebox')],
})
export class Safebox {
  private readonly service = inject(SafeboxService);
  private readonly friends = inject(FriendsService);
  private readonly ctx = inject(FriendContext);
  private readonly router = inject(Router);
  private readonly notices = inject(NoticeClearService);
  protected readonly prefs = inject(UiPreferencesService);

  protected readonly unsaved = this.service.unsaved;
  protected readonly friendId = inject(ActivatedRoute).snapshot.paramMap.get('id') ?? '';
  protected readonly friendName = computed(() => this.friends.friends().find((f) => f.id === this.friendId)?.name ?? 'your friend');
  protected readonly box = signal<SafeboxData | null>(null);
  protected readonly loadError = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
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

  protected readonly keyStatus = this.ctx.keyStatus;
  protected readonly newOpen = signal(false);
  /** "Hidden types" in the New frame: showing or folded away (remembered on this device) */
  protected readonly moreOpen = this.prefs.value('boxHiddenOpen');
  /** files are stored encrypted (both of us have a key) */
  protected readonly canEncrypt = computed(() => this.keyStatus() === 'both');
  /** ticked on the page (and remembered on this device): the files added now are stored unencrypted even though both of us have a key */
  protected readonly plain = this.prefs.value('boxPlain');
  protected readonly boxView = this.prefs.value('boxView');
  /** the items in the list, searched and filtered */
  protected readonly shown = computed(() => {
    this.dueTick(); // read again when the dates of older items have been found
    const words = this.query().toLowerCase().split(/\s+/).filter(Boolean);
    const attached = new Map<string, string[]>(); // the names of the attachments of each item: an item is found by them too
    if (words.length) for (const item of this.items()) if (item.parentId) attached.set(item.parentId, [...(attached.get(item.parentId) ?? []), item.name ?? '']);
    return this.items().filter((item) => {
      if (item.parentId || item.type === 'relation') return false;
      if (this.dueOnly() && !this.service.isDue(this.friendId, item.id)) return false;
      if (!words.length) return true;
      // only what the list holds is searched (title, first line, date, kind, file type and attachment names): the content of an item is read only when it is opened
      const text = [item.name, this.snippet(item), this.when(item), this.kindLabel(item), item.mime, ...(attached.get(item.id) ?? [])].join(' ').toLowerCase();
      return words.every((w) => text.includes(w));
    });
  });
  /** the words typed in the search field */
  protected readonly query = signal('');
  /** the flag "Due" in the search field: only what is due (its reminder period has begun, or its day) */
  protected readonly dueOnly = signal(false);
  private readonly dueTick = signal(0);
  protected readonly dueCount = computed(() => {
    this.dueTick();
    return this.items().filter((item) => !item.parentId && item.type !== 'relation' && this.service.isDue(this.friendId, item.id)).length;
  });
  /** how many attachments each object has, and the first picture of an album (its cover) */
  private readonly attachmentsOf = computed(() => {
    const map = new Map<string, SafeboxItem[]>();
    for (const item of this.items()) if (item.parentId) map.set(item.parentId, [...(map.get(item.parentId) ?? []), item]);
    return map;
  });

  protected attachments(item: SafeboxItem): number {
    return this.attachmentsOf().get(item.id)?.length ?? 0;
  }

  protected cover(item: SafeboxItem): SafeboxItem | null {
    return item.type === 'album' ? (this.attachmentsOf().get(item.id)?.find((i) => i.kind === 'image' && i.hasThumb) ?? null) : null;
  }

  constructor() {
    this.service.setLinkFrom(null); // a new item made from the top of the list is linked with nothing
    // the band under the header says how many files of this friendship this device cannot open
    effect(() => this.ctx.lockedFiles.set(this.shutCount()));
    inject(DestroyRef).onDestroy(() => {
      this.cards.destroy();
      this.kindDrag.destroy();
      this.ctx.lockedFiles.set(0);
      // left for a page outside the safebox: everything opened for this friend is let go (a page of the safebox, like an item, still needs it)
      const friendId = this.friendId;
      setTimeout(() => { if (!location.pathname.includes('/safebox')) this.service.release(friendId); }, 0);
    });
    if (!this.friends.friends().length) void this.friends.load().catch(() => undefined); // for the friend's name
    void this.reload();
  }

  // ---- the order of the items: hold an item (a card or a row) and drag it onto another one

  /** the cards and rows: picked up by holding, and dropped on another one */
  protected readonly cards = new HoldDrag({ selector: '[data-item-id]', key: 'itemId', onDrop: (from, to) => void this.moveItem(from, to), canStart: () => !this.busy(), });
  private async moveItem(id: string, targetId: string): Promise<void> {
    const box = this.box();
    if (!box) return;
    const top = box.items.filter((i) => !i.parentId && i.type !== 'relation');
    const rest = box.items.filter((i) => i.parentId || i.type === 'relation');
    const from = top.findIndex((i) => i.id === id);
    const to = top.findIndex((i) => i.id === targetId);
    if (from < 0 || to < 0 || from === to) return;
    top.splice(to, 0, ...top.splice(from, 1));
    const numbered = top.map((item, i) => ({ ...item, order: i + 1 }));
    this.box.set({ ...box, items: [...numbered, ...rest] });
    try {
      await this.service.reorder(this.friendId, numbered.map((i) => i.id));
    } catch (err: any) {
      this.error.set(err.message ?? tr('safebox.list.couldNotSaveTheOrder', 'Could not save the order'));
      await this.reload();
    }
  }

  protected async reload(): Promise<void> {
    this.loadError.set(null);
    try {
      this.box.set(await this.service.load(this.friendId));
      this.notices.opened(); // a notice about several files (it points to the list) can go now
      void this.service.loadDues(this.friendId, this.items()).then(() => this.dueTick.update((n) => n + 1)); // the items made before heads said when they are due
    } catch (err: any) {
      this.loadError.set(err.message ?? tr('safebox.common.couldNotOpenTheSafebox', 'Could not open the safebox'));
    }
  }

  /** the files that are stored unencrypted */
  private readonly deviceKeys = inject(KeysService);
  private readonly shutCount = computed(() => {
    const mine = this.deviceKeys.thisKeyId();
    return mine ? this.items().filter((item) => item.enc && !item.enc.wraps.some((w) => w.keyId === mine)).length : 0;
  });
  protected readonly plainItems = computed(() => this.items().filter((item) => !item.enc));
  /** the files being locked: how many are done, of how many (null = not running) */
  protected readonly encrypting = signal<{ done: number; total: number } | null>(null);

  protected async encryptOne(item: SafeboxItem): Promise<void> {
    await this.encryptFiles([item]);
  }

  private async encryptFiles(files: SafeboxItem[]): Promise<void> {
    if (!this.canEncrypt() || this.encrypting()) return;
    this.error.set(null);
    this.busy.set(true);
    this.encrypting.set({ done: 0, total: files.length });
    try {
      const failed = await this.ctx.lockFiles(files, (done) => this.encrypting.update((p) => p && { ...p, done }));
      if (failed) this.error.set(failed);
    } finally {
      this.encrypting.set(null);
      this.busy.set(false);
      await this.reload();
    }
  }

  /** Saves the file under its own name. */
  protected async download(item: SafeboxItem): Promise<void> {
    this.error.set(null);
    this.busy.set(true);
    try {
      this.save((await this.service.file(this.friendId, item.id)).url, item.name);
    } catch (err: any) {
      this.error.set(err.message ?? tr('safebox.list.couldNotDownloadThe', 'Could not download the file'));
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
      this.error.set(err.message ?? tr('safebox.common.couldNotRename', 'Could not rename the file'));
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
      this.error.set(err.message ?? tr('safebox.list.couldNotTakeThe', 'Could not take the file out'));
    } finally {
      this.busy.set(false);
    }
  }

  /** What the item is, in a word, for people who read the list with a screen reader */
  protected kindLabel(item: SafeboxItem): string {
    if (isObjectType(item.type)) return objectKind(item.type)?.label ?? '';
    return { image: 'Picture', video: 'Video', audio: 'Sound', document: 'Document' }[item.kind];
  }

  /** Where an item opens: a note has its own page, a file the viewer. */
  protected openLink(item: SafeboxItem): string[] {
    if (item.type === 'note') return ['/friends', this.friendId, 'safebox', 'note', item.id];
    return isObjectType(item.type) ? ['/friends', this.friendId, 'safebox', 'object', item.id] : ['/friends', this.friendId, 'safebox', item.id];
  }

  /** True for a note, secret, link ... (everything that is not a stored file). */
  protected isObject(item: SafeboxItem): boolean {
    return isObjectType(item.type);
  }

  /** What the "New" frame offers: a file (the upload page), then the kinds of object; a note has its own page. */
  protected readonly split = computed(() => arrangeKinds(this.kinds(), this.layout(), new Set(this.items().map((item) => item.type))));
  protected readonly layout = this.prefs.value('boxKindLayout');
  /** the kinds the New frame shows now: the first group, then the rest when "More types" is open */
  protected readonly newKinds = computed(() => [...this.split().main, ...(this.moreOpen() ? this.split().more : [])]);
  /** the kinds of the New frame: picked up by holding, dropped on another kind (it takes its place) or on "More types" (it goes in there); the choice is remembered */
  protected readonly kindDrag = new HoldDrag({ selector: '[data-kind-id]', key: 'kindId', onDrop: (from, to) => this.moveKind(from, to) });
  private readonly loaded = translationsLoaded();
  /** the names are read again when the language file has arrived */
  protected readonly kinds = computed(() => (this.loaded(), boxKinds()));

  /**
   * Puts a kind where another kind is: it joins the group of that kind (visible or hidden) in its place, the others move aside. Dropped on the
   * Hidden types / Visible types button it goes to the other group, at the end. The arrangement is remembered.
   */
  private moveKind(id: string, targetId: string): void {
    if (id === 'more' || id === targetId) return;
    const groups = { main: this.split().main.map((k) => k.type), more: this.split().more.map((k) => k.type) };
    const open = this.moreOpen();
    const fromKey = groups.main.includes(id) ? 'main' : 'more';
    const toKey = targetId === 'more' ? (open ? 'main' : 'more') : groups.main.includes(targetId) ? 'main' : 'more';
    if (targetId === 'more' && fromKey === toKey) return; // already there
    const at = targetId === 'more' ? groups[toKey].length : groups[toKey].indexOf(targetId);
    groups[fromKey].splice(groups[fromKey].indexOf(id), 1);
    groups[toKey].splice(Math.min(at, groups[toKey].length), 0, id);
    this.prefs.set('boxKindLayout', groups);
    if (targetId === 'more' && open) this.prefs.set('boxHiddenOpen', false); // dropped on "Visible types" (the hidden ones are showing): the list closes again
  }

  protected newLink(type: string): string[] {
    return type === 'note' ? ['/friends', this.friendId, 'safebox', 'note'] : ['/friends', this.friendId, 'safebox', 'new', type];
  }

  /** The sign of an object's type. */
  protected readonly iconOf = objectIcon;

  /** When a date or a ticket is, for the list and the badges. */
  protected when(item: SafeboxItem): string {
    return this.service.when(this.friendId, item.id);
  }

  /** The first line of a note, for the list. */
  protected snippet(item: SafeboxItem): string {
    return this.service.snippet(this.friendId, item.id);
  }
}
