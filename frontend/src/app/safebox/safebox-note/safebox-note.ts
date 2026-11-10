import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { SafeboxTell } from '../safebox-tell/safebox-tell';
import { Location } from '@angular/common';
import { Component, DestroyRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiError } from '../../core/api.service';
import { FriendsService } from '../../core/friends.service';
import { tr } from '../../core/i18n';
import { SafeboxLinks } from '../safebox-links/safebox-links';
import { SafeboxAttachments } from '../safebox-attachments/safebox-attachments';
import { SafeboxService } from '../../core/safebox.service';
import { UiPreferencesService } from '../../core/ui-preferences';
import { FriendContext } from '../../friend-page/friend-context';
import { NOTE_TEXT_MAX, NOTE_TITLE_MAX } from '../../models';

/**
 * One note of the safebox (design: docs/design/safebox-objects.md), new (`/friends/:id/safebox/note`) or opened to read and change
 * (`/friends/:id/safebox/note/:itemId`). The title and text are locked on this device; the server only keeps the locked note. Both friends can change
 * or take out a note. A change names the revision it started from: if the friend saved first the page says so and offers their version.
 */
@Component({
  selector: 'app-safebox-note',
  imports: [SafeboxTell, RouterLink, SafeboxAttachments, SafeboxLinks, TranslocoDirective],
  templateUrl: './safebox-note.html',
  providers: [provideTranslocoScope('safebox')],
})
export class SafeboxNote {
  private readonly service = inject(SafeboxService);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly ctx = inject(FriendContext);
  private readonly prefs = inject(UiPreferencesService);
  private readonly friends = inject(FriendsService);

  private readonly route = inject(ActivatedRoute);
  protected readonly friendId = this.route.snapshot.paramMap.get('id') ?? '';
  protected readonly itemId = inject(ActivatedRoute).snapshot.paramMap.get('itemId');
  protected readonly isNew = this.itemId === null;
  protected readonly titleMax = NOTE_TITLE_MAX;
  protected readonly textMax = NOTE_TEXT_MAX;
  protected readonly friendName = computed(() => this.friends.friends().find((f) => f.id === this.friendId)?.name ?? tr('safebox.common.yourFriend', 'your friend'));

  protected readonly title = signal('');
  protected readonly text = signal('');
  /** what the page opened with (to see whether something was changed), and the revision of it */
  private readonly saved = signal({ title: '', text: '' });
  private readonly revision = signal(0);
  protected readonly loading = signal(!this.isNew);
  protected readonly loadError = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  /** the friend saved this note while it was open here */
  protected readonly conflict = signal(false);
  protected readonly confirmDelete = signal(false);
  protected readonly keyStatus = this.ctx.keyStatus;
  protected readonly boxKeys = this.ctx.boxKeys;
  private readonly attachments = viewChild(SafeboxAttachments);

  protected readonly changed = computed(() => this.title() !== this.saved().title || this.text() !== this.saved().text);
  protected readonly canSave = computed(() => !this.busy() && !this.loading() && (this.title().trim() !== '' || this.text().trim() !== '') && (this.isNew || this.changed()) && this.keyStatus() === 'both');
  protected readonly list = ['/friends', this.friendId, 'safebox'];
  /** the item this new note is to be linked with ("Add a new item and link it"), taken when the page opens */
  private linkFrom: string | null = this.isNew ? this.service.takeLinkFrom() : null;

  constructor() {
    if (!this.friends.friends().length) void this.friends.load().catch(() => undefined); // for the friend's name
    if (!this.isNew) void this.open(true);
    // autosave: a change to a note that exists is saved a moment after the last key press (also once a save in progress is done)
    effect((onCleanup) => {
      this.title();
      this.text();
      this.busy();
      if (this.isNew || this.loading() || this.conflict() || !this.changed()) return;
      const timer = setTimeout(() => void this.save(), 800);
      onCleanup(() => clearTimeout(timer));
    });
    inject(DestroyRef).onDestroy(() => {
      if (this.canSave()) void this.save(true); // leaving the page keeps what was typed
    });
  }

  /** Reads the note from the server (again when `fresh`) and shows it. */
  private async open(fresh: boolean): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      const read = await this.service.readNote(this.friendId, this.itemId!, fresh);
      this.title.set(read.note.title);
      this.text.set(read.note.text);
      this.saved.set({ title: read.note.title, text: read.note.text });
      this.revision.set(read.revision);
      this.conflict.set(false);
    } catch (err: any) {
      this.loadError.set(err?.message || tr('safebox.note.couldNotOpenThe', 'Could not open the note'));
    } finally {
      this.loading.set(false);
    }
  }

  /** The friend's version, instead of what was written here. */
  protected loadTheirs(): void {
    void this.open(true);
  }

  protected async save(leaving = false): Promise<void> {
    if (!this.canSave()) return;
    this.busy.set(true);
    this.error.set(null);
    const title = this.title().trim() || firstWords(this.text()) || tr('safebox.common.note', 'Note');
    try {
      if (this.isNew) {
        const keys = this.ctx.boxKeys();
        if (!keys) throw new Error(tr('safebox.common.keysNotKnown', 'The keys are not known yet. Try again in a moment.'));
        const created = await this.service.addNote(this.friendId, title, this.text(), keys);
        if (leaving) {
          if (this.linkFrom) await this.service.addLink(this.friendId, this.linkFrom, created.id, keys).catch(() => undefined);
          return; // the person is leaving: nothing to open
        }
        await this.attachments()?.uploadPending(created.id);
        const from = this.linkFrom; // made from "Add a new item and link it"
        this.linkFrom = null;
        if (from) await this.service.addLink(this.friendId, from, created.id, keys).catch(() => undefined);
        await this.router.navigate(['/friends', this.friendId, 'safebox', 'note', created.id], { replaceUrl: true, state: from ? { backTo: from } : undefined }); // the page of the note opens, and goes on saving by itself
        return;
      }
      const updated = await this.service.updateNote(this.friendId, this.itemId!, title, this.text(), this.revision());
      this.revision.set(updated.revision);
      this.saved.set({ title: this.title(), text: this.text() });
    } catch (err: any) {
      if (err instanceof ApiError && err.status === 409 && !this.isNew) this.conflict.set(true);
      else this.error.set(err?.message || tr('safebox.note.couldNotSaveThe', 'Could not save the note'));
    } finally {
      this.busy.set(false);
    }
  }

  /** The title is the way back: to the page before when there is one in the app, otherwise to the list. */
  protected back(event: Event): void {
    event.preventDefault();
    if ((history.state?.navigationId ?? 1) > 1) {
      this.location.back(); // one step back: the page it was opened from (a new item made from an item replaces the pages of that flow, so that is the item)
      return;
    }
    const to = history.state?.backTo as string | undefined; // opened directly (a reload): the item it was made from, or the list
    void this.router.navigate((to ? this.service.openPath(this.friendId, to) : null) ?? this.list, { replaceUrl: true });
  }

  protected async remove(): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.service.remove(this.friendId, this.itemId!);
      this.service.forget(this.friendId, this.itemId!);
      await this.router.navigate(this.list, { replaceUrl: true });
    } catch (err: any) {
      this.error.set(err?.message || tr('safebox.note.couldNotTakeThe', 'Could not take the note out'));
      this.busy.set(false);
    }
  }
}

/** The first few words of a text, as a title for a note that was given none. */
function firstWords(text: string): string {
  const line = text.split('\n').map((l) => l.trim()).find((l) => l) ?? '';
  return line.length > 40 ? `${line.slice(0, 40)}…` : line;
}
