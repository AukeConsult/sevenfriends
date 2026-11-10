import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { tr } from '../../core/i18n';
import { SafeboxService } from '../../core/safebox.service';
import { isObjectType, objectIcon } from '../../core/safebox-objects';
import { SafeboxItem } from '../../models';

/**
 * The items this one is linked with (design: docs/design/safebox-objects.md, "Links"): a chip for each, which opens that item, with a small x to take the
 * link away, and a button that opens the page to pick another item. A link is seen from both of its ends; it is stored as a locked `relation` item.
 * Nothing is shown on an item that does not exist yet.
 */
@Component({
  selector: 'app-safebox-links',
  imports: [RouterLink, TranslocoDirective],
  templateUrl: './safebox-links.html',
  providers: [provideTranslocoScope('safebox')],
})
export class SafeboxLinks {
  readonly friendId = input.required<string>();
  /** the item that is open; null while it is new */
  readonly itemId = input<string | null>(null);

  private readonly service = inject(SafeboxService);
  private readonly items = signal<SafeboxItem[]>([]);
  private readonly ids = signal<string[]>([]);
  protected readonly error = signal<string | null>(null);
  /** the linked items that are still in the box (a link to one that was taken out is not shown) */
  protected readonly linked = computed(() => this.ids().map((id) => this.items().find((i) => i.id === id)).filter((i): i is SafeboxItem => !!i && i.type !== 'relation'));
  protected readonly icon = (item: SafeboxItem): string => (isObjectType(item.type) ? objectIcon(item.type) : '');

  constructor() {
    effect(() => {
      const id = this.itemId();
      if (id) void this.refresh(id);
    });
  }

  private async refresh(id: string): Promise<void> {
    try {
      const box = await this.service.load(this.friendId());
      this.items.set(box.items);
      this.ids.set(this.service.linkedWith(this.friendId(), id));
    } catch {
      /* the page shows its own problem with the box */
    }
  }

  protected open(item: SafeboxItem): string[] {
    const base = ['/friends', this.friendId(), 'safebox'];
    if (item.type === 'note') return [...base, 'note', item.id];
    return isObjectType(item.type) ? [...base, 'object', item.id] : [...base, item.id];
  }

  protected pickLink(): string[] {
    return ['/friends', this.friendId(), 'safebox', 'link', this.itemId() ?? ''];
  }

  protected newLink(): string[] {
    return ['/friends', this.friendId(), 'safebox', 'link', this.itemId() ?? '', 'new'];
  }

  protected async unlink(item: SafeboxItem): Promise<void> {
    const id = this.itemId();
    if (!id) return;
    this.error.set(null);
    try {
      await this.service.removeLink(this.friendId(), id, item.id);
      this.ids.set(this.service.linkedWith(this.friendId(), id));
    } catch (err: any) {
      this.error.set(err?.message ?? tr('safebox.links.couldNotTakeTheLink', 'Could not take the link away'));
    }
  }
}
