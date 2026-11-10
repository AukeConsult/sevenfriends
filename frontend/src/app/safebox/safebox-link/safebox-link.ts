import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { Location } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { tr } from '../../core/i18n';
import { SafeboxService } from '../../core/safebox.service';
import { isObjectType, objectIcon, objectKind } from '../../core/safebox-objects';
import { FriendContext } from '../../friend-page/friend-context';
import { SafeboxItem } from '../../models';
import { PageBar } from '../../page-bar/page-bar';

/**
 * Link an item with another (`/friends/:id/safebox/link/:itemId`): a list of the other items of the box, with a search field. A tap on one makes the
 * link (a locked `relation` item, see SafeboxService.addLink) and goes back to the item.
 */
@Component({
  selector: 'app-safebox-link',
  imports: [PageBar, RouterLink, TranslocoDirective],
  templateUrl: './safebox-link.html',
  providers: [provideTranslocoScope('safebox')],
})
export class SafeboxLink {
  private readonly service = inject(SafeboxService);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly ctx = inject(FriendContext);
  private readonly route = inject(ActivatedRoute);

  protected readonly friendId = this.route.snapshot.paramMap.get('id') ?? '';
  protected readonly itemId = this.route.snapshot.paramMap.get('itemId') ?? '';
  protected readonly list = ['/friends', this.friendId, 'safebox'];
  private readonly items = signal<SafeboxItem[]>([]);
  private readonly already = signal<string[]>([]);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly search = signal('');
  protected readonly source = computed(() => this.items().find((i) => i.id === this.itemId));
  protected readonly icon = (item: SafeboxItem): string => (isObjectType(item.type) ? objectIcon(item.type) : '');

  /** the items that can be linked: not this one, not one it is linked with already, not an attachment, and what the search finds */
  protected readonly candidates = computed(() => {
    const text = this.search().trim().toLowerCase();
    return this.items().filter((i) => i.id !== this.itemId && !i.parentId && i.type !== 'relation' && !this.already().includes(i.id) && (!text || i.name.toLowerCase().includes(text)));
  });

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      const box = await this.service.load(this.friendId);
      this.items.set(box.items);
      this.already.set(this.service.linkedWith(this.friendId, this.itemId));
    } catch (err: any) {
      this.error.set(err?.message ?? tr('safebox.common.couldNotOpenTheSafebox', 'Could not open the safebox'));
    } finally {
      this.loading.set(false);
    }
  }

  protected kindLabel(item: SafeboxItem): string {
    return objectKind(item.type)?.label ?? ({ image: tr('safebox.link.picture', 'Picture'), video: 'Video', audio: tr('safebox.link.sound', 'Sound'), document: tr('safebox.common.file', 'File') } as Record<string, string>)[item.kind] ?? '';
  }

  protected async pick(item: SafeboxItem): Promise<void> {
    const keys = this.ctx.boxKeys();
    if (!keys) {
      this.error.set(tr('safebox.common.keysNotKnown', 'The keys are not known yet. Try again in a moment.'));
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.service.addLink(this.friendId, this.itemId, item.id, keys);
      this.back();
    } catch (err: any) {
      this.error.set(err?.message ?? tr('safebox.link.couldNotMakeTheLink', 'Could not make the link'));
      this.busy.set(false);
    }
  }

  /** Back is one step back in the history: the item the link is for (this page was opened from it, and nothing is left between). Opened directly: that item, or the list. */
  protected back(event?: Event): void {
    event?.preventDefault();
    if ((history.state?.navigationId ?? 1) > 1) this.location.back();
    else void this.router.navigate(this.service.openPath(this.friendId, this.itemId) ?? this.list, { replaceUrl: true });
  }
}
